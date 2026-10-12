import type { SupabaseClient } from "@supabase/supabase-js";
import type { Child } from "../../types";
import { planGuestMigration, type DemoSeed, type GuestPlan, type GuestSnapshot } from "../data/guestPlan";
import { isPhotoId, newPhotoId, newRecordId, outboxKey, uuid, type CollectionName, type OutboxEntry, type PhotoMeta } from "../data/schema";
import { SyncOffline, sha256Hex } from "./engine";
import { COLLECTION_OF, TABLE, clientRow, fromRow, toRow, type Row, type SyncedCollection, type Table } from "./mapping";

// Bringing what a parent saved before signing in into their account (Phase 2B-2 M6; docs/data-architecture-phase2.md,
// section 11 and the M6 notes).
//
// 1. Prepare (read only): the guest space is read without changing it, the planner (data/guestPlan.ts) sorts it by
//    origin, and the account (this device's space and the server) is checked for children that may be the same
//    and for ids already in use.
// 2. The parent answers one question ("Add them to your account?"), plus one about records whose origin isn't
//    known and one per possible duplicate child, only when those exist.
// 3. Copy: the chosen records and photos are written into the account's own space in one transaction, together
//    with their outbox entries and the attempt's state, so an interruption leaves all of it or none of it. The
//    guest database is never written. A record whose id is already used in the account by something else gets a
//    new id (its old one kept in `legacyId`); one already there with the same content is not copied again; a child
//    is combined with an account child only when the parent said they are the same.
// 4. Upload: the ordinary record and photo sync (engine.ts, photos.ts) sends them.
// 5. Complete: once every record is confirmed by the server and matches this device field by field, and every
//    photo is verified there, the server re-checks the manifest (complete_migration) and only then is the attempt
//    complete. Every step can be repeated; nothing is sent or stored twice.

export type ImportCollection = Exclude<CollectionName, "observations">;
// Legacy observations stay on the device: each one is already a memory (entries).
const IMPORTED: ImportCollection[] = ["children", "entries", "records", "plans", "goals", "saved"];
const PREFIX: Record<ImportCollection, string> = { children: "c", entries: "m", records: "r", plans: "p", goals: "g", saved: "" };

export type ImportCounts = { children: number; entries: number; records: number; plans: number; goals: number; saved: number; photos: number };
const noCounts = (): ImportCounts => ({ children: 0, entries: 0, records: 0, plans: 0, goals: 0, saved: 0, photos: 0 });

export type GuestManifest = {
  version: 1;
  deviceId: string;
  // Server table → the account ids of everything brought in (copied, or found already there).
  records: Partial<Record<Table, string[]>>;
  photos: { id: string; sha256: string }[];
  // "<collection>:<guest id>" → its id in the account.
  sources: Record<string, string>;
};

export type GuestImportState = {
  key: "guestImport";
  id: string;
  // dismissed: "Not now" (offered again from the Account page). copied: in this space, uploading. complete: the
  // server confirmed everything.
  status: "dismissed" | "copied" | "complete";
  decidedAt: string;
  // Guest records already decided for this account: brought in (→ account id) or left on this device (null).
  sources: Record<string, string | null>;
  manifest: GuestManifest | null;
  counts: ImportCounts;
  // Memories and activity records that look like ones already in the account (uploaded anyway, listed for tidying).
  likelyDuplicates: number;
  // Referenced photos whose file isn't on this device (the reference is left out of the account's copy).
  missingPhotos: number;
  completedAt: string | null;
};

// The parent's answers. `includeUncertain`: records whose origin isn't known. `sameChild`: guest child id → true
// when it is the same child as the account's.
export type ImportAnswers = { includeUncertain: boolean; sameChild: Record<string, boolean> };

// What the account already holds: this device's space and the server, by "<collection>:<id>".
export type AccountView = {
  records: Map<string, Record<string, unknown>>;
  photos: Map<string, { sha256?: string }>;
  // Live children, for "is this the same child?".
  children: Child[];
  // Guest records this account already decided (this device's state and earlier attempts from this device).
  handled: Record<string, string | null>;
};

export type ImportOffer = {
  plan: GuestPlan;
  // Brought in without a further question, and the records whose origin isn't known.
  sure: ImportCounts;
  uncertain: ImportCounts;
  childNames: string[];
  uncertainChildNames: string[];
  duplicates: { localId: string; cloudId: string; name: string; dob: string }[];
  // Untouched demo children that stay on this device.
  demoKept: string[];
  nothingToImport: boolean;
};

