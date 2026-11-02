// Backup and restore rehearsal (docs/shared-child-profiles-release-readiness.md, section F), on a disposable LOCAL
// stack only. Proves the documented procedure end to end with made-up data: a database dump alone is not enough,
// because photo files live in Storage, outside the database.
//
//   1. Fills the stack: two families, a child shared from one to the other by invitation, Moments, photos with files.
//   2. Backs up: `supabase db dump --data-only` (auth, public, private; not the storage schema, whose bucket comes from
//      the migrations and whose object rows come back with the files) plus every file of the `family-photos` bucket,
//      with a SHA-256 manifest.
//   3. Destroys: deletes every photo file, then `supabase db reset` (empty database, schema from the migrations).
//   4. Restores: the data dump with triggers off (`session_replication_role = replica`, one transaction, stop on the
//      first error), then every file uploaded back to its path.
//   5. Verifies: every row of every restored table identical, every file's SHA-256 identical, both parents sign in
//      with their old passwords, the shared member still sees exactly the shared child and its photo, and outsiders
//      still see nothing.
//
// Usage: node tests/ops/restoreRehearsal.mjs <workdir> <backup-dir>
//   <workdir>    holds the supabase/ folder of a running, disposable local stack with all migrations applied. Its
//                database is RESET by this script: never point it at a stack holding data you want to keep.
//   <backup-dir> an empty folder outside the repository; the dump and files written there are throwaway test data.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const [workdirArg, backupArg] = process.argv.slice(2);
if (!workdirArg || !backupArg) throw new Error("usage: node tests/ops/restoreRehearsal.mjs <workdir> <backup-dir>");
const workdir = path.resolve(workdirArg), backupDir = path.resolve(backupArg);
if (workdir === ROOT) throw new Error("refusing to reset the repository's own stack; use a disposable copy of supabase/ with its own project_id");
if (backupDir.startsWith(ROOT)) throw new Error("the backup folder must be outside the repository");
mkdirSync(path.join(backupDir, "files"), { recursive: true });
if (readdirSync(path.join(backupDir, "files")).length) throw new Error("the backup folder must be empty");

