// Upgrade test for the Shared Child Profiles migrations (docs/shared-child-profiles-release-readiness.md, section E).
//
// Starts from a database that has only the pre-sharing migrations (up to 20261027000200_admin_grants), fills it with
// representative data written the way the pre-sharing app wrote it (each parent through the API with their own
// session: create_family, children, Moments, activity records, photos with files, plans, goals, kept versions; plus a
// soft-deleted child and a seed id `emma` in two families), applies the remaining migrations with the Supabase CLI,
// and checks that nothing existing changed and that sharing works on the upgraded data.
//
// It also proves the backfill's refusal on upgrade: a family with a child and no member makes `migration up` fail and
// roll back completely; once that family is gone, the same command succeeds.
//
// Usage (disposable LOCAL stacks only; refused for anything not on this machine):
//   node tests/ops/upgrade.mjs <workdir>
// <workdir> holds the supabase/ folder of a running local stack with ONLY the pre-sharing migrations applied: either a
// copy of supabase/ with the later migrations moved out (they are copied back in from the repository here), or, on a
// throwaway CI runner, the repository itself after `supabase db reset --version 20261027000200`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const LAST_PRE_SHARING = "20261027000200";
const workdir = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !existsSync(path.join(workdir, "supabase/config.toml"))) throw new Error("usage: node tests/ops/upgrade.mjs <workdir with supabase/config.toml>");

const cli = (...args) => execFileSync("npx", ["supabase", ...args, "--workdir", workdir], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const status = JSON.parse(cli("status", "-o", "json"));
const API = status.API_URL, DB_URL = status.DB_URL;
const ANON = status.PUBLISHABLE_KEY ?? status.ANON_KEY, SERVICE = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
for (const u of [API, DB_URL]) if (!["127.0.0.1", "localhost"].includes(new URL(u).hostname)) throw new Error(`refusing non-local stack ${u}`);

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(API, SERVICE, noSession);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const sha = b => createHash("sha256").update(b).digest("hex");
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); console.log(`PASS  ${name}`); }
  catch (e) { results.push(["FAIL", name]); console.log(`FAIL  ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); }
};
const ok = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };

async function user(label) {
  const email = `upgrade-${label}-${randomUUID()}@example.com`, password = randomUUID();
  const created = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }), "createUser");
  const client = createClient(API, ANON, noSession);
  ok(await client.auth.signInWithPassword({ email, password }), "sign in");
  return { id: created.user.id, email, client };
}
// What the pre-sharing app wrote for one family, through that parent's own session.
async function family(u, name) {
  const fid = ok(await u.client.rpc("create_family", { family_name: name }), "create_family");
  const c = u.client;
  const now = new Date().toISOString();
  ok(await c.from("children").insert([
    { family_id: fid, id: "emma", first: "Emma", last: name, dob: "2021-03-01", created_at: now },
    { family_id: fid, id: "c-second", first: `Second ${name}`, last: name, dob: "2023-06-01", created_at: now },
  ]), "children");
  const photoId = `photo-${randomUUID()}`;
  ok(await c.from("photos").insert({ family_id: fid, id: photoId, mime_type: "image/png", byte_size: PNG.length, width: 1, height: 1, sha256: sha(PNG), created_at: now }), "photo row");
  ok(await c.storage.from("family-photos").upload(`${fid}/${photoId}.png`, PNG, { contentType: "image/png" }), "photo file");
  ok(await c.from("entries").insert([
    { family_id: fid, id: "m-1", child_id: "emma", date: "2026-10-01", text: `${name}: Emma's Moment`, photo_ids: [photoId], created_at: now },
    { family_id: fid, id: "m-2", child_id: "c-second", date: "2026-10-02", text: `${name}: second child's Moment`, photo_ids: [], created_at: now },
  ]), "entries");
  ok(await c.from("activity_records").insert({ family_id: fid, id: "r-1", child_id: "emma", activity_id: "water-pouring", date: "2026-10-03", created_at: now }), "activity record");
  ok(await c.from("plans").insert({ family_id: fid, id: "p-1", activity_id: "water-pouring", date: "2026-10-04", child_ids: ["emma", "c-second"], created_at: now }), "plan");
  ok(await c.from("goals").insert({ family_id: fid, id: "g-1", owner_user_id: u.id, title: "Read together", created_at: now }), "goal");
  ok(await c.from("record_versions").insert([
    { family_id: fid, id: `v-${randomUUID()}`, table_name: "entries", record_id: "m-1", version: { id: "m-1", child_id: "emma", text: "older text" }, reason: "text_conflict", created_at: now },
    { family_id: fid, id: `v-${randomUUID()}`, table_name: "children", record_id: "emma", version: { id: "emma", first: "Em" }, reason: "field_conflict", created_at: now },
  ]), "versions");
  // Removed from the family's list (soft delete), as the app does.
  ok(await c.from("children").update({ deleted_at: now }).eq("family_id", fid).eq("id", "c-second"), "soft delete");
  return { fid, photoId };
}