const keyOf = (collection: string, id: string) => `${collection}:${id}`;
// The types the private photo bucket accepts (supabase/migrations, storage). Others stay on this device.
const STORABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const childIdsOf = (r: Record<string, unknown>): string[] => (typeof r.childId === "string" ? [r.childId] : Array.isArray(r.childIds) ? (r.childIds as string[]) : []);
const fullName = (c: { first?: string; last?: string }) => [c.first, c.last].filter(x => x?.trim()).join(" ").trim();

// Same content, as the server would store it: bookkeeping (times, order, origin, owner) aside. A record that
// can't be stored on the server is never "the same".
const BOOKKEEPING = ["created_at", "updated_at", "deleted_at", "origin", "position", "legacy_id", "migrated_at", "owner_user_id", "uploaded_at"];
export function sameRecord(collection: ImportCollection, a: Record<string, unknown>, b: Record<string, unknown>, userId: string): boolean {
  try {
    const x = clientRow(collection, toRow(collection, a, { userId }));
    const y = clientRow(collection, toRow(collection, b, { userId }));
    for (const k of BOOKKEEPING) { delete x[k]; delete y[k]; }
    return JSON.stringify(x) === JSON.stringify(y);
  } catch {
    return false;
  }
}

// ---- Offer (pure) ----------------------------------------------------------------------------------------------

// A guest photo that can be brought into the account: its file is on this device (`photoSha`), the server can
// store its type, and it isn't one of the bundled demo pictures.
// While preparing, only the demo pictures have been read (`hashed` false): the others count if their type fits.
const uploadable = (snapshot: GuestSnapshot, id: string, photoSha: Map<string, string>, seed: DemoSeed, hashed = true) => {
  const meta = snapshot.photos.find(p => p.id === id);
  const sha = photoSha.get(id);
  if (!meta || !STORABLE.has(meta.mimeType) || (sha && seed.photoSha?.includes(sha))) return false;
  return !!sha || !hashed;
};

export function offerGuestImport(snapshot: GuestSnapshot, account: AccountView, demo: Child[], seed: DemoSeed, photoSha = new Map<string, string>()): ImportOffer {
  const plan = planGuestMigration(snapshot, demo, account.children, seed, photoSha);
  const open = (list: GuestPlan["upload"]) => list.filter(r => r.collection !== "observations" && !(keyOf(r.collection, r.id) in account.handled));
  plan.upload = open(plan.upload);
  plan.ask = open(plan.ask);
  plan.possibleDuplicates = plan.possibleDuplicates.filter(d => !(keyOf("children", d.localId) in account.handled));
  plan.needsConfirmation = plan.ask.length > 0 || plan.possibleDuplicates.length > 0;
  const childrenById = new Map(snapshot.collections.children.map(c => [c.id, c]));
  const count = (list: GuestPlan["upload"]) => {
    const out = noCounts();
    for (const r of list) if (!r.deleted) out[r.collection as ImportCollection]++;
    const photos = new Set<string>();
    for (const r of list) {
      const rec = (snapshot.collections[r.collection] as unknown as Record<string, unknown>[]).find(x => x.id === r.id);
      if (!rec || r.deleted) continue;
      for (const ref of r.collection === "children" ? [rec.photo] : r.collection === "entries" ? (rec.photos as unknown[]) ?? [] : []) if (isPhotoId(ref) && uploadable(snapshot, ref, photoSha, seed, false)) photos.add(ref);
    }
    out.photos = photos.size;
    return out;
  };
  const names = (list: GuestPlan["upload"]) => list.filter(r => r.collection === "children" && !r.deleted).map(r => fullName(childrenById.get(r.id) ?? {}) || r.id);
  const sure = count(plan.upload);
  const uncertain = count(plan.ask);
  return {
    plan,
    sure,
    uncertain,
    childNames: names(plan.upload),
    uncertainChildNames: names(plan.ask),
    duplicates: plan.possibleDuplicates.map(d => ({ ...d, name: fullName(childrenById.get(d.localId) ?? {}), dob: childrenById.get(d.localId)?.dob ?? "" })),
    demoKept: plan.keepDemo.filter(r => r.collection === "children" && !r.deleted).map(r => fullName(childrenById.get(r.id) ?? {})),
    nothingToImport: plan.upload.length === 0 && plan.ask.length === 0,
  };
}

