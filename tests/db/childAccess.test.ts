// Access to child records by child role, Shared Child Profiles Phase 1b (docs/shared-child-profiles-phase1b.md,
// migration 20261101000200_child_access.sql). Every case goes straight to the API with each role's own session, the
// way any client (or attacker) could, not through the app.
//
// The owner O has three children: X (shared: editor Ed, viewer Vw), Z (Ed is also an editor) and Y (shared with no
// one). Out is an outsider. Fm is a second member of O's family with no role on any child: family membership alone
// no longer reaches a child. Memberships are made by the server, as invitations will be later.
//
// Synthetic accounts only, against the local Supabase stack (helpers.ts refuses anything else).

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { newParent, newPhotoId, must, newUser, serviceClient, sha256 } from "./helpers.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
type Res = { data: unknown; error: { code?: string; message?: string } | null };
const BUCKET = "family-photos";
let O: Parent, Ed: Parent, Vw: Parent, Out: Parent, Fm: Awaited<ReturnType<typeof newUser>>;
let F: string; // O's family
const photo: Record<"x" | "y" | "xy" | "loose", { id: string; path: string }> = {} as never;

const svc = () => serviceClient();
const ids = (res: Res) => ((must(res) as { id: string }[]) ?? []).map(r => r.id).sort();
const refused = (res: Res, what: string) => assert.ok(res.error, `${what} should have been refused`);
// An update of rows the caller may not change is refused (error) or matches nothing (RLS hides the row): either way
// nothing changes.
type Updating = { select: () => PromiseLike<Res> };
const refusedUpdate = async (q: Updating, what: string) => {
  const r = await q.select();
  assert.ok(r.error || !(r.data as unknown[] | null)?.length, `${what} should have changed nothing`);
};
const rowsOf = async (table: string, extra: Record<string, string> = {}) => {
  let q = svc().from(table).select("*").eq("family_id", F);
  for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
  return must(await q) as Record<string, unknown>[];
};
const entry = (id: string, child: string, extra: Record<string, unknown> = {}) => ({ family_id: F, id, child_id: child, date: "2026-10-01", text: `about ${child}`, photo_ids: [], ...extra });

async function addPhoto(): Promise<{ id: string; path: string }> {
  const bytes = randomBytes(256);
  const [row] = must(await O.client.from("photos").insert({ family_id: F, id: newPhotoId(), mime_type: "image/jpeg", byte_size: bytes.length, sha256: sha256(bytes) }).select("id, storage_path")) as { id: string; storage_path: string }[];
  must(await O.client.storage.from(BUCKET).upload(row.storage_path, bytes, { contentType: "image/jpeg" }));
  return { id: row.id, path: row.storage_path };
}

before(async () => {
  [O, Ed, Vw, Out, Fm] = await Promise.all([newParent("ca-owner"), newParent("ca-editor"), newParent("ca-viewer"), newParent("ca-out"), newUser("ca-family")]);
  F = O.familyId;
  for (const [id, first] of [["X", "Xia"], ["Y", "Yan"], ["Z", "Zoe"]]) must(await O.client.from("children").insert({ family_id: F, id, first, dob: "2022-01-01" }));
  for (const [user, child, role] of [[Ed.id, "X", "editor"], [Ed.id, "Z", "editor"], [Vw.id, "X", "viewer"]]) {
    must(await svc().from("child_memberships").insert({ family_id: F, child_id: child, user_id: user, role }));
  }
  must(await svc().from("family_members").insert({ family_id: F, user_id: Fm.id, role: "parent" }));

  photo.x = await addPhoto(); photo.y = await addPhoto(); photo.xy = await addPhoto(); photo.loose = await addPhoto();
  // A Moment about X and Y is one entry per child, both showing the same photo.
  must(await O.client.from("entries").insert([
    entry("eX", "X", { photo_ids: [photo.x.id, photo.xy.id] }),
    entry("eY", "Y", { photo_ids: [photo.y.id, photo.xy.id] }),
    entry("eZ", "Z"),
  ]));
  must(await O.client.from("activity_records").insert([
    { family_id: F, id: "rX", child_id: "X", lesson: "Pouring", date: "2026-10-01" },
    { family_id: F, id: "rY", child_id: "Y", lesson: "Pouring", date: "2026-10-01" },
  ]));
  must(await O.client.from("plans").insert({ family_id: F, id: "pXY", activity_id: "dotting", date: "2026-10-02", child_ids: ["X", "Y"] }));
  // Versions that lost a conflict, kept by the owner (as sync does).
  const keep = (id: string, table: string, recordId: string, version: Record<string, unknown>) =>
    O.client.from("record_versions").insert({ family_id: F, id, table_name: table, record_id: recordId, version, base_rev: 1, reason: "text_conflict" });
  must(await keep("vX", "entries", "eX", { id: "eX", child_id: "X", text: "older text about X" }));
  must(await keep("vY", "entries", "eY", { id: "eY", child_id: "Y", text: "older text about Y" }));
  must(await keep("vChildX", "children", "X", { id: "X", first: "Xi" }));
  must(await keep("vPlan", "plans", "pXY", { id: "pXY", note: "old" }));
});