const cli = (...args) => execFileSync("npx", ["supabase", ...args, "--workdir", workdir], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
const status = JSON.parse(cli("status", "-o", "json"));
const API = status.API_URL, DB_URL = status.DB_URL;
const ANON = status.PUBLISHABLE_KEY ?? status.ANON_KEY, SERVICE = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
for (const u of [API, DB_URL]) if (!["127.0.0.1", "localhost"].includes(new URL(u).hostname)) throw new Error(`refusing non-local stack ${u}`);
const projectId = readFileSync(path.join(workdir, "supabase/config.toml"), "utf8").match(/^project_id\s*=\s*"([^"]+)"/m)[1];
if (projectId === "rootmap") throw new Error("refusing the main local stack (project_id rootmap)");

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(API, SERVICE, noSession);
const ok = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const sha = b => createHash("sha256").update(b).digest("hex");
const BUCKET = "family-photos";
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); console.log(`PASS  ${name}`); }
  catch (e) { results.push(["FAIL", name]); console.log(`FAIL  ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); }
};
const withDb = async fn => { const db = new pg.Client({ connectionString: DB_URL }); await db.connect(); try { return await fn(db); } finally { await db.end(); } };
// Every row of the tables a restore must bring back (auth identity, the family data, memberships, invitations).
const TABLES = ["auth.users", "auth.identities", "public.families", "public.family_members", "public.profiles", "public.children", "public.entries", "public.photos", "public.record_versions", "public.child_memberships", "public.child_invitations"];
const snapshot = () => withDb(async db => {
  const out = {};
  for (const t of TABLES) out[t] = (await db.query(`select to_jsonb(x) as r from ${t} x order by 1`)).rows.map(r => JSON.stringify(r.r)).sort();
  return out;
});

async function user(label, password = randomUUID()) {
  const email = `rehearsal-${label}-${randomUUID()}@example.com`;
  const created = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }), "createUser");
  return { id: created.user.id, email, password, client: await signIn(email, password) };
}
async function signIn(email, password) {
  const client = createClient(API, ANON, noSession);
  ok(await client.auth.signInWithPassword({ email, password }), `sign in ${email}`);
  return client;
}
async function photo(c, fid, childId, bytes) {
  const id = `photo-${randomUUID()}`;
  ok(await c.from("photos").insert({ family_id: fid, id, mime_type: "image/png", byte_size: bytes.length, sha256: sha(bytes), created_at: new Date().toISOString() }), "photo row");
  ok(await c.storage.from(BUCKET).upload(`${fid}/${id}.png`, bytes, { contentType: "image/png" }), "photo file");
  return id;
}
async function listFiles(prefix = "") {
  const out = [];
  for (const item of ok(await service.storage.from(BUCKET).list(prefix, { limit: 1000 }), "list")) {
    const p = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) out.push(p); else out.push(...await listFiles(p));
  }
  return out;
}
// Distinct bytes per photo (a 1×1 PNG with a trailing marker) so a file swapped with another would be caught.
const pngWith = marker => Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"), Buffer.from(marker)]);

try {
  // 1. Data.
  const A = await user("a"), B = await user("b"), Out = await user("outsider");
  const fa = ok(await A.client.rpc("create_family", { family_name: "Ahn" }), "family A");
  const fb = ok(await B.client.rpc("create_family", { family_name: "Brooks" }), "family B");
  ok(await A.client.from("children").insert([{ family_id: fa, id: "emma", first: "Emma" }, { family_id: fa, id: "leo", first: "Leo" }]), "A children");
  ok(await B.client.from("children").insert({ family_id: fb, id: "emma", first: "Bea" }), "B child");
  const pa = await photo(A.client, fa, "emma", pngWith("a-emma")), pl = await photo(A.client, fa, "leo", pngWith("a-leo")), pb = await photo(B.client, fb, "emma", pngWith("b-emma"));
  ok(await A.client.from("entries").insert([
    { family_id: fa, id: "m-1", child_id: "emma", date: "2026-10-01", text: "Emma painted", photo_ids: [pa] },
    { family_id: fa, id: "m-2", child_id: "leo", date: "2026-10-01", text: "Leo ran", photo_ids: [pl] },
  ]), "A entries");
  ok(await B.client.from("entries").insert({ family_id: fb, id: "m-1", child_id: "emma", date: "2026-10-02", text: "Bea sang", photo_ids: [pb] }), "B entry");
  const [inv] = ok(await A.client.rpc("create_invitation", { p_family_id: fa, p_child_id: "emma", p_role: "editor" }), "invite");
  assert.equal(ok(await B.client.rpc("accept_invitation", { p_token: inv.token }), "accept")[0].status, "ok");
  ok(await B.client.from("entries").insert({ family_id: fa, id: "m-3", child_id: "emma", date: "2026-10-03", text: "Bea's parent wrote about Emma", photo_ids: [] }), "shared write");
  ok(await A.client.rpc("create_invitation", { p_family_id: fa, p_child_id: "leo", p_role: "viewer" }), "pending invite");
  const before = await snapshot();
  console.log(`seeded: ${TABLES.map(t => `${t} ${before[t].length}`).join(", ")}`);

  // 2. Backup.
  const dump = path.join(backupDir, "data.sql");
  await check("Backup: data-only dump of auth, public and private (storage rows left to the file copy)", async () => {
    const storageTables = await withDb(db => db.query(`select table_name from information_schema.tables where table_schema = 'storage' and table_type = 'BASE TABLE'`).then(r => r.rows.map(t => `storage.${t.table_name}`)));
    cli("db", "dump", "--local", "--data-only", "--use-copy", ...storageTables.flatMap(t => ["-x", t]), "-f", dump);
    const sql = readFileSync(dump, "utf8");
    for (const t of ["auth.users", "public.children", "public.child_memberships", "public.child_invitations", "private.invitation_limits"]) assert.ok(sql.includes(`COPY "${t.split(".")[0]}"."${t.split(".")[1]}"`) || sql.includes(`COPY ${t}`), `dump has ${t}`);
    assert.ok(!/COPY "?storage"?\./.test(sql), "no storage table in the dump");
  });
  const manifest = {};
  await check("Backup: every photo file copied, with a SHA-256 manifest matching photos.sha256", async () => {
    for (const p of await listFiles()) {
      const bytes = Buffer.from(await ok(await service.storage.from(BUCKET).download(p), `download ${p}`).arrayBuffer());
      const local = path.join(backupDir, "files", p);
      mkdirSync(path.dirname(local), { recursive: true });
      writeFileSync(local, bytes);
      manifest[p] = sha(bytes);
    }
    writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    const rows = await withDb(db => db.query(`select storage_path, sha256 from public.photos`).then(r => r.rows));
    assert.ok(rows.length >= 3);
    for (const r of rows) assert.equal(manifest[r.storage_path], r.sha256, `${r.storage_path} in the copy, same hash`);
  });

  // 3. Destroy.
  await check("Disaster: every photo file deleted, then the database reset to an empty schema", async () => {
    const files = await listFiles();
    if (files.length) ok(await service.storage.from(BUCKET).remove(files), "remove files");
    assert.deepEqual(await listFiles(), []);
    cli("db", "reset", "--local");
    const counts = await withDb(db => db.query(`select (select count(*) from auth.users) u, (select count(*) from public.children) c`).then(r => r.rows[0]));
    assert.deepEqual([Number(counts.u), Number(counts.c)], [0, 0]);
  });

  // 4. Restore.
  await check("Restore: the dump in one transaction with triggers off, then every file uploaded back", async () => {
    const container = `supabase_db_${projectId}`;
    execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-c", "SET session_replication_role = replica", "-f", "-"], { input: readFileSync(dump), stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1 << 28 });
    for (const [p, hash] of Object.entries(manifest)) {
      const bytes = readFileSync(path.join(backupDir, "files", p));
      assert.equal(sha(bytes), hash, `backup copy of ${p} intact`);
      ok(await service.storage.from(BUCKET).upload(p, bytes, { contentType: "image/png", upsert: true }), `upload ${p}`);
    }
  });

  // 5. Verify.
  await check("Verified: every row of every restored table is identical", async () => {
    const after = await snapshot();
    for (const t of TABLES) assert.deepEqual(after[t], before[t], `${t} differs after restore`);
  });
  await check("Verified: every photo file is back at its path with the same SHA-256", async () => {
    const files = await listFiles();
    assert.deepEqual(files.sort(), Object.keys(manifest).sort());
    for (const p of files) assert.equal(sha(Buffer.from(await ok(await service.storage.from(BUCKET).download(p), p).arrayBuffer())), manifest[p]);
  });
  await check("Verified: parents sign in with their old passwords; access is exactly as before (owner, shared editor, outsider)", async () => {
    const a = await signIn(A.email, A.password), b = await signIn(B.email, B.password), o = await signIn(Out.email, Out.password);
    assert.deepEqual(ok(await a.from("children").select("id").eq("family_id", fa).order("id"), "A").map(r => r.id), ["emma", "leo"]);
    const bKids = ok(await b.from("children").select("family_id,id").order("family_id"), "B");
    assert.deepEqual(bKids.map(k => `${k.family_id === fa ? "A" : "B"}:${k.id}`).sort(), ["A:emma", "B:emma"], "B: own Bea and shared Emma, never Leo");
    assert.ok(!(await b.storage.from(BUCKET).download(`${fa}/${pa}.png`)).error, "shared photo readable by the member");
    assert.ok((await b.storage.from(BUCKET).download(`${fa}/${pl}.png`)).error, "Leo's photo still refused to B");
    assert.deepEqual(ok(await o.from("children").select("id"), "outsider"), [], "outsider sees nothing");
    assert.ok((await o.storage.from(BUCKET).download(`${fa}/${pa}.png`)).error);
    const circle = ok(await a.rpc("child_circle", { p_family_id: fa, p_child_id: "emma" }), "circle");
    assert.equal(circle.length, 2);
    assert.equal(ok(await a.rpc("list_invitations", { p_family_id: fa, p_child_id: "leo" }), "invitations").length, 1, "pending invitation restored");
    // The database still enforces its rules after a trigger-less restore.
    ok(await a.from("entries").insert({ family_id: fa, id: "m-after", child_id: "emma", date: "2026-11-01", text: "after the restore", photo_ids: [] }), "write after restore");
    assert.ok((await o.from("entries").insert({ family_id: fa, id: "m-x", child_id: "emma", date: "2026-11-01", text: "x", photo_ids: [] })).error, "outsider write refused");
  });
} catch (e) {
  results.push(["FAIL", "(set-up)"]);
  console.log(`FAIL  (set-up) ${e.stack}`);
}
const failed = results.filter(r => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
