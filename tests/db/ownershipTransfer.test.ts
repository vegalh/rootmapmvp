// Ownership transfer, Shared Child Profiles Phase 5 (docs/shared-child-profiles-phase5.md, migration
// 20261103000200_ownership_transfer.sql), straight to the API with each person's own session.
//
// O owns each child below (one per group, so groups don't affect each other). Ed and Ed2 have Add & Edit, Vw has View
// Only, Out has nothing; memberships are seeded directly, as an accepted invitation would leave them.
//
// Synthetic accounts only, against the local Supabase stack (helpers.ts refuses anything else).

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { must, newParent, serviceClient } from "./helpers.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
type Offer = { id: string; family_id: string; child_id: string; child_first: string; to_user: string | null; incoming: boolean };

let O: Parent, Ed: Parent, Ed2: Parent, Vw: Parent, Out: Parent;
let F: string;

const svc = () => serviceClient();
const newChild = async (id: string) => {
  must(await O.client.from("children").insert({ family_id: F, id, first: id }));
  must(await svc().from("child_memberships").insert([
    { family_id: F, child_id: id, user_id: Ed.id, role: "editor" },
    { family_id: F, child_id: id, user_id: Ed2.id, role: "editor" },
    { family_id: F, child_id: id, user_id: Vw.id, role: "viewer" },
  ]));
};
const offer = (who: Parent, childId: string, to: string) =>
  who.client.rpc("offer_ownership_transfer", { p_family_id: F, p_child_id: childId, p_to_user: to }) as unknown as Promise<{ data: string | null; error: { code?: string } | null }>;
const accept = (who: Parent, id: string) => who.client.rpc("accept_ownership_transfer", { p_id: id }) as unknown as Promise<{ data: string | null; error: { code?: string } | null }>;
const roles = async (childId: string) => {
  const rows = must(await svc().from("child_memberships").select("user_id, role").eq("family_id", F).eq("child_id", childId)) as { user_id: string; role: string }[];
  return Object.fromEntries(rows.map(r => [r.user_id, r.role]));
};
const offers = async (who: Parent) => must(await who.client.rpc("ownership_transfers")) as Offer[];

before(async () => {
  [O, Ed, Ed2, Vw, Out] = await Promise.all([newParent("ot-o"), newParent("ot-ed"), newParent("ot-ed2"), newParent("ot-vw"), newParent("ot-out")]);
  F = O.familyId;
});

describe("offering", () => {
  before(() => newChild("t-offer"));

  it("only the owner can offer, and only to someone with Add & Edit", async () => {
    for (const who of [Ed, Vw, Out]) assert.equal((await offer(who, "t-offer", Ed2.id)).error?.code, "42501", "not the owner");
    assert.equal((await offer(O, "t-offer", Vw.id)).error?.code, "22023", "a viewer");
    assert.equal((await offer(O, "t-offer", Out.id)).error?.code, "22023", "not in the circle");
    assert.equal((await offer(O, "t-offer", O.id)).error?.code, "22023", "themself");
    assert.equal((await offer(O, "no-such-child", Ed.id)).error?.code, "42501");
  });

  it("an offer changes nothing until it is accepted; offering again is the same offer; a second recipient is refused", async () => {
    const id = must(await offer(O, "t-offer", Ed.id)) as string;
    assert.equal(must(await offer(O, "t-offer", Ed.id)), id, "a double tap makes one offer");
    assert.equal((await offer(O, "t-offer", Ed2.id)).error?.code, "55000", "one pending offer per child");
    assert.equal((await roles("t-offer"))[O.id], "owner");
    assert.ok((await offers(O)).some(o => o.id === id && !o.incoming && o.to_user === Ed.id));
    assert.ok((await offers(Ed)).some(o => o.id === id && o.incoming && o.child_first === "t-offer"));
    assert.deepEqual(await offers(Ed2), [], "nobody else sees it");
    assert.deepEqual(await offers(Out), []);
  });

  it("clients can't read or write the transfers table directly", async () => {
    const read = await Ed.client.from("child_ownership_transfers").select("id");
    assert.ok(read.error || read.data?.length === 0);
    const write = await Ed.client.from("child_ownership_transfers").insert({ family_id: F, child_id: "t-offer", from_user: O.id, to_user: Ed.id });
    assert.ok(write.error);
  });
});