describe("owner", () => {
  it("reads every child, record, photo and version of their children", async () => {
    assert.deepEqual(ids(await O.client.from("children").select("id").eq("family_id", F)), ["X", "Y", "Z"]);
    assert.deepEqual(ids(await O.client.from("entries").select("id").eq("family_id", F)), ["eX", "eY", "eZ"]);
    assert.deepEqual(ids(await O.client.from("activity_records").select("id").eq("family_id", F)), ["rX", "rY"]);
    assert.equal(ids(await O.client.from("photos").select("id").eq("family_id", F)).length, 4);
    assert.deepEqual(ids(await O.client.from("record_versions").select("id").eq("family_id", F)), ["vChildX", "vPlan", "vX", "vY"]);
  });

  it("changes the child's profile, and moves a record between two of their children (as the app allows)", async () => {
    must(await O.client.from("children").update({ first: "Xiaoxia", dob: "2022-02-02", photo_ref: photo.x.id }).eq("family_id", F).eq("id", "X"));
    must(await O.client.from("activity_records").update({ child_id: "Y" }).eq("family_id", F).eq("id", "rY"));
    assert.equal((await rowsOf("children", { id: "X" }))[0].first, "Xiaoxia");
  });
});

describe("editor", () => {
  it("reads the shared child and its records, and nothing of the unshared sibling", async () => {
    assert.deepEqual(ids(await Ed.client.from("children").select("id").eq("family_id", F)), ["X", "Z"]);
    assert.deepEqual(ids(await Ed.client.from("entries").select("id").eq("family_id", F)), ["eX", "eZ"]);
    assert.deepEqual(ids(await Ed.client.from("activity_records").select("id").eq("family_id", F)), ["rX"]);
  });

  it("creates Moments and activity records, and edits and soft-deletes the owner's", async () => {
    must(await Ed.client.from("entries").insert(entry("eEd", "X")).select());
    must(await Ed.client.from("activity_records").insert({ family_id: F, id: "rEd", child_id: "X", lesson: "Sorting", date: "2026-10-03" }));
    must(await Ed.client.from("entries").update({ text: "edited by the editor" }).eq("family_id", F).eq("id", "eX"));
    must(await Ed.client.from("activity_records").update({ notes: "editor note" }).eq("family_id", F).eq("id", "rX"));
    must(await Ed.client.from("entries").update({ deleted_at: new Date().toISOString() }).eq("family_id", F).eq("id", "eZ"));
    const [eX] = await rowsOf("entries", { id: "eX" });
    assert.equal(eX.text, "edited by the editor");
    assert.equal(eX.updated_by, Ed.id);
    assert.ok((await rowsOf("entries", { id: "eZ" }))[0].deleted_at, "soft-deleted, still there");
    // The owner sees the editor's work.
    assert.ok(ids(await O.client.from("entries").select("id").eq("family_id", F)).includes("eEd"));
  });

  it("can't change the child's profile, delete it, or create a child in the family", async () => {
    for (const change of [{ first: "Hacked" }, { dob: "2020-01-01" }, { photo_ref: photo.x.id }, { notes: "x" }, { deleted_at: new Date().toISOString() }]) {
      await refusedUpdate(Ed.client.from("children").update(change).eq("family_id", F).eq("id", "X"), `editor changing ${Object.keys(change)[0]}`);
    }
    refused(await Ed.client.from("children").insert({ family_id: F, id: "ed-child", first: "New" }), "editor creating a child in the owner's family");
    const [x] = await rowsOf("children", { id: "X" });
    assert.equal(x.first, "Xiaoxia");
    assert.equal(x.deleted_at, null);
  });

  it("can't write to the unshared sibling, or move a record to or from a child they can't write", async () => {
    refused(await Ed.client.from("entries").insert(entry("eEdY", "Y")), "entry for an unshared child");
    refused(await Ed.client.from("activity_records").insert({ family_id: F, id: "rEdY", child_id: "Y", lesson: "x", date: "2026-10-01" }), "record for an unshared child");
    await refusedUpdate(Ed.client.from("entries").update({ child_id: "Y" }).eq("family_id", F).eq("id", "eX"), "moving a Moment to an unshared child");
    // Updating a row they can't see changes nothing.
    const r = await Ed.client.from("entries").update({ child_id: "X" }).eq("family_id", F).eq("id", "eY").select();
    assert.ok(r.error || (r.data ?? []).length === 0);
    assert.equal((await rowsOf("entries", { id: "eX" }))[0].child_id, "X");
    assert.equal((await rowsOf("entries", { id: "eY" }))[0].child_id, "Y");
    // Between two children they can write (X and Z), a move works, as it does for the owner.
    must(await Ed.client.from("activity_records").update({ child_id: "Z" }).eq("family_id", F).eq("id", "rEd"));
    await refusedUpdate(Ed.client.from("activity_records").update({ child_id: "Y" }).eq("family_id", F).eq("id", "rEd"), "moving from a shared to an unshared child");
  });

  it("can't move a record into their own family, or take it out of the child's family", async () => {
    await refusedUpdate(Ed.client.from("entries").update({ family_id: Ed.familyId }).eq("family_id", F).eq("id", "eX"), "changing family_id");
    assert.equal((await rowsOf("entries", { id: "eX" })).length, 1);
  });

  it("can't attach the unshared sibling's photo to a shared Moment", async () => {
    await refusedUpdate(Ed.client.from("entries").update({ photo_ids: [photo.y.id] }).eq("family_id", F).eq("id", "eX"), "pulling a sibling's photo in");
    refused(await Ed.client.from("entries").insert(entry("eSteal", "X", { photo_ids: [photo.y.id] })), "a new Moment with a sibling's photo");
  });
});