// ---- Build the copy (pure) -------------------------------------------------------------------------------------

export type ImportBuild = {
  records: { collection: ImportCollection; record: Record<string, unknown> }[];
  // Photos to copy: the account's metadata, and the guest photo whose bytes it gets.
  photos: { meta: PhotoMeta; guestId: string }[];
  manifest: GuestManifest;
  sources: Record<string, string | null>;
  counts: ImportCounts;
  likelyDuplicates: number;
  missingPhotos: string[];
  // Records the server couldn't store as they are (e.g. no valid date): left on this device.
  unsendable: string[];
};

export function buildGuestImport(input: {
  snapshot: GuestSnapshot;
  offer: ImportOffer;
  answers: ImportAnswers;
  account: AccountView;
  // Guest photo id → SHA-256 of its bytes on this device (absent: no usable file).
  photoSha: Map<string, string>;
  // The bundled demo children and content (a demo child keeps its bundled picture on this device).
  demo?: Child[];
  seed?: DemoSeed;
  userId: string;
  deviceId: string;
  newId?: (collection: ImportCollection | "photos") => string;
}): ImportBuild {
  const { snapshot, offer, answers, account, userId } = input;
  const newId = input.newId ?? (c => (c === "photos" ? newPhotoId() : newRecordId(PREFIX[c] || "s")));
  const guest = (collection: ImportCollection, id: string) => (snapshot.collections[collection] as unknown as Record<string, unknown>[]).find(r => r.id === id);
  const sources: Record<string, string | null> = {};
  const out: ImportBuild = {
    records: [], photos: [], sources, counts: noCounts(), likelyDuplicates: 0, missingPhotos: [], unsendable: [],
    manifest: { version: 1, deviceId: input.deviceId, records: {}, photos: [], sources: {} },
  };

  // What is brought in: the sure group, the uncertain one if the parent said so, and every child a chosen record
  // belongs to (a memory can't be in the account without its child).
  const chosen = new Set(offer.plan.upload.map(r => keyOf(r.collection, r.id)));
  for (const r of offer.plan.ask) {
    if (answers.includeUncertain) chosen.add(keyOf(r.collection, r.id));
    else sources[keyOf(r.collection, r.id)] = null;
  }
  for (const key of [...chosen]) {
    const [collection, ...rest] = key.split(":");
    const rec = guest(collection as ImportCollection, rest.join(":"));
    if (!rec) continue;
    for (const childId of childIdsOf(rec)) {
      const childKey = keyOf("children", childId);
      // A child left on this device before comes along now that one of its records is the parent's.
      if (guest("children", childId) && !account.handled[childKey]) { chosen.add(childKey); delete sources[childKey]; }
    }
  }
  const isChosen = (collection: ImportCollection, id: string) => chosen.has(keyOf(collection, id));

  // Children first: their account ids are needed by everything that refers to them.
  const childMap = new Map<string, string>();
  for (const [key, to] of Object.entries(account.handled)) if (to && key.startsWith("children:") && !chosen.has(key)) childMap.set(key.slice("children:".length), to);
  const copyOrMatch = (collection: ImportCollection, rec: Record<string, unknown>): { id: string; copy: boolean } => {
    const existing = account.records.get(keyOf(collection, String(rec.id)));
    if (!existing) return { id: String(rec.id), copy: true };
    if (collection === "saved" || sameRecord(collection, existing, rec, userId)) return { id: String(rec.id), copy: false };
    return { id: newId(collection), copy: true };
  };

  const pending: { collection: ImportCollection; rec: Record<string, unknown>; id: string }[] = [];
  for (const child of snapshot.collections.children as unknown as Record<string, unknown>[]) {
    const id = String(child.id);
    if (!isChosen("children", id)) continue;
    const dup = offer.duplicates.find(d => d.localId === id);
    if (dup && answers.sameChild[id]) {
      childMap.set(id, dup.cloudId);
      sources[keyOf("children", id)] = dup.cloudId;
      continue;
    }
    // "Different children": never combined, even when the account's child has the same id and details.
    const target = dup && answers.sameChild[id] === false && account.records.has(keyOf("children", id)) ? { id: newId("children"), copy: true } : copyOrMatch("children", child);
    childMap.set(id, target.id);
    sources[keyOf("children", id)] = target.id;
    if (target.copy) pending.push({ collection: "children", rec: child, id: target.id });
  }

  // Then everything else, with its child references in account ids.
  for (const collection of IMPORTED.filter(c => c !== "children")) {
    for (const rec of snapshot.collections[collection] as unknown as Record<string, unknown>[]) {
      const id = String(rec.id);
      if (!isChosen(collection, id)) continue;
      const mapped: Record<string, unknown> = { ...rec };
      if (typeof rec.childId === "string") mapped.childId = childMap.get(rec.childId) ?? rec.childId;
      if (Array.isArray(rec.childIds)) mapped.childIds = [...new Set((rec.childIds as string[]).map(c => childMap.get(c) ?? c))];
      try {
        toRow(collection, mapped, { userId });
      } catch {
        out.unsendable.push(keyOf(collection, id));
        continue;
      }
      const target = copyOrMatch(collection, mapped);
      sources[keyOf(collection, id)] = target.id;
      if (target.copy) pending.push({ collection, rec: mapped, id: target.id });
    }
  }

  // Photos the copied records show. A photo already in the account with the same SHA-256 is the same photo.
  const photoMap = new Map<string, string | null>();
  const photoFor = (ref: string): string | null => {
    if (photoMap.has(ref)) return photoMap.get(ref)!;
    const meta = snapshot.photos.find(p => p.id === ref);
    const sha = input.photoSha.get(ref);
    let id: string | null = null;
    if (meta && sha && uploadable(snapshot, ref, input.photoSha, input.seed ?? {})) {
      const existing = account.photos.get(ref);
      if (existing && existing.sha256 === sha) id = ref;
      else {
        id = existing ? newId("photos") : ref;
        out.photos.push({ meta: { ...meta, id, sha256: sha, storagePath: null, uploadedAt: null, verifiedAt: null }, guestId: ref });
      }
      out.manifest.photos.push({ id, sha256: sha });
    } else if (!(sha && input.seed?.photoSha?.includes(sha))) {
      // No file on this device, or a type the server can't store: the account's copy goes without it.
      out.missingPhotos.push(ref);
    }
    photoMap.set(ref, id);
    return id;
  };

  const accountEntries = [...account.records.entries()].filter(([k, r]) => k.startsWith("entries:") && !r.deletedAt).map(([, r]) => r);
  const accountActivity = [...account.records.entries()].filter(([k, r]) => k.startsWith("records:") && !r.deletedAt).map(([, r]) => r);
  for (const { collection, rec, id } of pending) {
    const record: Record<string, unknown> = { ...rec, id, origin: "user" };
    if (id !== rec.id && !rec.legacyId) record.legacyId = rec.id;
    if (collection === "children" && isPhotoId(rec.photo)) {
      const photo = photoFor(rec.photo);
      // A demo child's bundled picture stays the bundled picture (shown from the app, not uploaded).
      const bundled = input.demo?.find(d => d.id === rec.id)?.photo;
      record.photo = photo ?? (input.seed?.photoSha?.includes(input.photoSha.get(rec.photo) ?? "-") && bundled ? bundled : "");
    }
    if (collection === "entries") record.photos = ((rec.photos as string[]) ?? []).map(ref => (isPhotoId(ref) ? photoFor(ref) : ref)).filter((x): x is string => !!x);
    out.records.push({ collection, record });
    if (!record.deletedAt) {
      const same = (a: unknown, b: unknown) => String(a ?? "").trim() === String(b ?? "").trim();
      if (collection === "entries" && accountEntries.some(e => e.childId === record.childId && e.date === record.date && same(e.title, record.title) && same(e.text, record.text))) out.likelyDuplicates++;
      if (collection === "records" && accountActivity.some(e => e.childId === record.childId && e.date === record.date && same(e.lesson, record.lesson) && e.kind === record.kind)) out.likelyDuplicates++;
    }
  }

  // The manifest: everything brought in, copied or already there, by server table.
  for (const [key, to] of Object.entries(sources)) {
    if (!to) continue;
    const collection = key.slice(0, key.indexOf(":")) as ImportCollection;
    const table = TABLE[collection as SyncedCollection];
    (out.manifest.records[table] ??= []).push(to);
    out.manifest.sources[key] = to;
    const rec = guest(collection, key.slice(key.indexOf(":") + 1));
    if (rec && !rec.deletedAt) out.counts[collection]++;
  }
  // Photos of records that were already in the account are part of the account too.
  for (const key of Object.keys(sources)) {
    if (!key.startsWith("entries:") && !key.startsWith("children:")) continue;
    if (pending.some(p => keyOf(p.collection, String(p.rec.id)) === key)) continue;
    const rec = guest(key.startsWith("entries:") ? "entries" : "children", key.slice(key.indexOf(":") + 1));
    for (const ref of key.startsWith("entries:") ? ((rec?.photos as string[]) ?? []) : [rec?.photo]) if (isPhotoId(ref) && account.photos.has(ref) && input.photoSha.get(ref) === account.photos.get(ref)?.sha256) photoFor(ref);
  }
  out.manifest.photos = [...new Map(out.manifest.photos.map(p => [p.id, p])).values()];
  out.counts.photos = out.manifest.photos.length;
  return out;
}

