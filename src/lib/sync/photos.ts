import type { SupabaseClient } from "@supabase/supabase-js";
import { outboxKey, type PhotoMeta } from "../data/schema";
import { SyncOffline, sha256Hex, type SyncBatch } from "./engine";

// Photo files (Phase 2B-2 M5; docs/data-architecture-phase2.md, section 8). Runs after a record round, when the
// photos' rows (with their SHA-256) are on the server.
//
// Upload: a photo of this account's space whose row is on the server but not verified is checked first (verify-photo
// may find it already stored), uploaded if missing (never overwriting), then verified by the server. Only the
// server's verification counts: until then the photo is "waiting". Files above 6 MB use a resumable upload that
// continues where it stopped, even after a reload. The device's own copy is never removed or changed.
// Download: a verified photo this device doesn't have is downloaded through the account's own session (no public
// URLs) and kept only if its SHA-256 matches the row.

export const BUCKET = "family-photos";
const RESUMABLE_FROM = 6 * 1024 * 1024;
const CHUNK = 6 * 1024 * 1024; // the size Supabase Storage expects for every chunk but the last
// After this many uploads the server rejected as not matching, the photo is reported and left alone until the
// next start (the local copy is kept).
const MAX_MISMATCHES = 3;

// Photo metadata as this device keeps it, plus the transfer state M5 adds.
export type LocalPhoto = PhotoMeta & { uploadUrl?: string | null; mismatches?: number };

export interface PhotoLocal {
  photos(): LocalPhoto[];
  hasBytes(id: string): boolean;
  bytes(id: string): Promise<Blob | null>;
  // Keeps a downloaded file (already checked against its SHA-256).
  storeBytes(id: string, blob: Blob): Promise<boolean>;
  syncRecord(key: string): unknown;
  commit(batch: SyncBatch): Promise<"ok" | "stale">;
}

export type PhotoRoundResult = {
  verified: string[];
  downloaded: string[];
  // Photo id → why it isn't backed up / available yet. Retried every round.
  failed: Record<string, string>;
};

export type PhotoHooks = {
  // Called after each chunk of a resumable upload (to simulate a connection lost part-way).
  afterChunk?: (photoId: string, offset: number) => void | Promise<void>;
  // Lets a test change the bytes on their way up or down (a corrupted transfer).
  tamperUpload?: (photoId: string, blob: Blob) => Blob;
  tamperDownload?: (photoId: string, blob: Blob) => Blob;
};

type Ctx = { client: SupabaseClient; local: PhotoLocal; familyId: string; url: string; key: string; hooks: PhotoHooks };

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };
export const storagePath = (familyId: string, p: Pick<PhotoMeta, "id" | "mimeType">) => `${familyId}/${p.id}.${EXT[p.mimeType] ?? "jpg"}`;

const offlineError = (e: unknown) => {
  const x = e as { name?: string; message?: string; status?: number; statusCode?: string } | null;
  return !!x && (x.name === "TypeError" || x.name === "StorageUnknownError" && /fetch|network/i.test(x.message ?? "") || /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(x.message ?? ""));
};

export async function syncPhotos(client: SupabaseClient, local: PhotoLocal, opts: { familyId: string; url: string; key: string; hooks?: PhotoHooks }): Promise<PhotoRoundResult> {
  const ctx: Ctx = { client, local, familyId: opts.familyId, url: opts.url, key: opts.key, hooks: opts.hooks ?? {} };
  const result: PhotoRoundResult = { verified: [], downloaded: [], failed: {} };
  for (const photo of local.photos()) {
    if (photo.deletedAt) continue;
    // Only photos whose row this device has confirmed on the server (held or failed rows aren't).
    if (!local.syncRecord(outboxKey("photos", photo.id))) continue;
    try {
      if (!photo.verifiedAt && local.hasBytes(photo.id)) await upload(ctx, photo, result);
      else if (photo.verifiedAt && !local.hasBytes(photo.id)) await download(ctx, photo, result);
    } catch (e) {
      if (e instanceof SyncOffline || offlineError(e)) throw e instanceof SyncOffline ? e : new SyncOffline(String(e));
      result.failed[photo.id] = (e as Error).message || String(e);
    }
  }
  return result;
}

// ---- Upload --------------------------------------------------------------------------------------------------

type Verify = { status: "verified"; verifiedAt: string } | { status: "missing" | "mismatch" | "not-found" };

async function verify(ctx: Ctx, photoId: string): Promise<Verify> {
  const { data, error } = await ctx.client.functions.invoke("verify-photo", { body: { familyId: ctx.familyId, photoId } });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 404) return { status: "not-found" };
    if (error.name === "FunctionsFetchError" || offlineError(error)) throw new SyncOffline(error.message);
    throw new Error(`verify-photo: ${error.message}`);
  }
  return data as Verify;
}