describe("viewer", () => {
  it("reads the shared child and its records", async () => {
    assert.deepEqual(ids(await Vw.client.from("children").select("id").eq("family_id", F)), ["X"]);
    assert.ok(ids(await Vw.client.from("entries").select("id").eq("family_id", F)).includes("eX"));
    assert.deepEqual(ids(await Vw.client.from("activity_records").select("id").eq("family_id", F)), ["rX"]);
  });

  it("can't create, change or delete anything", async () => {
    refused(await Vw.client.from("entries").insert(entry("eVw", "X")), "viewer creating a Moment");
    refused(await Vw.client.from("activity_records").insert({ family_id: F, id: "rVw", child_id: "X", lesson: "x", date: "2026-10-01" }), "viewer creating a record");
    await refusedUpdate(Vw.client.from("entries").update({ text: "viewer edit" }).eq("family_id", F).eq("id", "eX"), "viewer editing");
    await refusedUpdate(Vw.client.from("entries").update({ deleted_at: new Date().toISOString() }).eq("family_id", F).eq("id", "eX"), "viewer soft-deleting");
    await refusedUpdate(Vw.client.from("children").update({ first: "V" }).eq("family_id", F).eq("id", "X"), "viewer changing the child");
    await refusedUpdate(Vw.client.from("photos").update({ deleted_at: new Date().toISOString() }).eq("family_id", F).eq("id", photo.x.id), "viewer deleting a photo");
    refused(await Vw.client.from("record_versions").insert({ family_id: F, id: "vVw", table_name: "entries", record_id: "eX", version: { child_id: "X" }, reason: "other" }), "viewer keeping a version");
    assert.equal((await rowsOf("entries", { id: "eX" }))[0].text, "edited by the editor");
  });
});

