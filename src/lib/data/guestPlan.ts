import type { Child, LessonRecord, Observation } from "../../types";
import { getAll, openExisting } from "./idb";
import { COLLECTIONS, DB_NAME, isPhotoId, type CollectionName, type Collections, type PhotoMeta } from "./schema";

// Preparation for the first-login migration (Phase 2B-3 / M6; docs/data-architecture-phase2.md, section 11).
// Nothing here copies, uploads or changes anything: it reads the guest space and works out, record by record, what
// a later migration could do. Signing in does not make guest data the account's; the parent confirms ownership
// first, and only the "upload" group would ever go without a question.

export type GuestSnapshot = {
  collections: { [K in CollectionName]: Collections[K][] };
  photos: PhotoMeta[];
  drafts: number;
  archive: number;
};

export type PlannedRecord = { collection: CollectionName; id: string; deleted: boolean };

export type GuestPlan = {
  // The parent's own records, demo children they made their own, and everything attached to those children.
  upload: PlannedRecord[];
  // Untouched demo content: stays on this device, no question.
  keepDemo: PlannedRecord[];
  // Origin not reliably known (legacy data): one question covering all of them; never uploaded silently.
  ask: PlannedRecord[];
  // Local children with the same name and birth date as a child already in the account: "Is Mia the same Mia?"
  possibleDuplicates: { localId: string; cloudId: string }[];
  // Photos referenced by planned uploads (only verified photos ever count as backed up).
  photos: string[];
  // Never uploaded: drafts, archived items, photos nothing refers to.
  never: { drafts: number; archive: number; orphanPhotos: string[] };
  // True when the parent must answer before anything is uploaded.
  needsConfirmation: boolean;
};

const sameChild = (a: Pick<Child, "first" | "last" | "dob">, b: Pick<Child, "first" | "last" | "dob">) =>
  a.first.trim().toLowerCase() === b.first.trim().toLowerCase() && a.last.trim().toLowerCase() === b.last.trim().toLowerCase() && a.dob === b.dob;

// The bundled demo content besides the children (src/data/progress.ts and the default saved activities), to tell
// untouched demo records from ones the parent changed.
// `photoSha`: SHA-256 of the bundled demo pictures (a demo child's picture may be stored as a photo of its own).
export type DemoSeed = { records?: LessonRecord[]; observations?: Observation[]; saved?: string[]; photoSha?: string[] };

const sameText = (a: unknown, b: unknown) => String(a ?? "").trim() === String(b ?? "").trim();
const sameList = (a: unknown, b: unknown) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

// A demo child the parent hasn't made their own: same name and birth date as bundled, no photo or notes of theirs.
// A bundled picture's address changes between builds, and older versions stored it as a photo of its own, so a
// stored photo counts as the parent's only if its bytes aren't a bundled picture's (`photoSha`: guest photo id →
// SHA-256 of its bytes).
const untouchedChild = (child: Child, demo: Child | undefined, seed: DemoSeed, photoSha: Map<string, string>) =>
  !!demo && sameChild(child, demo) && !child.notes?.trim() && (!isPhotoId(child.photo) || !!seed.photoSha?.includes(photoSha.get(child.photo) ?? "-"));

// Bundled demo content exactly as shipped: a demo record, observation, the memory the app made from a demo
// observation ("obs-<id>"; it is stored with origin "user" because the app wrote it), or a default saved activity.
function untouchedDemo(name: CollectionName, r: Record<string, unknown>, seed: DemoSeed): boolean {
  if (name === "records") {
    const s = seed.records?.find(x => x.id === r.id);
    return !!s && r.childId === s.childId && r.lesson === s.lesson && r.area === s.area && r.stage === s.stage && r.date === s.date && sameText(r.notes, s.notes) && sameText(r.notesZh, s.notesZh) && sameText(r.nextSteps, s.nextSteps) && sameList(r.skills, s.skills);
  }
  if (name === "observations") {
    const s = seed.observations?.find(x => x.id === r.id);
    return !!s && r.childId === s.childId && r.date === s.date && sameText(r.notes, s.notes);
  }
  if (name === "entries") {
    const s = typeof r.id === "string" && r.id.startsWith("obs-") ? seed.observations?.find(x => `obs-${x.id}` === r.id) : undefined;
    return !!s && r.childId === s.childId && r.date === s.date && sameText(r.text, s.notes) && !String(r.title ?? "").trim() && !((r.photos as unknown[] | undefined) ?? []).length;
  }
  if (name === "saved") return !!seed.saved?.includes(String(r.id)) && r.origin !== "user";
  return false;
}