describe("accepting", () => {
  let id: string;
  before(async () => {
    await newChild("t-accept");
    id = must(await offer(O, "t-accept", Ed.id)) as string;
  });

  it("only the recipient can accept", async () => {
    for (const who of [O, Ed2, Vw, Out]) assert.equal((await accept(who, id)).error?.code, "42501");
    assert.equal((await roles("t-accept"))[O.id], "owner");
  });

  it("the recipient becomes the owner and the previous owner Add & Edit, with exactly one owner", async () => {
    assert.equal(must(await accept(Ed, id)), "ok");
    const r = await roles("t-accept");
    assert.equal(r[Ed.id], "owner");
    assert.equal(r[O.id], "editor");
    assert.equal(Object.values(r).filter(x => x === "owner").length, 1);
    assert.equal(must(await accept(Ed, id)), "accepted", "a second tap changes nothing");
  });

  it("the server enforces the new roles", async () => {
    const old = await O.client.from("children").update({ first: "Renamed by O" }).eq("family_id", F).eq("id", "t-accept").select("id");
    assert.ok(old.error || old.data?.length === 0, "the previous owner can no longer change the child");
    must(await Ed.client.from("children").update({ first: "Renamed" }).eq("family_id", F).eq("id", "t-accept"));
    assert.equal((await O.client.rpc("list_invitations", { p_family_id: F, p_child_id: "t-accept" })).error?.code, "42501");
    must(await Ed.client.rpc("list_invitations", { p_family_id: F, p_child_id: "t-accept" }));
    must(await O.client.from("entries").insert({ family_id: F, id: "t-accept-m", child_id: "t-accept", date: "2026-11-03", text: "still adds Moments" }));
  });

  it("the previous owner's family stays in the circle", async () => {
    assert.equal((await Ed.client.rpc("remove_member", { p_family_id: F, p_child_id: "t-accept", p_user_id: O.id })).error?.code, "42501");
    assert.equal((await O.client.rpc("leave_circle", { p_family_id: F, p_child_id: "t-accept" })).error?.code, "42501");
    must(await Ed.client.rpc("set_member_role", { p_family_id: F, p_child_id: "t-accept", p_user_id: O.id, p_role: "viewer" }));
    assert.equal((await roles("t-accept"))[O.id], "viewer");
  });

  it("the new owner can hand it back", async () => {
    must(await Ed.client.rpc("set_member_role", { p_family_id: F, p_child_id: "t-accept", p_user_id: O.id, p_role: "editor" }));
    const back = must(await Ed.client.rpc("offer_ownership_transfer", { p_family_id: F, p_child_id: "t-accept", p_to_user: O.id })) as string;
    assert.equal(must(await accept(O, back)), "ok");
    assert.equal((await roles("t-accept"))[O.id], "owner");
  });
});

describe("cancelled, declined, expired and stale offers can't be accepted", () => {
  before(() => Promise.all(["t-cancel", "t-decline", "t-expire", "t-stale", "t-gone"].map(newChild)));

  it("the owner cancels; nobody else can", async () => {
    const id = must(await offer(O, "t-cancel", Ed.id)) as string;
    assert.equal((await Ed.client.rpc("cancel_ownership_transfer", { p_id: id })).error?.code, "42501");
    must(await O.client.rpc("cancel_ownership_transfer", { p_id: id }));
    must(await O.client.rpc("cancel_ownership_transfer", { p_id: id }));
    assert.equal(must(await accept(Ed, id)), "canceled");
    assert.equal((await roles("t-cancel"))[O.id], "owner");
    assert.ok(must(await offer(O, "t-cancel", Ed2.id)), "a new offer can follow");
  });

  it("the recipient declines", async () => {
    const id = must(await offer(O, "t-decline", Ed.id)) as string;
    must(await Ed.client.rpc("decline_ownership_transfer", { p_id: id }));
    assert.equal(must(await accept(Ed, id)), "declined");
  });

  it("after 7 days", async () => {
    const id = must(await offer(O, "t-expire", Ed.id)) as string;
    must(await svc().from("child_ownership_transfers").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id));
    assert.ok(!(await offers(Ed)).some(o => o.id === id), "not listed");
    assert.equal(must(await accept(Ed, id)), "expired");
    assert.equal((await roles("t-expire"))[O.id], "owner");
  });

  it("once the recipient no longer has Add & Edit", async () => {
    const id = must(await offer(O, "t-stale", Ed.id)) as string;
    must(await O.client.rpc("set_member_role", { p_family_id: F, p_child_id: "t-stale", p_user_id: Ed.id, p_role: "viewer" }));
    assert.ok(!(await offers(Ed)).some(o => o.id === id), "not listed");
    assert.equal(must(await accept(Ed, id)), "stale");
    must(await O.client.rpc("set_member_role", { p_family_id: F, p_child_id: "t-stale", p_user_id: Ed.id, p_role: "editor" }));
    assert.equal(must(await accept(Ed, id)), "stale", "stays stale");
    assert.equal((await roles("t-stale"))[O.id], "owner");
  });

  it("once the profile is deleted", async () => {
    const id = must(await offer(O, "t-gone", Ed.id)) as string;
    must(await O.client.from("children").update({ deleted_at: new Date().toISOString() }).eq("family_id", F).eq("id", "t-gone"));
    assert.equal(must(await accept(Ed, id)), "stale");
    assert.equal((await roles("t-gone"))[O.id], "owner");
  });
});