describe("outsiders and other families", () => {
  it("an outsider reaches nothing of the family, by any table", async () => {
    for (const t of ["children", "entries", "activity_records", "photos", "record_versions", "plans", "child_memberships"]) {
      assert.deepEqual(must(await Out.client.from(t).select("family_id").eq("family_id", F)), [], t);
    }
    refused(await Out.client.from("entries").insert(entry("eOut", "X")), "outsider writing");
    await refusedUpdate(Out.client.from("children").update({ first: "O" }).eq("family_id", F).eq("id", "X"), "outsider changing a child");
  });

  it("an outsider gets the same answer whether or not a child exists", async () => {
    const real = await Out.client.from("entries").insert(entry("eOut1", "X"));
    const fake = await Out.client.from("entries").insert(entry("eOut2", "no-such-child"));
    assert.equal(real.error?.message, fake.error?.message);
    assert.equal(real.error?.code, fake.error?.code);
  });

  it("members of a child still see nothing of each other's own families", async () => {
    must(await Ed.client.from("children").insert({ family_id: Ed.familyId, id: "ed-own", first: "Edda" }));
    assert.deepEqual(must(await O.client.from("children").select("id").eq("family_id", Ed.familyId)), []);
    assert.deepEqual(must(await Vw.client.from("children").select("id").eq("family_id", Ed.familyId)), []);
  });

  it("family membership alone no longer reaches a child (a family member with no role)", async () => {
    // (Fm uses a fresh session from newUser.)
    assert.deepEqual(must(await Fm.client.from("children").select("id").eq("family_id", F)), []);
    assert.deepEqual(must(await Fm.client.from("entries").select("id").eq("family_id", F)), []);
    refused(await Fm.client.from("entries").insert(entry("eFm", "X")), "family member without a role writing");
    // Plans stay family-scoped, but a child can be added to one only by someone who can write that child.
    assert.deepEqual(ids(await Fm.client.from("plans").select("id").eq("family_id", F)), ["pXY"]);
    refused(await Fm.client.from("plans").insert({ family_id: F, id: "pFm", activity_id: "dotting", date: "2026-10-05", child_ids: ["Y"] }), "a plan for a child they can't write");
    // complete_migration() can't be used to learn whether a child's record exists.
    must(await Fm.client.from("cloud_migrations").insert({ family_id: F, id: "m-fm", device_id: "d1" }));
    const res = must(await Fm.client.rpc("complete_migration", { p_family_id: F, p_id: "m-fm", p_manifest: { records: { entries: ["eX", "nope"], children: ["X"] }, photos: [] } })) as { status: string; missing: string[] };
    assert.equal(res.status, "incomplete");
    assert.deepEqual(res.missing.sort(), ["children:X", "entries:eX", "entries:nope"]);
  });
});

describe("records about several children", () => {
  it("a Moment about two children is one entry per child: each copy follows its own child", async () => {
    assert.ok(ids(await Ed.client.from("entries").select("id").eq("family_id", F)).includes("eX"));
    assert.ok(!ids(await Ed.client.from("entries").select("id").eq("family_id", F)).includes("eY"));
  });

  it("a plan (My Week) for several children stays with the family: shared members don't see it", async () => {
    assert.deepEqual(must(await Ed.client.from("plans").select("id").eq("family_id", F)), []);
    assert.deepEqual(must(await Vw.client.from("plans").select("id").eq("family_id", F)), []);
    refused(await Ed.client.from("plans").insert({ family_id: F, id: "pEd", activity_id: "dotting", date: "2026-10-05", child_ids: ["X"] }), "editor adding to the family's plans");
    // The owner can still plan for any of their children.
    must(await O.client.from("plans").update({ child_ids: ["X", "Y", "Z"] }).eq("family_id", F).eq("id", "pXY"));
  });
});

