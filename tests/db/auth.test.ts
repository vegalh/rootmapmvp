// Phase 2B-2 M1: email-code sign-in, session restore and refresh, sign-out, and the first-sign-in family and
// profile, using the app's own code (src/lib/cloud) against the local stack. Codes are read from the stack's test
// inbox (Mailpit), so the whole path a parent takes is exercised, including the email.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ensureAccount, ensureFamily, ensureProfile } from "../../src/lib/cloud/account.ts";
import { SESSION_KEY, authOptions, requestEmailCode, restoreSession, signOut, verifyEmailCode } from "../../src/lib/cloud/auth.ts";
import type { KeyValueStore } from "../../src/lib/platform/index.ts";
import { anonClient, localEnv, localMailUrl, must, serviceClient } from "./helpers.ts";

// The platform session store, in memory: one per simulated device.
class MemStore implements KeyValueStore {
  m = new Map<string, string>();
  async getItem(k: string) { return this.m.get(k) ?? null; }
  async setItem(k: string, v: string) { this.m.set(k, v); }
  async removeItem(k: string) { this.m.delete(k); }
}

type Device = { client: SupabaseClient; store: MemStore };
// A device as the app builds it (same auth options), with its own session store. No timers in tests.
function device(url = localEnv().url, store = new MemStore()): Device {
  const client = createClient(url, localEnv().anonKey, { auth: { ...authOptions(store), autoRefreshToken: false } });
  return { client, store };
}
// An address nothing listens on: an offline device.
const OFFLINE_URL = "http://127.0.0.1:9";