// ---- Orchestration --------------------------------------------------------------------------------------------

// The device as the import sees it (lib/data/store.ts in the app; an in-memory version in the tests).
export interface GuestImportLocal {
  // The guest space, read without changing it (null: none on this device).
  guest(): Promise<GuestSnapshot | null>;
  guestPhotoBytes(id: string): Promise<Blob | null>;
  // This account's space.
  records(collection: ImportCollection): Record<string, unknown>[];
  photos(): PhotoMeta[];
  state(): GuestImportState | null;
  saveState(state: GuestImportState): Promise<void>;
  // Stores the copy, its outbox entries and `state` in one transaction. "exists": a record id is already used here
  // (nothing stored); "decided": the stored state is no longer `expectStateId` (another tab acted; nothing stored).
  copy(batch: { records: ImportBuild["records"]; photos: { meta: PhotoMeta; blob: Blob }[]; state: GuestImportState; expectStateId: string | null }): Promise<"ok" | "exists" | "decided">;
  syncRecord(key: string): unknown;
  outbox(): OutboxEntry[];
  deviceId(): string;
}

export type ImportContext = { familyId: string; userId: string; demo: Child[]; seed: DemoSeed };
export type Prepared = { snapshot: GuestSnapshot; account: AccountView; offer: ImportOffer; stateId: string | null; photoSha: Map<string, string>; blobs: Map<string, Blob> };