describe("photos", () => {
  const visible = async (who: Parent | Awaited<ReturnType<typeof newUser>>) => ids(await who.client.from("photos").select("id").eq("family_id", F));

  it("photo details follow the children whose Moments or profile show them", async () => {
    assert.deepEqual(await visible(Ed), [photo.x.id, photo.xy.id].sort());
    assert.deepEqual(await visible(Vw), [photo.x.id, photo.xy.id].sort());
    assert.deepEqual(await visible(Out), []);
    // A photo no child shows yet belongs to the family, as before.
    assert.deepEqual(await visible(Fm), [photo.loose.id]);
    assert.equal((await visible(O)).length, 4);
  });

  it("files: a shared member can download and sign a shared child's photo, never the sibling's or a loose one", async () => {
    for (const who of [Ed, Vw]) {
      const bucket = who.client.storage.from(BUCKET);
      assert.equal((await bucket.download(photo.x.path)).error, null);
      assert.equal((await bucket.createSignedUrl(photo.xy.path, 60)).error, null);
      assert.ok((await bucket.download(photo.y.path)).error, "sibling's photo downloaded");
      assert.ok((await bucket.createSignedUrl(photo.y.path, 60)).error, "sibling's photo signed");
      assert.ok((await bucket.download(photo.loose.path)).error, "family's loose photo downloaded");
    }
    assert.ok((await Out.client.storage.from(BUCKET).download(photo.x.path)).error);
    const listed = await Ed.client.storage.from(BUCKET).list(F);
    assert.deepEqual((listed.data ?? []).map(o => o.name).filter(n => photo.y.path.endsWith(n)), [], "listing reveals the sibling's photo");
  });

  it("verify-photo answers 'not found' for a photo the caller can't read", async () => {
    const verify = await Ed.client.functions.invoke("verify-photo", { body: { familyId: F, photoId: photo.y.id } });
    assert.equal((verify.error as { context?: { status?: number } } | null)?.context?.status, 404);
  });

  it("only the family adds photos; an editor can't add one, or upload a file into the family's folder", async () => {
    const bytes = randomBytes(64);
    const id = newPhotoId();
    refused(await Ed.client.from("photos").insert({ family_id: F, id, mime_type: "image/jpeg", byte_size: bytes.length, sha256: sha256(bytes) }), "editor adding a photo");
    assert.ok((await Ed.client.storage.from(BUCKET).upload(`${F}/${id}.jpg`, bytes, { contentType: "image/jpeg" })).error);
  });

  it("an editor can update a shared child's photo details; a viewer or an outsider can't", async () => {
    must(await Ed.client.from("photos").update({ position: 1 }).eq("family_id", F).eq("id", photo.x.id));
    await refusedUpdate(Ed.client.from("photos").update({ position: 2 }).eq("family_id", F).eq("id", photo.y.id), "editor updating the sibling's photo");
  });
});

