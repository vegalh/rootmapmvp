// Usage analytics (supabase/migrations/20261027000100_usage_analytics.sql) against the local stack: the anonymous
// and signed-in write path (record_usage), its validation, de-duplication and limits; what the behaviour tables can
// hold; admin-only access to the summary; small-number suppression; whole-year ages with deleted and demo children
// left out. The local database keeps data between runs, so summary checks compare before and after.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient, dbConnection, must, newParent, newUser } from "./helpers.ts";

type Batch = Record<string, unknown>;
let db: pg.Client;
let today: string;

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const guestBatch = (over: Batch = {}): Batch => ({
  v: 1, batch_id: randomUUID(), day: today, guest_id: randomUUID(),
  events: [{ feature: "discover.activities", kind: "impression", count: 2 }, { feature: "discover.activities", kind: "click", count: 1 }],
  seconds: 30, ...over,
});
const send = (client: SupabaseClient, batch: unknown) => client.rpc("record_usage", { batch });
const code = async (p: PromiseLike<{ error: { code?: string } | null }>) => (await p).error?.code ?? null;
const hash = (guestId: string) => createHash("sha256").update(`rootmap-guest:${guestId}`).digest();
const counts = async (day: string, feature: string, audience: string) =>
  Object.fromEntries((await db.query("select kind, count from private.usage_counts where day = $1 and feature = $2 and audience = $3", [day, feature, audience])).rows.map(r => [r.kind, Number(r.count)]));

before(async () => {
  db = await dbConnection();
  today = (await db.query("select current_date::text d")).rows[0].d;
});
after(async () => { await db.end(); });