const newEmail = (label: string) => `${label}-${randomUUID()}@example.com`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function inbox(email: string): Promise<{ ID: string }[]> {
  const res = await fetch(`${localMailUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  return (await res.json()).messages ?? [];
}

// Requests a code and returns it from the test inbox.
async function emailedCode(d: Device, email: string): Promise<string> {
  const before = (await inbox(email)).length;
  const sent = await requestEmailCode(d.client, email);
  assert.deepEqual(sent, { ok: true, value: undefined });
  for (let i = 0; i < 100; i++) {
    const messages = await inbox(email);
    if (messages.length > before) {
      const msg = await (await fetch(`${localMailUrl()}/api/v1/message/${messages[0].ID}`)).json();
      const code = String(msg.Text).match(/\b(\d{6})\b/)?.[1];
      assert.ok(code, "the email contains a 6-digit code");
      assert.ok(!/https?:\/\/\S*verify/.test(msg.Text), "the email has no sign-in link");
      return code;
    }
    await sleep(50);
  }
  throw new Error(`no email arrived for ${email}`);
}

// A parent signed in by email code on a fresh device.
async function signedIn(label: string, email = newEmail(label)) {
  const d = device();
  // Codes for one address can be requested at most once a second (auth.email.max_frequency).
  const code = await emailedCode(d, email);
  const result = await verifyEmailCode(d.client, email, code);
  assert.ok(result.ok, `verify failed: ${JSON.stringify(result)}`);
  return { ...d, email, userId: result.value.user.id };
}

const familiesOf = async (userId: string) => must(await serviceClient().from("family_members").select("family_id, role").eq("user_id", userId)) as { family_id: string; role: string }[];
const familiesCreatedBy = async (userId: string) => must(await serviceClient().from("families").select("id").eq("created_by", userId)) as { id: string }[];

describe("email code sign-in", () => {
  it("a new parent gets a code by email, signs in, and the session is kept in the session store", async () => {
    const p = await signedIn("new");
    const stored = JSON.parse(p.store.m.get(SESSION_KEY)!);
    assert.equal(stored.user.id, p.userId);
    assert.equal(stored.user.email, p.email);
    assert.ok(stored.refresh_token);
    const { data } = await serviceClient().auth.admin.getUserById(p.userId);
    assert.equal(data.user?.email, p.email);
  });

  it("the same email signs in to the same account on a second device; both stay signed in", async () => {
    const email = newEmail("returning");
    const a = await signedIn("returning", email);
    await sleep(1100);
    const b = await signedIn("returning", email);
    assert.equal(b.userId, a.userId);
    assert.equal((await a.client.auth.getUser()).data.user?.id, a.userId);
    assert.equal((await b.client.auth.getUser()).data.user?.id, a.userId);
  });

  it("email is case- and space-insensitive", async () => {
    const email = newEmail("case");
    const a = await signedIn("case", email);
    await sleep(1100);
    const d = device();
    const code = await emailedCode(d, `  ${email.toUpperCase()} `);
    const r = await verifyEmailCode(d.client, email.toUpperCase(), code.replace(/(\d{3})/, "$1 "));
    assert.ok(r.ok && r.value.user.id === a.userId);
  });

  it("a wrong code is rejected and leaves no session", async () => {
    const d = device();
    const email = newEmail("wrong");
    const code = await emailedCode(d, email);
    const wrong = code === "000000" ? "111111" : "000000";
    assert.deepEqual(await verifyEmailCode(d.client, email, wrong), { ok: false, failure: "code-rejected" });
    assert.equal(d.store.m.size, 0);
    assert.equal((await d.client.auth.getSession()).data.session, null);
  });

  it("a code works only once", async () => {
    const d = device();
    const email = newEmail("once");
    const code = await emailedCode(d, email);
    assert.ok((await verifyEmailCode(d.client, email, code)).ok);
    const other = device();
    assert.deepEqual(await verifyEmailCode(other.client, email, code), { ok: false, failure: "code-rejected" });
    assert.equal(other.store.m.size, 0);
  });

  it("a code sent to one address does not sign in another", async () => {
    const d = device();
    const email = newEmail("mine");
    const code = await emailedCode(d, email);
    assert.deepEqual(await verifyEmailCode(d.client, newEmail("theirs"), code), { ok: false, failure: "code-rejected" });
  });

  it("malformed emails and codes are refused before anything is sent", async () => {
    const offline = device(OFFLINE_URL);
    for (const email of ["", "parent", "parent@", "a b@example.com"]) assert.deepEqual(await requestEmailCode(offline.client, email), { ok: false, failure: "invalid-email" });
    for (const code of ["", "12345", "1234567", "12a456"]) assert.deepEqual(await verifyEmailCode(offline.client, "p@example.com", code), { ok: false, failure: "invalid-code" });
  });

  it("asking for codes too quickly is rate-limited; an unreachable server reads as offline", async () => {
    const d = device();
    const email = newEmail("rate");
    await emailedCode(d, email);
    assert.deepEqual(await requestEmailCode(d.client, email), { ok: false, failure: "rate-limited" });
    assert.deepEqual(await requestEmailCode(device(OFFLINE_URL).client, email), { ok: false, failure: "offline" });
  });
});

describe("family and profile on first sign-in", () => {
  it("creates exactly one family (owner) and an empty profile; nothing else is written", async () => {
    const p = await signedIn("setup");
    const account = await ensureAccount(p.client);
    assert.equal(account.userId, p.userId);
    assert.equal(account.email, p.email);
    assert.deepEqual(await familiesOf(p.userId), [{ family_id: account.familyId, role: "owner" }]);
    const family = must(await serviceClient().from("families").select("name, change_seq").eq("id", account.familyId).single());
    assert.deepEqual(family, { name: "", change_seq: 0 }, "no family data was written");
    const profile = must(await serviceClient().from("profiles").select("display_name, photo_ref, contact, locale, time_zone").eq("user_id", p.userId).single());
    assert.deepEqual(profile, { display_name: "", photo_ref: null, contact: "", locale: null, time_zone: null }, "no local profile data uploaded");
    const settings = must(await serviceClient().from("user_settings").select("key").eq("user_id", p.userId));
    assert.deepEqual(settings, []);
  });

  it("is idempotent: repeating it, or two devices at once, never makes a second family or changes the profile", async () => {
    const email = newEmail("idem");
    const a = await signedIn("idem", email);
    await sleep(1100);
    const b = await signedIn("idem", email);
    // Both devices set up the account at the same moment.
    const [x, y] = await Promise.all([ensureAccount(a.client), ensureAccount(b.client)]);
    assert.equal(x.familyId, y.familyId);
    must(await a.client.from("profiles").update({ display_name: "Alex" }).eq("user_id", a.userId));
    for (let i = 0; i < 3; i++) assert.equal((await ensureAccount(i % 2 ? a.client : b.client)).familyId, x.familyId);
    assert.equal(await ensureFamily(a.client, a.userId), x.familyId);
    await ensureProfile(b.client, b.userId);
    assert.equal((await familiesOf(a.userId)).length, 1);
    assert.equal((await familiesCreatedBy(a.userId)).length, 1);
    const profile = must(await serviceClient().from("profiles").select("display_name").eq("user_id", a.userId).single());
    assert.equal(profile.display_name, "Alex", "an existing profile is never overwritten");
  });

  it("needs a session", async () => {
    await assert.rejects(ensureAccount(device().client), /session/);
  });
});

describe("session restore and refresh", () => {
  // A copy of a device's stored session, as another fresh client would find it after an app restart.
  const restart = (d: Device, url?: string) => { const store = new MemStore(); store.m = new Map(d.store.m); return device(url, store); };
  const expire = (d: Device) => {
    const s = JSON.parse(d.store.m.get(SESSION_KEY)!);
    d.store.m.set(SESSION_KEY, JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) - 60 }));
  };

  it("a restarted app restores the session and can use it", async () => {
    const p = await signedIn("restore");
    const { familyId } = await ensureAccount(p.client);
    const again = restart(p);
    assert.deepEqual(await restoreSession(again.client, again.store), { status: "signed-in", user: { userId: p.userId, email: p.email }, offline: false });
    assert.equal((await ensureAccount(again.client)).familyId, familyId);
  });

  it("an expired access token is refreshed at start-up and the new session is stored", async () => {
    const p = await signedIn("refresh");
    const before = JSON.parse(p.store.m.get(SESSION_KEY)!);
    const again = restart(p);
    expire(again);
    const r = await restoreSession(again.client, again.store);
    assert.equal(r.status, "signed-in");
    const after = JSON.parse(again.store.m.get(SESSION_KEY)!);
    assert.notEqual(after.access_token, before.access_token);
    assert.notEqual(after.refresh_token, before.refresh_token, "refresh tokens rotate");
    assert.ok(after.expires_at > Date.now() / 1000);
    assert.equal((await again.client.auth.getUser()).data.user?.id, p.userId);
  });

  it("offline with an expired token: still signed in on this device (from the stored session), nothing removed", async () => {
    const p = await signedIn("offline");
    const away = restart(p, OFFLINE_URL);
    expire(away);
    const stored = away.store.m.get(SESSION_KEY);
    assert.deepEqual(await restoreSession(away.client, away.store), { status: "signed-in", user: { userId: p.userId, email: p.email }, offline: true });
    assert.equal(away.store.m.get(SESSION_KEY), stored, "the session is kept for when the server is reachable again");
  });

  it("no stored session, or an unreadable one, is signed out", async () => {
    const d = device();
    assert.deepEqual(await restoreSession(d.client, d.store), { status: "signed-out" });
    d.store.m.set(SESSION_KEY, "{not json");
    assert.deepEqual(await restoreSession(d.client, d.store), { status: "signed-out" });
  });
});

describe("sign-out", () => {
  it("revokes this device's session on the server, removes it from the device, and leaves other devices signed in", async () => {
    const email = newEmail("signout");
    const a = await signedIn("signout", email);
    await sleep(1100);
    const b = await signedIn("signout", email);
    const { familyId } = await ensureAccount(a.client);
    const copy = new MemStore();
    copy.m = new Map(a.store.m);

    assert.deepEqual(await signOut(a.client, a.store), { serverRevoked: true });
    assert.equal(a.store.m.size, 0, "nothing left on the device");
    assert.equal((await a.client.auth.getSession()).data.session, null);
    // Signed out, the client is anonymous: anon has no grants at all, so reads fail outright.
    const read = await a.client.from("families").select("id");
    assert.ok(read.error || (read.data ?? []).length === 0, "signed out: no family data readable");

    // Even a copy of the old session (taken before sign-out) cannot be refreshed: the server revoked it.
    const stolen = device(undefined, copy);
    const s = JSON.parse(copy.m.get(SESSION_KEY)!);
    copy.m.set(SESSION_KEY, JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) - 60 }));
    assert.deepEqual(await restoreSession(stolen.client, stolen.store), { status: "signed-out" });

    // The other device is unaffected.
    assert.equal((await ensureAccount(b.client)).familyId, familyId);
  });

  it("offline: the session is still removed from the device", async () => {
    const p = await signedIn("signout-offline");
    const away = device(OFFLINE_URL, p.store);
    assert.deepEqual(await signOut(away.client, away.store), { serverRevoked: false });
    assert.equal(p.store.m.size, 0);
  });
});

describe("row level security with email-code accounts", () => {
  it("each parent sees only their own family, membership and profile", async () => {
    const [a, b] = await Promise.all([signedIn("rls-a"), signedIn("rls-b")]);
    const [A, B] = await Promise.all([ensureAccount(a.client), ensureAccount(b.client)]);
    assert.notEqual(A.familyId, B.familyId);
    for (const [p, mine] of [[a, A], [b, B]] as const) {
      assert.deepEqual((must(await p.client.from("families").select("id")) as { id: string }[]).map(r => r.id), [mine.familyId]);
      assert.deepEqual((must(await p.client.from("family_members").select("user_id")) as { user_id: string }[]).map(r => r.user_id), [mine.userId]);
      assert.deepEqual((must(await p.client.from("profiles").select("user_id")) as { user_id: string }[]).map(r => r.user_id), [mine.userId]);
    }
    // B cannot create a profile for A, or a family membership at all.
    assert.ok((await b.client.from("profiles").insert({ user_id: A.userId })).error);
    assert.ok((await b.client.from("family_members").insert({ family_id: A.familyId, user_id: B.userId, role: "parent" })).error);
    // B's family setup never reaches A's family, even when handed A's user id: RLS hides A's membership and
    // create_family() refuses B a second family, so it fails instead of returning anything of A's.
    await assert.rejects(ensureFamily(b.client, A.userId), /family/);
    assert.deepEqual(await familiesOf(A.userId), [{ family_id: A.familyId, role: "owner" }]);
  });

  it("without a session nothing is readable and no family can be created", async () => {
    const anon = anonClient();
    for (const t of ["families", "family_members", "profiles"]) assert.deepEqual((await anon.from(t).select("*")).data ?? [], []);
    assert.ok((await anon.rpc("create_family", { family_name: "" })).error);
  });
});