async function upload(ctx: Ctx, photo: LocalPhoto, result: PhotoRoundResult) {
  if ((photo.mismatches ?? 0) >= MAX_MISMATCHES) {
    result.failed[photo.id] = "the server rejected this photo's file several times; the copy on this device is kept";
    return;
  }
  // Never assume: the file may already be stored (an earlier upload whose answer was lost).
  let check = await verify(ctx, photo.id);
  if (check.status === "verified") return markVerified(ctx, photo, check.verifiedAt, result);
  if (check.status === "not-found") { result.failed[photo.id] = "the photo's details are not on the server yet"; return; }

  const blob = await ctx.local.bytes(photo.id);
  if (!blob) return;
  const sum = await sha256Hex(await blob.arrayBuffer());
  if (photo.sha256 && sum !== photo.sha256) {
    // The local copy no longer matches what was recorded when it was saved: don't send it; keep it.
    result.failed[photo.id] = "the copy on this device doesn't match its checksum";
    return;
  }
  const outgoing = ctx.hooks.tamperUpload ? ctx.hooks.tamperUpload(photo.id, blob) : blob;
  const path = storagePath(ctx.familyId, photo);
  if (outgoing.size > RESUMABLE_FROM) await resumableUpload(ctx, photo, path, outgoing);
  else await simpleUpload(ctx, path, outgoing, photo.mimeType);

  check = await verify(ctx, photo.id);
  if (check.status === "verified") return markVerified(ctx, photo, check.verifiedAt, result);
  // Stored but not this photo (the server removed it), or gone: upload again next round.
  const mismatches = (photo.mismatches ?? 0) + (check.status === "mismatch" ? 1 : 0);
  await savePhotoState(ctx, { ...photo, mismatches, uploadUrl: null });
  result.failed[photo.id] = check.status === "mismatch" ? "the uploaded file didn't match; it will be sent again" : "the uploaded file wasn't found; it will be sent again";
}

async function simpleUpload(ctx: Ctx, path: string, blob: Blob, contentType: string) {
  const { error } = await ctx.client.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
  if (!error) return;
  const status = Number((error as { statusCode?: string | number }).statusCode ?? (error as { status?: number }).status);
  // Already stored (never overwritten): verification decides whether it is the right file.
  if (status === 409 || /exists|duplicate/i.test(error.message)) return;
  if (offlineError(error)) throw new SyncOffline(error.message);
  throw new Error(`upload: ${error.message}`);
}

// TUS resumable upload (Supabase Storage). The upload's address is kept with the photo, so a later round (or a
// reload) asks the server how much it has and continues from there.
async function resumableUpload(ctx: Ctx, photo: LocalPhoto, path: string, blob: Blob) {
  const { data } = await ctx.client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("not signed in");
  const headers = { Authorization: `Bearer ${token}`, apikey: ctx.key, "Tus-Resumable": "1.0.0", "x-upsert": "false" };
  const call = async (input: string, init: RequestInit) => {
    try { return await fetch(input, init); } catch (e) { throw new SyncOffline(String(e)); }
  };

  let location = photo.uploadUrl ?? null;
  let offset = 0;
  if (location) {
    const head = await call(location, { method: "HEAD", headers });
    if (head.ok) offset = Number(head.headers.get("Upload-Offset") ?? 0);
    else location = null; // expired or unknown: start again
  }
  if (!location) {
    const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
    const create = await call(`${ctx.url}/storage/v1/upload/resumable`, {
      method: "POST",
      headers: { ...headers, "Upload-Length": String(blob.size), "Upload-Metadata": `bucketName ${b64(BUCKET)},objectName ${b64(path)},contentType ${b64(photo.mimeType)},cacheControl ${b64("3600")}` },
    });
    if (create.status === 409) return; // already stored: verification decides
    if (!create.ok) throw new Error(`resumable upload: ${create.status} ${await create.text()}`);
    location = new URL(create.headers.get("Location")!, ctx.url).toString();
    await savePhotoState(ctx, { ...photo, uploadUrl: location });
  }
  while (offset < blob.size) {
    const chunk = blob.slice(offset, offset + CHUNK);
    const res = await call(location, { method: "PATCH", headers: { ...headers, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" }, body: chunk });
    if (res.status === 409) {
      // The server has a different amount than we thought (e.g. a chunk landed but its answer didn't): ask again.
      const head = await call(location, { method: "HEAD", headers });
      if (!head.ok) throw new Error(`resumable upload: ${head.status}`);
      offset = Number(head.headers.get("Upload-Offset") ?? 0);
      continue;
    }
    if (!res.ok) throw new Error(`resumable upload: ${res.status} ${await res.text()}`);
    offset = Number(res.headers.get("Upload-Offset") ?? offset + chunk.size);
    await ctx.hooks.afterChunk?.(photo.id, offset);
  }
}

async function markVerified(ctx: Ctx, photo: LocalPhoto, verifiedAt: string, result: PhotoRoundResult) {
  await savePhotoState(ctx, { ...photo, verifiedAt, uploadedAt: photo.uploadedAt ?? verifiedAt, uploadUrl: null, mismatches: 0 });
  result.verified.push(photo.id);
}

// Transfer state is this device's own bookkeeping: stored with the photo's metadata, never queued for upload.
const savePhotoState = (ctx: Ctx, photo: LocalPhoto) => ctx.local.commit({ records: [{ collection: "photos", record: photo as unknown as Record<string, unknown> }] });

// ---- Download ------------------------------------------------------------------------------------------------

async function download(ctx: Ctx, photo: LocalPhoto, result: PhotoRoundResult) {
  const { data, error } = await ctx.client.storage.from(BUCKET).download(storagePath(ctx.familyId, photo));
  if (error || !data) {
    if (offlineError(error)) throw new SyncOffline(String(error?.message));
    result.failed[photo.id] = `download: ${error?.message ?? "no data"}`;
    return;
  }
  const blob = ctx.hooks.tamperDownload ? ctx.hooks.tamperDownload(photo.id, data) : data;
  const sum = await sha256Hex(await blob.arrayBuffer());
  if (sum !== photo.sha256) {
    // Never keep a copy that isn't the photo: discarded, reported, tried again next round.
    result.failed[photo.id] = "the downloaded file didn't match its checksum; it will be downloaded again";
    return;
  }
  const typed = blob.type === photo.mimeType ? blob : new Blob([blob], { type: photo.mimeType });
  if (await ctx.local.storeBytes(photo.id, typed)) result.downloaded.push(photo.id);
  else result.failed[photo.id] = "the photo couldn't be stored on this device";
}