describe("kept versions (record_versions)", () => {
  it("a child's versions: its owner sees them all; members see only those they kept; others nothing", async () => {
    must(await Ed.client.from("record_versions").insert({ family_id: F, id: "vEd", table_name: "entries", record_id: "eX", version: { id: "eX", child_id: "X", text: "editor's losing text" }, base_rev: 2, reason: "text_conflict" }).select("id"));
    assert.deepEqual(ids(await Ed.client.from("record_versions").select("id").eq("family_id", F)), ["vEd"]);
    assert.deepEqual(ids(await Vw.client.from("record_versions").select("id").eq("family_id", F)), []);
    assert.deepEqual(ids(await Fm.client.from("record_versions").select("id").eq("family_id", F)), ["vPlan"]);
    assert.ok(ids(await O.client.from("record_versions").select("id").eq("family_id", F)).includes("vEd"));
    assert.equal((await rowsOf("record_versions", { id: "vEd" }))[0].child_id, "X");
  });

  it("no one can keep a version for a child they can't write, or choose its child", async () => {
    refused(await Ed.client.from("record_versions").insert({ family_id: F, id: "vEdY", table_name: "entries", record_id: "eY", version: { id: "eY", child_id: "Y" }, reason: "other" }), "a version of the sibling's Moment");
    refused(await Ed.client.from("record_versions").insert({ family_id: F, id: "vEdC", table_name: "children", record_id: "Y", version: { id: "Y" }, reason: "other" }), "a version of the sibling");
    refused(await Ed.client.from("record_versions").insert({ family_id: F, id: "vEdSet", table_name: "entries", record_id: "eX", version: { child_id: "X" }, reason: "other", child_id: "Y" }), "setting child_id");
    await refusedUpdate(Ed.client.from("record_versions").update({ resolved_at: new Date().toISOString() }).eq("family_id", F).eq("id", "vX"), "resolving the owner's version");
  });
});

// Phase 2b (migration 20261101000300): a photo can be added for a child the user can write.
let edPhoto: { id: string; path: string };
let signedBefore: string;
describe("photos added for a shared child", () => {
  const newRow = (childId: string | null) => {
    const bytes = randomBytes(128);
    return { bytes, row: { family_id: F, id: newPhotoId(), mime_type: "image/jpeg", byte_size: bytes.length, sha256: sha256(bytes), ...(childId ? { child_id: childId } : {}) } };
  };

  it("an editor adds a photo for the shared child: row, file and server verification, all in the child's family", async () => {
    const { bytes, row } = newRow("X");
    const [inserted] = must(await Ed.client.from("photos").insert(row).select("id, storage_path, child_id")) as { id: string; storage_path: string; child_id: string }[];
    assert.equal(inserted.child_id, "X");
    assert.ok(inserted.storage_path.startsWith(`${F}/`), "the path is the child's family's, as for every photo");
    must(await Ed.client.storage.from(BUCKET).upload(inserted.storage_path, bytes, { contentType: "image/jpeg" }));
    const verify = await Ed.client.functions.invoke("verify-photo", { body: { familyId: F, photoId: inserted.id } });
    assert.equal((verify.data as { status: string }).status, "verified");
    edPhoto = { id: inserted.id, path: inserted.storage_path };
    // Attached to a shared Moment.
    must(await Ed.client.from("entries").update({ photo_ids: [photo.x.id, photo.xy.id, edPhoto.id] }).eq("family_id", F).eq("id", "eX"));
  });

  it("the child's members (owner, viewer) see it; a family member with no role and an outsider don't", async () => {
    const { row } = newRow("X");
    must(await Ed.client.from("photos").insert(row)); // not shown by any Moment yet: follows the child it was added for
    for (const who of [O, Vw, Ed]) assert.ok(ids(await who.client.from("photos").select("id").eq("family_id", F)).includes(row.id));
    for (const who of [Fm, Out]) assert.ok(!ids(await who.client.from("photos").select("id").eq("family_id", F)).includes(row.id));
    assert.equal((await Vw.client.storage.from(BUCKET).download(edPhoto.path)).error, null);
  });

  it("a viewer, an outsider, or an editor for a child they can't write can't add one; the child can't be changed later", async () => {
    refused(await Vw.client.from("photos").insert(newRow("X").row), "viewer adding a photo");
    refused(await Out.client.from("photos").insert(newRow("X").row), "outsider adding a photo");
    refused(await Ed.client.from("photos").insert(newRow("Y").row), "editor adding a photo for an unshared child");
    refused(await Ed.client.from("photos").insert(newRow("no-such-child").row), "a photo for a child that doesn't exist");
    refused(await Ed.client.from("photos").update({ child_id: "Z" }).eq("family_id", F).eq("id", edPhoto.id), "changing a photo's child");
  });

  it("signed URLs: a member can create one; it is an ordinary expiring link", async () => {
    const signed = must(await Ed.client.storage.from(BUCKET).createSignedUrl(edPhoto.path, 60)) as { signedUrl: string };
    signedBefore = signed.signedUrl;
    assert.equal((await fetch(signedBefore)).status, 200);
  });
});