describe("anonymous guest usage", () => {
  it("a guest's batch is added to the day's totals; only a hash of the guest id is kept", async () => {
    const day = shift(today, -1);
    const before = await counts(day, "discover.books", "guest");
    const guestId = randomUUID();
    assert.equal(await code(send(anonClient(), guestBatch({ day, guest_id: guestId, events: [{ feature: "discover.books", kind: "impression", count: 4 }, { feature: "discover.books", kind: "click", count: 3 }] }))), null);
    const now = await counts(day, "discover.books", "guest");
    assert.equal((now.impression ?? 0) - (before.impression ?? 0), 4);
    assert.equal((now.click ?? 0) - (before.click ?? 0), 3);
    const row = (await db.query("select batches, events, seconds from private.guest_days where guest_hash = $1 and day = $2", [hash(guestId), day])).rows[0];
    assert.deepEqual(row, { batches: 1, events: 7, seconds: 30 });
    const raw = await db.query("select 1 from private.guest_days where encode(guest_hash, 'escape') like $1", [`%${guestId}%`]);
    assert.equal(raw.rowCount, 0);
  });

  it("a retried batch (same batch_id) is counted once", async () => {
    const guestId = randomUUID();
    const b = guestBatch({ guest_id: guestId, events: [{ feature: "music.play", kind: "click", count: 5 }], seconds: 0 });
    const before = await counts(today, "music.play", "guest");
    for (let i = 0; i < 3; i++) assert.equal(await code(send(anonClient(), b)), null);
    const now = await counts(today, "music.play", "guest");
    assert.equal((now.click ?? 0) - (before.click ?? 0), 5);
    const row = (await db.query("select batches from private.guest_days where guest_hash = $1", [hash(guestId)])).rows[0];
    assert.equal(row.batches, 1);
  });

  it("refuses extra, personal or malformed fields (22023), writing nothing", async () => {
    const bad: [string, unknown][] = [
      ["email at top level", guestBatch({ email: "parent@example.com" })],
      ["family id", guestBatch({ family_id: randomUUID() })],
      ["exact timestamp", guestBatch({ at: new Date().toISOString() })],
      ["timestamp as the day", guestBatch({ day: new Date().toISOString() })],
      ["child id on an event", guestBatch({ events: [{ feature: "today.inspiration", kind: "click", count: 1, childId: "maya" }] })],
      ["free text on an event", guestBatch({ events: [{ feature: "today.inspiration", kind: "click", count: 1, note: "hello" }] })],
      ["unknown feature", guestBatch({ events: [{ feature: "journal.text", kind: "click", count: 1 }] })],
      ["unknown kind", guestBatch({ events: [{ feature: "today.inspiration", kind: "view", count: 1 }] })],
      ["count 0", guestBatch({ events: [{ feature: "today.inspiration", kind: "click", count: 0 }] })],
      ["count 501", guestBatch({ events: [{ feature: "today.inspiration", kind: "click", count: 501 }] })],
      ["fractional count", guestBatch({ events: [{ feature: "today.inspiration", kind: "click", count: 1.5 }] })],
      ["count as a string", guestBatch({ events: [{ feature: "today.inspiration", kind: "click", count: "1" }] })],
      ["duplicate event", guestBatch({ events: [{ feature: "today.inspiration", kind: "click", count: 1 }, { feature: "today.inspiration", kind: "click", count: 1 }] })],
      ["seconds over 12 hours", guestBatch({ seconds: 43201 })],
      ["negative seconds", guestBatch({ seconds: -1 })],
      ["no guest id", (() => { const b = guestBatch(); delete b.guest_id; return b; })()],
      ["guest id not a uuid", guestBatch({ guest_id: "parent@example.com" })],
      ["wrong version", guestBatch({ v: 2 })],
      ["day too old", guestBatch({ day: shift(today, -8) })],
      ["day in the future", guestBatch({ day: shift(today, 2) })],
      ["empty", guestBatch({ events: [], seconds: 0 })],
      ["an array", [guestBatch()]],
      ["oversized", guestBatch({ events: Array.from({ length: 27 }, () => ({ feature: "today.inspiration", kind: "click", count: 1 })) })],
    ];
    for (const [label, b] of bad) {
      const before = (await db.query("select count(*)::int n from private.usage_batches")).rows[0].n;
      assert.equal(await code(send(anonClient(), b)), "22023", label);
      assert.equal((await db.query("select count(*)::int n from private.usage_batches")).rows[0].n, before, `${label}: nothing written`);
    }
  });

  it("limits each guest per day (54000) and caps a day's seconds at 12 hours", async () => {
    const guestId = randomUUID();
    assert.equal(await code(send(anonClient(), guestBatch({ guest_id: guestId, seconds: 43000 }))), null);
    assert.equal(await code(send(anonClient(), guestBatch({ guest_id: guestId, seconds: 900 }))), null);
    assert.equal((await db.query("select seconds from private.guest_days where guest_hash = $1 and day = $2", [hash(guestId), today])).rows[0].seconds, 43200);

    await db.query("update private.guest_days set batches = 100 where guest_hash = $1 and day = $2", [hash(guestId), today]);
    assert.equal(await code(send(anonClient(), guestBatch({ guest_id: guestId }))), "54000");
    await db.query("update private.guest_days set batches = 2, events = 4999 where guest_hash = $1 and day = $2", [hash(guestId), today]);
    assert.equal(await code(send(anonClient(), guestBatch({ guest_id: guestId }))), "54000", "events per day");
  });

  it("limits new guests per server day; a returning guest still gets through", async () => {
    const returning = randomUUID();
    assert.equal(await code(send(anonClient(), guestBatch({ guest_id: returning, day: shift(today, -2) }))), null);
    const saved = (await db.query("select new_guests from private.usage_limits where day = current_date")).rows[0].new_guests;
    await db.query("update private.usage_limits set new_guests = 10000 where day = current_date");
    try {
      assert.equal(await code(send(anonClient(), guestBatch())), "54000", "a new guest is refused");
      assert.equal(await code(send(anonClient(), guestBatch({ guest_id: returning }))), null, "a guest seen before is not new");
    } finally {
      await db.query("update private.usage_limits set new_guests = $1 where day = current_date", [saved]);
    }
  });
});

describe("signed-in usage", () => {
  it("counts for the account; a guest id is refused so it is never tied to an account", async () => {
    const p = await newParent("usage-account");
    const b = guestBatch({ events: [{ feature: "moments.add", kind: "click", count: 1 }] });
    assert.equal(await code(send(p.client, b)), "22023");
    delete b.guest_id;
    const before = await counts(today, "moments.add", "account");
    assert.equal(await code(send(p.client, b)), null);
    assert.equal(((await counts(today, "moments.add", "account")).click ?? 0) - (before.click ?? 0), 1);
    assert.equal((await db.query("select batches from private.account_days where user_id = $1 and day = $2", [p.id, today])).rows[0].batches, 1);
  });
});

describe("behaviour tables hold no identity", () => {
  it("usage_counts and usage_time have only day, audience, feature, kind and totals", async () => {
    const cols = async (t: string) => (await db.query("select column_name from information_schema.columns where table_schema = 'private' and table_name = $1 order by column_name", [t])).rows.map(r => r.column_name);
    assert.deepEqual(await cols("usage_counts"), ["audience", "count", "day", "feature", "kind"]);
    assert.deepEqual(await cols("usage_time"), ["audience", "day", "seconds"]);
  });
});