// The SHA-256 of guest photos (`only`: these ids), from their bytes on this device. A file that no longer matches
// the SHA-256 recorded when it was saved is left out (it is reported, and stays on this device).
async function guestPhotos(local: GuestImportLocal, snapshot: GuestSnapshot, only?: Set<string>) {
  const photoSha = new Map<string, string>();
  const blobs = new Map<string, Blob>();
  for (const meta of snapshot.photos) {
    if (only && !only.has(meta.id)) continue;
    const blob = await local.guestPhotoBytes(meta.id);
    if (!blob) continue;
    const sum = await sha256Hex(await blob.arrayBuffer());
    if (meta.sha256 && meta.sha256 !== sum) continue;
    photoSha.set(meta.id, sum);
    blobs.set(meta.id, blob);
  }
  return { photoSha, blobs };
}

const isNetwork = (e: { message?: string; name?: string } | null | undefined) => !!e && (e.name === "TypeError" || /fetch|network|Load failed/i.test(e.message ?? ""));
function check<T>(res: { data: T; error: { message: string; name?: string } | null }): T {
  if (res.error) throw isNetwork(res.error) ? new SyncOffline(res.error.message) : new Error(res.error.message);
  return res.data;
}
const chunks = <T>(list: T[], size = 100) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

// Rows of `table` in the family with these ids (fetched in small groups).
async function rowsById(client: SupabaseClient, familyId: string, table: Table, ids: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const group of chunks([...new Set(ids)])) {
    if (!group.length) continue;
    rows.push(...(check(await client.from(table).select("*").eq("family_id", familyId).in("id", group)) as Row[]));
  }
  return rows;
}