describe("revoked membership", () => {
  it("removing a membership ends all access at once; what the member wrote stays with the child", async () => {
    must(await svc().from("child_memberships").delete().eq("family_id", F).eq("child_id", "X").eq("user_id", Ed.id));
    // No new signed URL. One created before keeps working until it expires (60 s here): it is a self-contained,
    // time-limited link, not checked against memberships when used.
    assert.ok((await Ed.client.storage.from(BUCKET).createSignedUrl(edPhoto.path, 60)).error, "a revoked member got a new signed URL");
    assert.equal((await fetch(signedBefore)).status, 200);
    refused(await Ed.client.from("photos").insert({ family_id: F, id: newPhotoId(), mime_type: "image/jpeg", byte_size: 1, sha256: "b".repeat(64), child_id: "X" }), "adding a photo after revocation");
    assert.deepEqual(ids(await Ed.client.from("children").select("id").eq("family_id", F)), ["Z"]);
    assert.ok(!ids(await Ed.client.from("entries").select("id").eq("family_id", F)).includes("eEd"));
    assert.deepEqual(ids(await Ed.client.from("record_versions").select("id").eq("family_id", F)), [], "even their own kept version");
    assert.ok((await Ed.client.storage.from(BUCKET).download(photo.x.path)).error, "photo still downloadable");
    refused(await Ed.client.from("entries").insert(entry("eLate", "X")), "writing after revocation (e.g. an offline edit sent later)");
    await refusedUpdate(Ed.client.from("entries").update({ text: "late" }).eq("family_id", F).eq("id", "eX"), "editing after revocation");
    assert.ok(ids(await O.client.from("entries").select("id").eq("family_id", F)).includes("eEd"));
  });
});

describe("soft deletion of the child", () => {
  it("only the owner can soft-delete and restore the child; meanwhile everyone else loses access, and gets it back on restore (Phase 3)", async () => {
    must(await O.client.from("children").update({ deleted_at: new Date().toISOString() }).eq("family_id", F).eq("id", "Z"));
    // The editor of Z: no child, no records, no membership row (so their devices remove it), no writes.
    assert.deepEqual(must(await Ed.client.from("children").select("id").eq("family_id", F).eq("id", "Z")), []);
    assert.deepEqual(must(await Ed.client.from("entries").select("id").eq("family_id", F).eq("child_id", "Z")), []);
    assert.deepEqual(must(await Ed.client.from("child_memberships").select("child_id").eq("family_id", F).eq("child_id", "Z")), []);
    refused(await Ed.client.from("entries").insert(entry("eAfterDelete", "Z")), "writing to a deleted child");
    await refusedUpdate(Ed.client.from("children").update({ deleted_at: null }).eq("family_id", F).eq("id", "Z"), "editor restoring the child");
    // The owner still has it all, and their view of the circle is unchanged.
    const [z] = must(await O.client.from("children").select("id, deleted_at").eq("family_id", F).eq("id", "Z")) as { deleted_at: string | null }[];
    assert.ok(z.deleted_at);
    assert.ok(ids(await O.client.from("entries").select("id").eq("family_id", F)).includes("eZ"));
    assert.equal((must(await O.client.from("child_memberships").select("user_id").eq("family_id", F).eq("child_id", "Z")) as unknown[]).length, 2);
    // Restored: the editor is back.
    must(await O.client.from("children").update({ deleted_at: null }).eq("family_id", F).eq("id", "Z"));
    assert.deepEqual(ids(await Ed.client.from("children").select("id").eq("family_id", F).eq("id", "Z")), ["Z"]);
    assert.deepEqual(must(await Ed.client.from("child_memberships").select("role").eq("family_id", F).eq("child_id", "Z")), [{ role: "editor" }]);
  });
});
