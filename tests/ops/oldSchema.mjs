// The current app against the pre-sharing database (docs/shared-child-profiles-pr-readiness.md, "Final Pre-Merge
// Verification"). The public website talks to a database that has only the migrations up to 20261027000200; this
// checks that the app, with sharing off, still works there and never asks for anything the sharing migrations add.
//
// Runs the cloud browser suites that don't need sharing (cloud, spaces, sync, guestImport, analytics, flags) against
// the stack, with every request to it logged (RM_REQUEST_LOG, tests/e2e/cloudkit.mjs), then checks the log: no
// sharing table or function was called, and no write to photos or record_versions sent `child_id` (columns the
// sharing migrations add). Requests the server refused are listed for review.
//
// Usage (disposable LOCAL stack only; refused for anything not on this machine):
//   node tests/ops/oldSchema.mjs
// The stack is the one `supabase status` reports for this repository (as for the browser suites), and must have ONLY
// the pre-sharing migrations: on a throwaway CI runner, after `supabase db reset --local --version 20261027000200`.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const LAST_PRE_SHARING = "20261027000200";
const SUITES = ["cloud", "spaces", "sync", "guestImport", "analytics", "flags"];
// Everything the sharing migrations add that a client could call.
const SHARING_TABLES = ["child_memberships", "child_invitations"];
const SHARING_RPCS = ["create_invitation", "list_invitations", "revoke_invitation", "get_invitation_preview", "accept_invitation",
  "set_member_role", "remove_member", "leave_circle", "child_circle", "set_circle_relationship", "circle_joins", "dismiss_circle_joins", "entry_people"];
const NEW_COLUMNS = { photos: ["child_id"], record_versions: ["child_id"], entries: ["created_by"] };

const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
for (const u of [status.API_URL, status.DB_URL]) if (!["127.0.0.1", "localhost"].includes(new URL(u).hostname)) throw new Error(`refusing non-local stack ${u}`);

// The stack must be the old schema, or this proves nothing.
const db = new pg.Client({ connectionString: status.DB_URL });
await db.connect();
const versions = (await db.query("select version from supabase_migrations.schema_migrations order by version")).rows.map(r => r.version);
const leftovers = (await db.query(
  `select table_name as name from information_schema.tables where table_schema = 'public' and table_name = any($1)
   union all select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($2)
   union all select table_name || '.' || column_name from information_schema.columns where table_schema = 'public' and column_name = 'child_id' and table_name in ('photos', 'record_versions')`,
  [SHARING_TABLES, SHARING_RPCS])).rows.map(r => r.name);
await db.end();
if (versions.at(-1) !== LAST_PRE_SHARING || versions.some(v => v > LAST_PRE_SHARING) || leftovers.length) {
  throw new Error(`not the pre-sharing schema: last migration ${versions.at(-1)}, sharing objects present: ${leftovers.join(", ") || "none"}`);
}
console.log(`Pre-sharing schema: ${versions.length} migrations, last ${versions.at(-1)}; no sharing table, function or column.\n`);

const log = path.join(mkdtempSync(path.join(tmpdir(), "rootmap-oldschema-")), "requests.jsonl");
const failed = [];
for (const suite of SUITES) {
  console.log(`---- ${suite}.mjs`);
  const run = spawnSync("node", [path.join(ROOT, "tests/e2e", `${suite}.mjs`)], { cwd: ROOT, stdio: "inherit", env: { ...process.env, RM_REQUEST_LOG: log } });
  if (run.status !== 0) failed.push(suite);
}

const lines = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
const statusOf = new Map(lines.filter(l => !l.path).map(l => [l.id, l.status]));
const requests = lines.filter(l => l.path).map(r => ({ ...r, status: statusOf.get(r.id) ?? "no response" }));
const results = [];
const check = (name, fn) => {
  try { fn(); results.push(["PASS", name]); console.log(`PASS  ${name}`); }
  catch (e) { results.push(["FAIL", name]); console.log(`FAIL  ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); }
};
console.log(`\n---- request log: ${requests.length} requests to the stack`);
check("every suite passed", () => assert.deepEqual(failed, []));
check("requests were logged from every suite", () => assert.deepEqual(SUITES.filter(s => !requests.some(r => r.suite === `${s}.mjs`)), []));
check("no sharing table or function was called", () => {
  const sharing = requests.filter(r => SHARING_TABLES.some(t => r.path === `/rest/v1/${t}`) || SHARING_RPCS.some(f => r.path === `/rest/v1/rpc/${f}`));
  assert.deepEqual(sharing.map(r => `${r.suite} ${r.method} ${r.path}`), []);
});
check("no write sent a column the sharing migrations add", () => {
  const bad = requests.filter(r => Object.entries(NEW_COLUMNS).some(([t, cols]) => r.path === `/rest/v1/${t}` && r.fields?.some(f => cols.includes(f))));
  assert.deepEqual(bad.map(r => `${r.suite} ${r.method} ${r.path} ${r.fields}`), []);
});

// For review: what the server refused or couldn't serve, by endpoint (the suites also expect some: wrong codes, a
// refused admin page, a request made offline).
const refused = new Map();
for (const r of requests.filter(r => typeof r.status !== "number" || r.status >= 400)) {
  const key = `${r.method} ${r.path} → ${r.status}`;
  refused.set(key, [...new Set([...(refused.get(key) ?? []), r.suite])]);
}
console.log("\nRefused or failed requests (for review):");
for (const [key, suites] of [...refused].sort()) console.log(`  ${key}  (${suites.join(", ")})`);
if (!refused.size) console.log("  none");
const endpoints = [...new Set(requests.map(r => `${r.method} ${r.path.replace(/^(\/storage\/v1\/object\/(?:\w+\/)?family-photos\/).*/, "$1…")}`))].sort();
console.log(`\nEndpoints called (${endpoints.length}):\n  ${endpoints.join("\n  ")}`);
console.log(`\nRequest log: ${log}`);

const failures = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
process.exit(failures.length ? 1 : 0);