// Photo ids a record refers to.
function photoRefs(collection: CollectionName, r: Record<string, unknown>): string[] {
  const refs = collection === "children" ? [r.photo] : collection === "entries" ? (r.photos as unknown[] | undefined) ?? [] : [];
  return refs.filter(isPhotoId);
}

// `demoChildren`: the bundled demo children, to tell an untouched demo child from one the parent changed.
// `cloudChildren`: children already in the account. `seed`: the rest of the bundled demo content.
export function planGuestMigration(snapshot: GuestSnapshot, demoChildren: Child[], cloudChildren: Child[] = [], seed: DemoSeed = {}, photoSha = new Map<string, string>()): GuestPlan {
  const plan: GuestPlan = { upload: [], keepDemo: [], ask: [], possibleDuplicates: [], photos: [], never: { drafts: snapshot.drafts, archive: snapshot.archive, orphanPhotos: [] }, needsConfirmation: false };
  const c = snapshot.collections;
  const childOf = (r: { childId?: string; childIds?: string[] }) => (r.childId ? [r.childId] : r.childIds ?? []);
  // The parent's own work on a child: a record they created, or a demo record they changed.
  const parentsWork = (name: CollectionName, r: Record<string, unknown>) =>
    !untouchedDemo(name, r, seed) && (r.origin === "user" || (r.origin === "demo" && (name === "records" ? !!seed.records?.some(x => x.id === r.id) : name === "observations" && !!seed.observations?.some(x => x.id === r.id))));
  const hasUserRecords = (childId: string) =>
    (["records", "observations", "entries", "plans"] as const).some(name => (c[name] as unknown as Record<string, unknown>[]).some(r => !r.deletedAt && parentsWork(name, r) && childOf(r).includes(childId)));

  // Children first: which ones the parent owns.
  const ownChildren = new Set<string>();
  for (const child of c.children) {
    const demo = demoChildren.find(d => d.id === child.id);
    const madeOwn = child.origin === "demo" && (!untouchedChild(child, demo, seed, photoSha) || hasUserRecords(child.id));
    if (child.origin === "user" || madeOwn) ownChildren.add(child.id);
  }

  const referenced = new Set<string>();
  for (const name of COLLECTIONS) {
    // A collection added after the snapshot was taken (e.g. savedCollections) is simply empty.
    for (const r of (c[name] ?? []) as (Collections[CollectionName] & Record<string, unknown>)[]) {
      const item = { collection: name, id: r.id, deleted: !!r.deletedAt };
      const children = name === "children" ? [r.id] : childOf(r as { childId?: string; childIds?: string[] });
      const attached = children.some(id => ownChildren.has(id));
      const group = attached ? plan.upload : untouchedDemo(name, r, seed) ? plan.keepDemo : r.origin === "user" ? plan.upload : r.origin === "demo" ? plan.keepDemo : plan.ask;
      group.push(item);
      for (const ref of photoRefs(name, r)) {
        referenced.add(ref);
        if (group === plan.upload) plan.photos.push(ref);
      }
    }
  }
  plan.photos = [...new Set(plan.photos)];
  plan.never.orphanPhotos = snapshot.photos.map(p => p.id).filter(id => !referenced.has(id));

  for (const child of c.children) {
    if (!ownChildren.has(child.id)) continue;
    const match = cloudChildren.find(cc => !cc.deletedAt && sameChild(child, cc));
    if (match) plan.possibleDuplicates.push({ localId: child.id, cloudId: match.id });
  }
  plan.needsConfirmation = plan.ask.length > 0 || plan.possibleDuplicates.length > 0;
  return plan;
}

// The guest space as stored, read without changing it (null when this device has no guest database).
export async function readGuestSnapshot(): Promise<GuestSnapshot | null> {
  const db = await openExisting(DB_NAME);
  if (!db) return null;
  try {
    // A guest database last opened by an earlier version may not have every store yet (it is read, not upgraded).
    const collections = Object.fromEntries(await Promise.all(COLLECTIONS.map(async name => [name, db.objectStoreNames.contains(name) ? await getAll(db, name) : []]))) as GuestSnapshot["collections"];
    return { collections, photos: await getAll<PhotoMeta>(db, "photos"), drafts: (await getAll(db, "drafts")).length, archive: (await getAll(db, "archive")).length };
  } finally {
    db.close();
  }
}