describe("admin access", () => {
  let admin: Awaited<ReturnType<typeof newUser>>;
  let parent: Awaited<ReturnType<typeof newParent>>;
  before(async () => {
    [admin, parent] = await Promise.all([newUser("usage-admin"), newParent("usage-parent")]);
    await db.query("insert into private.admins (user_id) values ($1)", [admin.id]);
  });

  it("am_i_admin is true only for an admin; anonymous callers can't ask", async () => {
    assert.equal(must(await admin.client.rpc("am_i_admin")), true);
    assert.equal(must(await parent.client.rpc("am_i_admin")), false);
    assert.ok((await anonClient().rpc("am_i_admin")).error);
  });

  it("a parent or an anonymous caller can't read the summary (even by calling it directly)", async () => {
    assert.equal(await code(parent.client.rpc("admin_usage_summary", { p_days: 7 })), "42501");
    assert.ok((await anonClient().rpc("admin_usage_summary", { p_days: 7 })).error);
  });

  it("no client role can read the underlying tables", async () => {
    for (const t of ["admins", "usage_counts", "usage_time", "account_days", "guest_days", "usage_batches", "usage_limits"]) {
      for (const role of ["anon", "authenticated"]) {
        await db.query("begin");
        try {
          await db.query(`set local role ${role}`);
          await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role })]);
          await assert.rejects(db.query(`select * from private.${t}`), /permission denied/, `${role} ${t}`);
        } finally {
          await db.query("rollback");
        }
      }
    }
    // Not exposed through the API either (only `public` is).
    assert.ok((await admin.client.schema("private" as "public").from("usage_counts").select("*")).error);
  });

  it("only auth.uid() decides: a user id, email or role passed by the client is not accepted", async () => {
    assert.ok((await parent.client.rpc("am_i_admin", { user_id: admin.id })).error, "am_i_admin takes no arguments");
    assert.ok((await parent.client.rpc("admin_usage_summary", { p_days: 7, user_id: admin.id })).error);
    assert.ok((await parent.client.rpc("admin_usage_summary", { p_days: 7, email: admin.email, role: "admin" })).error);
    assert.equal(await code(parent.client.rpc("admin_usage_summary", { p_days: 7 })), "42501");
  });

  it("no client can change the admin list, directly or through the owner's functions", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const sql of [
        ["insert into private.admins (user_id) values ($1)", [parent.id]],
        ["delete from private.admins where user_id = $1", [admin.id]],
        ["select private.grant_admin($1)", [parent.email]],
        ["select private.revoke_admin($1)", [admin.email]],
        ["select * from private.list_admins()", []],
      ] as [string, unknown[]][]) {
        await db.query("begin");
        try {
          await db.query(`set local role ${role}`);
          await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: parent.id, role })]);
          await assert.rejects(db.query(sql[0], sql[1]), /permission denied/, `${role}: ${sql[0]}`);
        } finally {
          await db.query("rollback");
        }
      }
    }
    for (const fn of ["grant_admin", "revoke_admin", "list_admins"]) {
      assert.ok((await parent.client.rpc(fn, { login_email: parent.email })).error, `${fn} is not in the API`);
    }
    assert.equal(must(await parent.client.rpc("am_i_admin")), false);
  });

  it("the owner grants and revokes by login email; revoking ends access on the very next request", async () => {
    const p = await newParent("usage-granted");
    assert.equal(await code(p.client.rpc("admin_usage_summary", { p_days: 7 })), "42501");
    // As the database owner (the SQL editor), case-insensitive.
    const granted = (await db.query("select private.grant_admin($1) id", [p.email.toUpperCase()])).rows[0].id;
    assert.equal(granted, p.id);
    await db.query("select private.grant_admin($1)", [p.email]); // repeating is harmless
    assert.ok((await db.query("select email from private.list_admins()")).rows.some(r => r.email === p.email));
    assert.equal(must(await p.client.rpc("am_i_admin")), true);
    assert.ok(must(await p.client.rpc("admin_usage_summary", { p_days: 7 })).features);

    assert.equal((await db.query("select private.revoke_admin($1) removed", [p.email])).rows[0].removed, true);
    // Same session, no sign-out: refused at once.
    assert.equal(must(await p.client.rpc("am_i_admin")), false);
    assert.equal(await code(p.client.rpc("admin_usage_summary", { p_days: 7 })), "42501");
    assert.equal((await db.query("select private.revoke_admin($1) removed", [p.email])).rows[0].removed, false);
  });

  it("granting needs an existing account: an unknown email is refused, not silently ignored", async () => {
    await assert.rejects(db.query("select private.grant_admin($1)", [`nobody-${randomUUID()}@example.com`]), /no RootMap account signs in with/);
  });

  it("refuses ranges other than 7, 30 or 90 days", async () => {
    assert.equal(await code(admin.client.rpc("admin_usage_summary", { p_days: 365 })), "22023");
  });

  it("returns feature totals over the range, with 1 and 2 suppressed", async () => {
    const read = async () => {
      const s = must(await admin.client.rpc("admin_usage_summary", { p_days: 7 }));
      return s.features.find((f: { feature: string }) => f.feature === "collection.save") ?? { impressions: 0, clicks: 0 };
    };
    // Make sure the totals are already at least 3, so the change below is visible.
    must(await send(anonClient(), guestBatch({ events: [{ feature: "collection.save", kind: "impression", count: 3 }, { feature: "collection.save", kind: "click", count: 3 }], seconds: 0 })));
    const before = await read();
    must(await send(anonClient(), guestBatch({ day: shift(today, -6), events: [{ feature: "collection.save", kind: "impression", count: 10 }, { feature: "collection.save", kind: "click", count: 4 }], seconds: 0 })));
    must(await send(anonClient(), guestBatch({ day: shift(today, -7), events: [{ feature: "collection.save", kind: "impression", count: 50 }], seconds: 0 })));
    const now = await read();
    assert.equal(now.impressions - before.impressions, 10, "a day outside the 7-day range is not counted");
    assert.equal(now.clicks - before.clicks, 4);

    const k = async (n: number) => (await db.query("select private.k($1) v", [n])).rows[0].v;
    assert.deepEqual([await k(0), await k(1), await k(2), await k(3)], ["0", null, null, "3"]);
  });

  it("reports totals, daily people and active weekly / monthly accounts without any identity", async () => {
    const s = must(await admin.client.rpc("admin_usage_summary", { p_days: 30 }));
    assert.equal(s.to, today);
    assert.equal(s.daily.length, 30);
    assert.ok(s.accounts.total === null || s.accounts.total >= 3);
    const text = JSON.stringify(s);
    for (const secret of [admin.email, parent.email, admin.id, parent.id, parent.familyId]) assert.ok(!text.includes(secret));
    for (const d of s.daily) {
      assert.deepEqual(Object.keys(d).sort(), ["accounts", "day", "guests", "people", "seconds"]);
      if (d.people === null || d.people < 3) assert.equal(d.seconds, null, "time is hidden for days with fewer than 3 people");
    }
  });

  it("ages are completed years; deleted and demo children are left out; only age → number is returned", async () => {
    // An age no other test uses, so earlier runs don't change the expected numbers.
    const age = 200 + Math.floor(Math.random() * 700);
    const born = (years: number, days = 0) => shift(`${String(Number(today.slice(0, 4)) - years).padStart(4, "0")}${today.slice(4)}`, days);
    const f = parent.familyId;
    const rows = [
      { id: randomUUID(), dob: born(age) }, // birthday today
      { id: randomUUID(), dob: born(age, -40) },
      { id: randomUUID(), dob: born(age, -200) },
      { id: randomUUID(), dob: born(age, 1) }, // birthday tomorrow: still a year younger
      { id: randomUUID(), dob: born(age), deleted_at: new Date().toISOString() },
      { id: randomUUID(), dob: born(age), origin: "demo" },
    ];
    for (const r of rows) must(await parent.client.from("children").insert({ family_id: f, first: "Test", ...r }));
    const s = must(await admin.client.rpc("admin_usage_summary", { p_days: 7 }));
    const bucket = (a: number) => s.ages.find((x: { age: number }) => x.age === a);
    assert.deepEqual(bucket(age), { age, children: 3 });
    assert.deepEqual(bucket(age - 1), { age: age - 1, children: null }, "one child: shown as <3");
    assert.ok(!JSON.stringify(s.ages).includes("Test"));
  });

  it("whole_years: the day before a birthday, and 29 February", async () => {
    const y = async (dob: string, on: string) => (await db.query("select private.whole_years($1::date, $2::date) v", [dob, on])).rows[0].v;
    assert.equal(await y("2020-10-27", "2026-10-26"), 5);
    assert.equal(await y("2020-10-27", "2026-10-27"), 6);
    assert.equal(await y("2024-02-29", "2025-02-28"), 0);
    assert.equal(await y("2024-02-29", "2025-03-01"), 1);
    assert.equal(await y("2024-02-29", "2028-02-28"), 3);
    assert.equal(await y("2024-02-29", "2028-02-29"), 4);
  });
});