// Reads the guest space and the account; nothing is changed anywhere. Needs the server (throws SyncOffline).
export async function prepareGuestImport(client: SupabaseClient, local: GuestImportLocal, ctx: ImportContext): Promise<Prepared | null> {
  const snapshot = await local.guest();
  if (!snapshot) return null;
  const state = local.state();
  const handled: Record<string, string | null> = { ...(state?.sources ?? {}) };
  // Earlier attempts from this device (e.g. if this space was removed and set up again).
  const earlier = check(await client.from("cloud_migrations").select("manifest").eq("family_id", ctx.familyId).eq("device_id", local.deviceId())) as { manifest: Partial<GuestManifest> }[];
  for (const m of earlier) for (const [k, v] of Object.entries(m.manifest?.sources ?? {})) if (!(k in handled)) handled[k] = v;

  const records = new Map<string, Record<string, unknown>>();
  const photos = new Map<string, { sha256?: string }>();
  // The server's copies of every id the guest uses, and every child (for "the same child?").
  for (const collection of IMPORTED) {
    const table = TABLE[collection];
    const ids = (snapshot.collections[collection] as { id: string }[]).map(r => r.id);
    const rows = collection === "children"
      ? (check(await client.from("children").select("*").eq("family_id", ctx.familyId).limit(10000)) as Row[])
      : await rowsById(client, ctx.familyId, table, ids);
    for (const row of rows) records.set(keyOf(collection, String(row.id)), fromRow(collection, row, undefined));
  }
  for (const row of await rowsById(client, ctx.familyId, "photos", snapshot.photos.map(p => p.id))) photos.set(String(row.id), { sha256: String(row.sha256) });
  // This device's copy of the account (it may hold changes not sent yet); it takes precedence.
  for (const collection of IMPORTED) for (const r of local.records(collection)) records.set(keyOf(collection, String(r.id)), r);
  for (const p of local.photos()) photos.set(p.id, { sha256: p.sha256 });
  const children = [...records.entries()].filter(([k, r]) => k.startsWith("children:") && !r.deletedAt).map(([, r]) => r as unknown as Child);
  const account: AccountView = { records, photos, children, handled };
  // Only the demo children's pictures are needed to decide (is it still the bundled one?); the rest are read when
  // the parent says yes.
  const demoPictures = new Set(snapshot.collections.children.filter(c => ctx.demo.some(d => d.id === c.id)).map(c => c.photo).filter(isPhotoId));
  const { photoSha, blobs } = await guestPhotos(local, snapshot, demoPictures);
  return { snapshot, account, offer: offerGuestImport(snapshot, account, ctx.demo, ctx.seed, photoSha), stateId: state?.id ?? null, photoSha, blobs };
}

// "Not now": nothing is copied; the Account page offers it again.
export async function dismissGuestImport(local: GuestImportLocal) {
  const state = local.state();
  if (state && state.status !== "dismissed") return;
  await local.saveState({ key: "guestImport", id: state?.id ?? `gi-${uuid()}`, status: "dismissed", decidedAt: new Date().toISOString(), sources: state?.sources ?? {}, manifest: null, counts: noCounts(), likelyDuplicates: 0, missingPhotos: 0, completedAt: null });
}

export type AcceptResult = { status: "copied" | "complete" | "decided"; state: GuestImportState | null };

// Copies the chosen records and photos into the account's space (one transaction), then records the attempt on
// the server when it can. Upload and completion follow with sync (advanceGuestImport).
export async function acceptGuestImport(client: SupabaseClient, local: GuestImportLocal, ctx: ImportContext, answers: ImportAnswers, prepared?: Prepared): Promise<AcceptResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = prepared && attempt === 0 ? prepared : await prepareGuestImport(client, local, ctx);
    if (!p) return { status: "decided", state: local.state() };
    const before = local.state();
    if (before && before.status === "copied") return { status: "decided", state: before };

    const { photoSha, blobs } = await guestPhotos(local, p.snapshot);
    const build = buildGuestImport({ snapshot: p.snapshot, offer: p.offer, answers, account: p.account, photoSha, demo: ctx.demo, seed: ctx.seed, userId: ctx.userId, deviceId: local.deviceId() });
    const anything = Object.values(build.sources).some(Boolean);
    const now = new Date().toISOString();
    const state: GuestImportState = {
      key: "guestImport", id: `gi-${uuid()}`, status: anything ? "copied" : "complete", decidedAt: now,
      sources: { ...(before?.sources ?? {}), ...build.sources }, manifest: anything ? build.manifest : null,
      counts: build.counts, likelyDuplicates: build.likelyDuplicates, missingPhotos: build.missingPhotos.length, completedAt: anything ? null : now,
    };
    const photos = build.photos.map(x => ({ meta: x.meta, blob: blobs.get(x.guestId)! }));
    const stored = await local.copy({ records: build.records, photos, state, expectStateId: p.stateId });
    if (stored === "exists") continue; // something arrived in the account meanwhile: look again
    if (stored === "decided") return { status: "decided", state: local.state() };
    if (anything) {
      rememberImportOnDevice(ctx.userId);
      await startOnServer(client, ctx.familyId, state).catch(() => undefined);
    }
    return { status: state.status === "complete" ? "complete" : "copied", state };
  }
  throw new Error("the account kept changing; try again");
}