const TABLES = ["families", "family_members", "profiles", "children", "entries", "activity_records", "plans", "goals", "saved_activities", "photos", "record_versions", "cloud_migrations", "user_settings"];
// Every row of every table, on the columns that existed before the upgrade.
async function snapshot() {
  const out = {};
  for (const t of TABLES) {
    const cols = (await q(`select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).map(r => r.column_name);
    out[t] = { cols, rows: await q(`select ${cols.map(c => `"${c}"`).join(",")} from public.${t} order by 1, 2`) };
  }
  return out;
}
// Server-stamped bookkeeping a migration's own UPDATE may move (revision triggers; `updated_by` becomes null because
// a migration has no signed-in user): never content, and none of it decides access. Returned per table so the report
// can say exactly what moved.
const BOOKKEEPING = new Set(["rev", "change_seq", "server_updated_at", "updated_at", "updated_by"]);
async function snapshotSame(before) {
  const moved = {};
  for (const t of TABLES) {
    const rows = await q(`select ${before[t].cols.map(c => `"${c}"`).join(",")} from public.${t} order by 1, 2`);
    assert.equal(rows.length, before[t].rows.length, `${t}: row count`);
    rows.forEach((row, i) => {
      for (const c of before[t].cols) {
        if (JSON.stringify(row[c]) === JSON.stringify(before[t].rows[i][c])) continue;
        assert.ok(BOOKKEEPING.has(c), `${t}.${c} changed: ${JSON.stringify(before[t].rows[i][c])} → ${JSON.stringify(row[c])}`);
        (moved[t] ??= new Set()).add(c);
      }
    });
  }
  return Object.fromEntries(Object.entries(moved).map(([t, cols]) => [t, [...cols]]));
}
const applied = async () => (await q(`select version from supabase_migrations.schema_migrations order by version`)).map(r => r.version);

try {
  const pre = await applied();
  assert.equal(pre.at(-1), LAST_PRE_SHARING, `the stack must have only the pre-sharing migrations (latest is ${pre.at(-1)})`);
  console.log(`start: ${pre.length} migrations, latest ${pre.at(-1)}`);
  // Later migrations into the workdir (for a copy of supabase/; a no-op for the repository itself).
  for (const f of readdirSync(path.join(ROOT, "supabase/migrations"))) {
    const dest = path.join(workdir, "supabase/migrations", f);
    if (!existsSync(dest)) copyFileSync(path.join(ROOT, "supabase/migrations", f), dest);
  }

  const A = await user("a"), B = await user("b"), C = await user("c");
  const fa = await family(A, "Ahn"), fb = await family(B, "Brooks");
  ok(await service.from("profiles").upsert([{ user_id: A.id, display_name: "Ahn" }, { user_id: C.id, display_name: "Chen" }]), "profiles");
  const before = await snapshot();
  console.log(`seeded: ${Object.entries(before).map(([t, s]) => `${t} ${s.rows.length}`).join(", ")}`);

  await check("Backfill refusal on upgrade: a family with a child and no member makes `migration up` fail and roll back completely", async () => {
    const [orphan] = await q(`insert into public.families (name) values ('orphan') returning id`);
    await q(`insert into public.children (family_id, id, first) values ($1, 'c-orphan', 'Orphan')`, [orphan.id]);
    try {
      let output = null;
      try { cli("migration", "up", "--local"); } catch (e) { output = `${e.stdout}${e.stderr}`; }
      assert.ok(output !== null, "migration up must fail");
      assert.match(output, /child ownership is unclear in 1 famil/);
      assert.equal((await applied()).at(-1), LAST_PRE_SHARING, "no later migration recorded");
      assert.equal((await q(`select to_regclass('public.child_memberships') as t`))[0].t, null, "child_memberships not created");
    } finally {
      await q(`delete from public.families where id = $1`, [orphan.id]);
    }
  });

  await check("Upgrade: every remaining migration applies, in order", async () => {
    cli("migration", "up", "--local");
    const after = await applied();
    const files = readdirSync(path.join(ROOT, "supabase/migrations")).map(f => f.split("_")[0]).sort();
    assert.deepEqual(after, files, "applied versions equal the migration files, in order");
  });

  await check("Existing data unchanged: every row of every table, on its pre-upgrade columns (only sync bookkeeping may move)", async () => {
    const moved = await snapshotSame(before);
    console.log(`      bookkeeping moved: ${JSON.stringify(moved)}`);
    // The kept-version backfill (20261101000200) is an UPDATE: those rows' revision columns and their families'
    // change counter move. Devices never pull record_versions, so nothing is downloaded again because of it.
    for (const t of Object.keys(moved)) assert.ok(["record_versions", "families"].includes(t), `unexpected bookkeeping change in ${t}`);
  });

  await check("Every child, soft-deleted ones too, has exactly one owner: its family's parent", async () => {
    const rows = await q(`select c.family_id, c.id, c.deleted_at is not null as deleted, array_agg(m.user_id) filter (where m.role = 'owner') as owners, count(m.*) as members
      from public.children c left join public.child_memberships m on m.family_id = c.family_id and m.child_id = c.id
      where c.family_id = any($1) group by 1, 2, 3`, [[fa.fid, fb.fid]]);
    assert.equal(rows.length, 4);
    for (const r of rows) {
      assert.equal(Number(r.members), 1, `${r.id}: one membership`);
      assert.deepEqual(r.owners, [r.family_id === fa.fid ? A.id : B.id], `${r.id}: owned by its parent`);
    }
    assert.ok(rows.some(r => r.deleted), "the soft-deleted child is included");
    const bad = await q(`select c.family_id, c.id from public.children c where (select count(*) from public.child_memberships m where m.family_id = c.family_id and m.child_id = c.id and m.role = 'owner') <> 1`);
    assert.deepEqual(bad, [], "no child in the database without exactly one owner");
  });

  await check("Kept versions got their child (backfill): a Moment's version → its child; a child's version → itself", async () => {
    const rows = await q(`select table_name, record_id, child_id from public.record_versions where family_id = $1 order by table_name`, [fa.fid]);
    assert.deepEqual(rows.map(r => [r.table_name, r.child_id]), [["children", "emma"], ["entries", "emma"]]);
  });

  await check("Each parent still reads exactly their own family (same ids `emma`/`m-1` in both), photos included", async () => {
    for (const [u, f, other] of [[A, fa, fb], [B, fb, fa]]) {
      const kids = ok(await u.client.from("children").select("family_id,id"), "children");
      assert.deepEqual(kids.map(k => `${k.family_id === f.fid ? "own" : "other"}:${k.id}`).sort(), ["own:c-second", "own:emma"]);
      const moments = ok(await u.client.from("entries").select("family_id,id"), "entries");
      assert.ok(moments.every(m => m.family_id === f.fid) && moments.length === 2);
      const file = await u.client.storage.from("family-photos").download(`${f.fid}/${f.photoId}.png`);
      assert.ok(!file.error, "own photo file");
      assert.equal(sha(Buffer.from(await file.data.arrayBuffer())), sha(PNG));
      assert.ok((await u.client.storage.from("family-photos").download(`${other.fid}/${other.photoId}.png`)).error, "the other family's photo is refused");
      ok(await u.client.from("entries").update({ text: `${u === A ? "Ahn" : "Brooks"}: edited after the upgrade` }).eq("family_id", f.fid).eq("id", "m-1"), "edit after upgrade");
    }
  });

  await check("Sharing on upgraded data: Ahn invites Chen to Emma; Chen sees Emma, her Moment and photo, never the soft-deleted child; removal ends it", async () => {
    const [inv] = ok(await A.client.rpc("create_invitation", { p_family_id: fa.fid, p_child_id: "emma", p_role: "viewer" }), "create_invitation");
    const [acc] = ok(await C.client.rpc("accept_invitation", { p_token: inv.token }), "accept");
    assert.equal(acc.status, "ok");
    const kids = ok(await C.client.from("children").select("family_id,id"), "children");
    assert.deepEqual(kids.map(k => k.id), ["emma"], "only the shared child");
    assert.equal(kids[0].family_id, fa.fid);
    const moments = ok(await C.client.from("entries").select("id,child_id").eq("family_id", fa.fid), "entries");
    assert.deepEqual(moments.map(m => m.id), ["m-1"]);
    assert.ok(!(await C.client.storage.from("family-photos").download(`${fa.fid}/${fa.photoId}.png`)).error, "photo shown by Emma's Moment");
    assert.ok((await C.client.storage.from("family-photos").download(`${fb.fid}/${fb.photoId}.png`)).error, "nothing of the Brooks family");
    const { error: write } = await C.client.from("entries").update({ text: "viewer" }).eq("family_id", fa.fid).eq("id", "m-1").select();
    const still = (await q(`select text from public.entries where family_id = $1 and id = 'm-1'`, [fa.fid]))[0].text;
    assert.notEqual(still, "viewer", `a viewer can't edit (${write?.message ?? "no row changed"})`);
    const circle = ok(await C.client.rpc("child_circle", { p_family_id: fa.fid, p_child_id: "emma" }), "circle");
    assert.deepEqual(circle.map(p => p.display_name).sort(), ["Ahn", "Chen"]);
    ok(await A.client.rpc("remove_member", { p_family_id: fa.fid, p_child_id: "emma", p_user_id: C.id }), "remove");
    assert.deepEqual(ok(await C.client.from("children").select("id"), "children"), [], "access ends at once");
    assert.ok((await C.client.storage.from("family-photos").download(`${fa.fid}/${fa.photoId}.png`)).error, "photo access ends too");
  });

  await check("Ownership on upgraded data: the owner's membership can't be removed or demoted, even by the server", async () => {
    await assert.rejects(q(`delete from public.child_memberships where family_id = $1 and child_id = 'emma' and role = 'owner'`, [fa.fid]), /owner/i);
    await assert.rejects(q(`update public.child_memberships set role = 'editor' where family_id = $1 and child_id = 'emma' and role = 'owner'`, [fa.fid]), /owner/i);
  });
} catch (e) {
  results.push(["FAIL", "(set-up)"]);
  console.log(`FAIL  (set-up) ${e.stack}`);
} finally {
  await db.end();
}
const failed = results.filter(r => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
