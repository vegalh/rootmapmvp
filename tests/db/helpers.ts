// Shared helpers for the database tests (tests/db). They run against the local Supabase stack only
// (`npm run db:start`), never against staging or production: connection details come from
// `supabase status` at run time and are refused unless they point at this machine. No keys live in the repo.

import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";

type Env = { url: string; anonKey: string; serviceKey: string; dbUrl: string };

let env: Env | undefined;

export function localEnv(): Env {
  if (env) return env;
  let status: Record<string, string>;
  try {
    status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch (e) {
    throw new Error("The local Supabase stack is not running. Start it with `npm run db:start` (needs Docker).\n" + String(e));
  }
  const next = {
    url: status.API_URL,
    anonKey: status.ANON_KEY ?? status.PUBLISHABLE_KEY,
    serviceKey: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
    dbUrl: status.DB_URL,
  };
  for (const [name, value] of Object.entries(next)) if (!value) throw new Error(`supabase status did not report ${name}`);
  const local = (u: string) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(u).hostname);
  if (!local(next.url) || !local(next.dbUrl)) throw new Error(`Refusing to run database tests against a non-local stack (${next.url})`);
  env = next;
  return env;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

// Service-role client: plays the server (Edge Functions, jobs). Never used by app code.
export const serviceClient = () => createClient(localEnv().url, localEnv().serviceKey, noSession);
// A client with the publishable key and no session.
export const anonClient = () => createClient(localEnv().url, localEnv().anonKey, noSession);

export type TestUser = { client: SupabaseClient; id: string; email: string; password: string };

// A confirmed test user, signed in on its own client (the same API path the app will use).
export async function newUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await serviceClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  const client = createClient(localEnv().url, localEnv().anonKey, noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { client, id: data.user.id, email, password };
}

// A second signed-in client for the same user: a second device.
export async function secondDevice(user: TestUser): Promise<SupabaseClient> {
  const client = createClient(localEnv().url, localEnv().anonKey, noSession);
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}

export async function newFamily(user: TestUser, name = "Test family"): Promise<string> {
  const { data, error } = await user.client.rpc("create_family", { family_name: name });
  if (error) throw error;
  return data as string;
}

// A signed-in user with their own family.
export async function newParent(label: string) {
  const user = await newUser(label);
  return { ...user, familyId: await newFamily(user, label) };
}

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const newPhotoId = () => `photo-${randomUUID()}`;

// Throws with the PostgREST message, so a failed setup step fails the test loudly. Returns `any` on purpose:
// the tests state the row shape they expect at each call.
export function must(res: { data?: unknown; error: unknown }): any {
  if (res.error) throw new Error(`Unexpected error: ${JSON.stringify(res.error)}`);
  return res.data;
}

// --- Direct database connections (for transactions held open across statements) ---

export async function dbConnection(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: localEnv().dbUrl });
  await c.connect();
  return c;
}

// Makes the current transaction act as a signed-in user, exactly as PostgREST does for each request.
export async function actAs(c: pg.Client, userId: string) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

// Runs one statement as a user in its own short transaction.
export async function queryAs<R extends pg.QueryResultRow = pg.QueryResultRow>(c: pg.Client, userId: string, sql: string, params: unknown[] = []) {
  await c.query("begin");
  try {
    await actAs(c, userId);
    const res = await c.query<R>(sql, params);
    await c.query("commit");
    return res;
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

// Resolves once the backend `pid` is waiting for a lock, so tests can order transactions deterministically.
export async function waitUntilBlocked(monitor: pg.Client, pid: number, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { rows } = await monitor.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`backend ${pid} did not block within ${timeoutMs} ms`);
}

// --- Reference pull algorithm (docs/data-architecture-phase2.md section 5.2) ---
// The Phase 2B-2 sync client implements the same loop; these tests pin down its correctness.

export type PulledRow = { id: string; rev: number; change_seq: number; [k: string]: unknown };

export async function pullPage(client: SupabaseClient, table: string, familyId: string, cursor: number, limit = 500): Promise<PulledRow[]> {
  const { data, error } = await client.from(table).select("*").eq("family_id", familyId).gt("change_seq", cursor).order("change_seq").limit(limit);
  if (error) throw error;
  return data as PulledRow[];
}

// Applies rows idempotently: keeps the highest rev seen per id (a row may arrive more than once).
export function applyRows(store: Map<string, PulledRow>, rows: PulledRow[]) {
  for (const r of rows) {
    const have = store.get(r.id);
    if (!have || r.rev > have.rev) store.set(r.id, r);
  }
}

// Whether a device whose cursor is `cursor` must re-download everything (tombstones it never saw were purged).
export async function needsFullResync(client: SupabaseClient, familyId: string, cursor: number): Promise<boolean> {
  const { data, error } = await client.from("families").select("purged_through_seq").eq("id", familyId).single();
  if (error) throw error;
  return cursor < Number(data.purged_through_seq);
}