async function startOnServer(client: SupabaseClient, familyId: string, state: GuestImportState) {
  const now = new Date().toISOString();
  check(await client.from("cloud_migrations").upsert({
    family_id: familyId, id: state.id, device_id: state.manifest!.deviceId, manifest: state.manifest, created_at: state.decidedAt, updated_at: now, origin: "user",
  }, { onConflict: "family_id,id", ignoreDuplicates: true }).select("id"));
}

export type ImportProgress = { total: number; done: number; status: GuestImportState["status"] | null };

// How much of the attempt the server has confirmed, from this device's sync state.
export function importProgress(local: Pick<GuestImportLocal, "state" | "syncRecord" | "outbox" | "photos">): ImportProgress {
  const state = local.state();
  if (!state?.manifest) return { total: 0, done: 0, status: state?.status ?? null };
  const pending = new Set(local.outbox().map(e => e.key));
  const verified = new Set(local.photos().filter(p => p.verifiedAt).map(p => p.id));
  let total = 0, done = 0;
  for (const [table, ids] of Object.entries(state.manifest.records)) {
    for (const id of ids ?? []) {
      const key = outboxKey(COLLECTION_OF[table as Table], id);
      total++;
      if (local.syncRecord(key) && !pending.has(key)) done++;
    }
  }
  for (const p of state.manifest.photos) { total++; if (verified.has(p.id)) done++; }
  return { total, done: state.status === "complete" ? total : done, status: state.status };
}

export type AdvanceResult = { status: "none" | "waiting" | "complete"; missing?: string[] };

// After a sync round: once everything is confirmed here, compares the server's rows with this device's records
// field by field, then asks the server to check and complete the attempt. Safe to repeat.
export async function advanceGuestImport(client: SupabaseClient, local: GuestImportLocal, ctx: { familyId: string; userId: string }): Promise<AdvanceResult> {
  const state = local.state();
  if (!state || state.status !== "copied" || !state.manifest) return { status: state?.status === "complete" ? "complete" : "none" };
  await startOnServer(client, ctx.familyId, state);
  const progress = importProgress(local);
  if (progress.done < progress.total) return { status: "waiting" };

  // Field-by-field: what the server holds is what this device holds.
  const missing: string[] = [];
  for (const [table, ids] of Object.entries(state.manifest.records) as [Table, string[]][]) {
    const collection = COLLECTION_OF[table] as ImportCollection;
    const rows = new Map((await rowsById(client, ctx.familyId, table, ids)).map(r => [String(r.id), r]));
    const mine = new Map(local.records(collection).map(r => [String(r.id), r]));
    for (const id of ids) {
      const row = rows.get(id);
      const rec = mine.get(id);
      if (!row || !rec || !sameRecord(collection, fromRow(collection, row, rec), rec, ctx.userId) || !!row.deleted_at !== !!rec.deletedAt) missing.push(`${table}:${id}`);
    }
  }
  if (missing.length) return { status: "waiting", missing };

  const res = check(await client.rpc("complete_migration", { p_family_id: ctx.familyId, p_id: state.id, p_manifest: state.manifest })) as { status: string; missing?: string[]; unverified?: string[] };
  if (res.status !== "complete") return { status: "waiting", missing: [...(res.missing ?? []), ...(res.unverified ?? []).map(id => `photos:${id}`)] };
  await local.saveState({ ...state, status: "complete", completedAt: new Date().toISOString() });
  return { status: "complete" };
}

// Device-level note of the accounts that took this device's guest data, so another account signing in here is
// told. Not part of the guest database (which is never written).
const DEVICE_IMPORTS_KEY = "rootmap.guest-imports";
export function accountsThatImported(): string[] {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(DEVICE_IMPORTS_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter(x => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function rememberImportOnDevice(userId: string) {
  try {
    const list = accountsThatImported();
    if (!list.includes(userId)) globalThis.localStorage?.setItem(DEVICE_IMPORTS_KEY, JSON.stringify([...list, userId]));
  } catch {
    // a note only
  }
}

export type { GuestSnapshot, DemoSeed };
