// verify-photo (Phase 2B-2 M5; docs/data-architecture-phase2.md, section 8).
//
// A device has uploaded a photo's file to the private bucket. This function reads the stored object, computes its
// SHA-256 and compares it (and the size) with what the photo's row says:
// - match:    the row gets server_sha256 and verified_at; only now does the photo count as backed up;
// - mismatch: the object is deleted, so the device uploads it again (it keeps its own copy in any case);
// - missing:  nothing is stored yet; the device uploads it.
//
// The caller must be signed in and a member of the photo's family: the row is read with the caller's own token, so
// row-level security decides, and a photo of another family is simply "not found". Only then does the function use
// the service role, which never leaves the server. Repeating a call is safe.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const BUCKET = "family-photos";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PHOTO_ID = /^photo-[0-9a-f-]{36}$/;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "use POST" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json(401, { error: "not signed in" });

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoError } = await asCaller.auth.getUser(authorization.slice("Bearer ".length));
  if (whoError || !who.user) return json(401, { error: "not signed in" });

  let familyId: unknown, photoId: unknown;
  try {
    ({ familyId, photoId } = await req.json());
  } catch {
    return json(400, { error: "expected JSON { familyId, photoId }" });
  }
  if (typeof familyId !== "string" || !UUID.test(familyId) || typeof photoId !== "string" || !PHOTO_ID.test(photoId)) {
    return json(400, { error: "expected JSON { familyId, photoId }" });
  }

  // Read as the caller: row-level security hides every family the caller doesn't belong to.
  const { data: row, error: rowError } = await asCaller.from("photos")
    .select("sha256, byte_size, storage_path, uploaded_at, verified_at")
    .eq("family_id", familyId).eq("id", photoId).maybeSingle();
  if (rowError) return json(500, { error: "could not read the photo" });
  if (!row) return json(404, { status: "not-found" });
  if (row.verified_at) return json(200, { status: "verified", verifiedAt: row.verified_at });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: object, error: downloadError } = await admin.storage.from(BUCKET).download(row.storage_path);
  if (downloadError || !object) return json(200, { status: "missing" });

  const bytes = await object.arrayBuffer();
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (sha256 !== row.sha256 || bytes.byteLength !== Number(row.byte_size)) {
    // Not the photo the row describes (corrupted or incomplete): remove it so the device uploads it again.
    await admin.storage.from(BUCKET).remove([row.storage_path]);
    return json(200, { status: "mismatch" });
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await admin.from("photos")
    .update({ server_sha256: sha256, verified_at: now, ...(row.uploaded_at ? {} : { uploaded_at: now }) })
    .eq("family_id", familyId).eq("id", photoId).is("verified_at", null)
    .select("verified_at").maybeSingle();
  if (updateError) return json(500, { error: "could not record the verification" });
  // A parallel call may have verified it first; both report the stored time.
  if (!updated) {
    const { data: again } = await admin.from("photos").select("verified_at").eq("family_id", familyId).eq("id", photoId).maybeSingle();
    return json(200, { status: "verified", verifiedAt: again?.verified_at ?? now });
  }
  return json(200, { status: "verified", verifiedAt: updated.verified_at });
});
