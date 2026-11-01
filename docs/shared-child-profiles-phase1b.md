# Shared Child Profiles: Phase 1b (child-level access control)

Phase 1b moves access to a child's records from "member of the family" to "member of the child", in the database.
Owners, editors and viewers now get exactly what their role allows, through RLS and triggers, whatever client calls
the API. For today's users nothing changes: every child's only member is its family's owner. There are no
invitations, no sharing UI and no multi-family sync yet.

Branch `feature/shared-child-profiles`, after Phase 1a (`e677134`, [shared-child-profiles-phase1a.md](shared-child-profiles-phase1a.md)).
Migration `supabase/migrations/20261101000200_child_access.sql`, applied to the **local** stack only, not to staging.
Done 2026-11-01.

## 1. Authorization architecture

The child's role comes from `child_memberships` (Phase 1a). Everything is decided in Postgres by a few security-definer
helpers in `private`, which the API doesn't expose:

| Helper | Answer |
|---|---|
| `child_role(fid, cid)` | the caller's role for that child, or null |
| `can_write_child(fid, cid)` | role is `owner` or `editor` |
| `can_read_child(fid, cid)` | any role, plus a narrow creation case (below) |
| `can_read_photo` / `can_write_photo(fid, pid)` | through the children that show the photo (section 4) |
| `can_read_version(fid, table, cid, created_by)` | record versions (section 5) |

### Permission matrix

| | Owner | Editor | Viewer | Family member without a role | Outsider |
|---|---|---|---|---|---|
| Read the child | yes | yes | yes | no | no |
| Change the child's profile (any column), soft-delete or restore it | yes | no | no | no | no |
| Create a child | in their own family | in their own family | in their own family | in that family (becomes its owner) | in their own family |
| Read Moments, Journal entries, activity records | yes | yes | yes | no | no |
| Create, edit and soft-delete them (anyone's) | yes | yes | no | no | no |
| Move a record to another child | between children they can write | same | no | no | no |
| Read photo details and files of photos the child shows | yes | yes | yes | no | no |
| Change those photo details | yes | yes | no | no | no |
| Add a new photo | family members only | family members only | family members only | yes | no |
| Read kept versions of the child's records | all | only those they kept | only those they kept | no | no |
| Manage memberships | no client can (Phase 1a); server functions later | no | no | no | no |
| Plans (My Week), saved items, goals | family-scoped, unchanged | not visible unless family member | same | family (adding a child to a plan needs write access to it) | no |

**Editors can't change the child row at all.** That covers name, birthday, avatar, enrolment, group, notes, interests,
and soft delete. It is the simplest rule that keeps every core field protected. Letting editors change some
non-identity columns (for example `notes`) would mean a per-column trigger. It is left as an open product decision.

**Creation case in `can_read_child`.** A family member may read a child that has **no membership at all**. That only
happens inside the transaction that creates the child, between the insert and the `t20_owner` trigger, when Postgres
checks `insert … returning` (used by sync) against the select policy. Every committed child has an owner (Phase 1a),
so this never opens a committed child to anyone. A test covers it: a family member without a role sees no child.

## 2. RLS policy changes

| Table | Select | Insert | Update |
|---|---|---|---|
| `children` | `can_read_child` | **unchanged**: own family | owner only (old and new row) |
| `entries` | any role on `child_id` | `can_write_child(child_id)` | `can_write_child` on the old **and** the new row |
| `activity_records` | same as entries | same | same |
| `photos` | `can_read_photo` | **unchanged**: own family | `can_write_photo` (old and new row) |
| `record_versions` | `can_read_version` | child tables: `can_write_child(child_id)`; others: family | `can_read_version` (old and new row) |

Unchanged: `plans`, `goals`, `saved_activities`, `saved_collections`, `cloud_migrations`, `families`, `family_members`,
`profiles`, `user_settings`, `child_memberships`. There are still no delete policies anywhere: deletion stays soft.

## 3. Trigger and constraint changes

- **`t00_member` replaced by `t00_access`** on `children`, `entries`, `activity_records`, `photos` and
  `record_versions`. As before, it runs first and answers the same whether or not the row exists, and server jobs (no
  `auth.uid()`) are trusted.
  - `children`: insert needs family membership, with the same message as before ("not a member of this family"); update
    needs the owner.
  - `entries` / `activity_records`: write access to the new child, and on update also the old one. A record can only
    move between two children the user can write. That keeps the app's existing "correct a record's child" feature
    (`src/App.tsx`, `editActivityRecord`) and blocks moving records out of, or into, a child the user can't write.
  - `photos`: insert needs family membership (unchanged); update needs `can_write_photo`.
  - `record_versions`: the server sets `child_id` (section 5) and checks write access to that child.
- **`family_id` and `id`** still never change on any row (`t90_stamp`, unchanged). A test covers moving a record into
  another family.
- **`check_entry_photos`**: a photo newly added to a Moment must be readable by the writer, so nobody can pull an
  unshared sibling's photo into a shared child. Same error as an unknown photo.
- **`check_child_photo`**: the same for a child's profile photo.
- **`check_plan_children`**: a child newly added to a plan must be writable by the writer.
- **`complete_migration()`**: a child's record or a photo counts as present only if the caller can read it, so the
  function can't be used to learn what exists outside the caller's children.
- **New index** `entries_photo_ids_idx` (GIN on `entries.photo_ids`) for the photo checks.

## 4. Photo access model

A photo belongs to the children that **show** it: through `entries.photo_ids` (Moments, including soft-deleted ones)
or `children.photo_ref` (profile photo). This is computed when it is checked. There is no link table to keep in step,
and nothing to backfill.

- **Readable** if the caller can read any of those children. **Writable** if they can write any of them.
- **A photo no child shows** (just uploaded and not yet attached, a parent's profile photo, or removed from every
  Moment) belongs to its family, exactly as before.
- **One photo, several children:** a Moment about two children is two entries showing the same photo. The photo is
  readable through either child, so a member of one shared child sees it. The sibling's own copy of the Moment stays
  hidden.
- **Files:** `photo_object_allowed()` now asks `can_read_photo` for the row whose `storage_path` matches. Download,
  signed URLs and listing follow it. Upload still needs a readable row, so in practice a family member. Paths are
  unchanged and no file moved.
- **`verify-photo`**: unchanged. It reads the row with the caller's token, so RLS decides, and an unreadable photo is
  "not found" (404). Tested.
- **Deletion:** no client can delete a photo row or file (unchanged). Photo rows are soft-deleted by an update, which
  needs `can_write_photo`.
- **Sync:** photos still upload first (before the Moment that shows them). At that point they belong to the family,
  so the uploader, a family member, can read and verify them. Unchanged for today's users. Tested by the photo sync
  suites.

## 5. Record version access model

`record_versions` gains `child_id` (nullable). The server sets it on insert; clients have no column grant and can't
choose it:

- `children` version: the child itself (`record_id`);
- `entries` / `activity_records` version: the child named in the version, or else the child of the record on the
  server;
- anything else: null.

Existing versions were backfilled the same way in the migration.

| Version of | Who can read (and resolve) it |
|---|---|
| a child's record | the child's **owner**; the user who **kept** it, while they still have a role on the child |
| a goal | only the user who kept it (goals are private; before, the whole family could read goal versions) |
| a plan, saved item or photo | the family, as before |

Keeping a version of a child's record needs write access to that child. Viewers, outsiders, and family members
without a role can't read or add a child's versions. A removed member loses even the versions they kept. All of this
is tested through the API.

## 6. Compatibility strategy

- **Same rows for today's users.** Since Phase 1a, every child's only member is its family's owner. So
  "member of the child" gives each parent exactly what "member of the family" gave them. The unchanged existing suites
  confirm it: sync, conflicts, photos, guest import, security, revisions, cursor, and the cloud browser suites.
- **No cross-family data reaches the current app.**
  1. Memberships for other users can be made only by the server (no client grant).
  2. The current sync client reads only `family_id = its own family` (`engine.ts`), so even a membership in another
     family would not be pulled.
  3. Inside a family, the new rules can only show **fewer** rows than before, never more.
- **Existing behaviour kept on purpose:**
  - children are still created in your own family, with the same insert path and error message;
  - moving a record between children still works (now only between children you can write);
  - photo upload order, paths and verification are unchanged;
  - conflict versions are still written by the same client code (it never sends `child_id`).
- **No app, IndexedDB or sync change.**

## 7. Security test results

New: `tests/db/childAccess.test.ts`, 25 tests, all straight to the API with each role's own session. The setup is
an owner with children X (editor and viewer), Z (editor) and Y (unshared), plus an outsider, and a family member with
no role. Covered:

| Area | Tests |
|---|---|
| Owner permissions | reads everything; changes profile; moves records between their children |
| Editor permissions | reads only shared children; creates, edits and soft-deletes anyone's records; `updated_by` records who |
| Viewer permissions | reads; every write (create, edit, soft-delete, child, photo, version) refused |
| Outsider isolation | nothing readable in any of 7 tables; writes refused; same answer for a real and a made-up child |
| Cross-family | members of a child see nothing of each other's own families; no record moves into another family |
| Core child profile | editor can't change first, dob, photo_ref, notes or deleted_at, can't create a child in the family, can't restore it |
| Collaborative editing | editor edits and soft-deletes the owner's Moment; the owner sees the editor's records |
| Soft deletion | editor soft-deletes records; only the owner soft-deletes and restores the child |
| Child reassignment | moves to an unshared child refused; between writable children allowed; hidden rows can't be targeted |
| Photo metadata | visible exactly through the children that show it; loose photos family-only |
| Storage | download, signed URL and listing per photo; editor can't add a photo or upload into the family folder; `verify-photo` 404 |
| Record versions | owner sees all; members only their own; viewer none; can't keep a version for an unshared child or set `child_id` |
| Multi-child records | Moment copies follow their own child; a shared photo is visible through the shared child; plans stay family-scoped |
| Revoked membership | read, write, versions and photo files all end at once; what they wrote stays |
| Family isolation | a family member with no role sees no child; `complete_migration()` reveals nothing |

**The tests catch regressions.** I sabotaged the local database twice on purpose: `entries` select back to the family
rule, and photo files allowed by family membership again. Each made the suite fail (2 suites). Both were restored
from the migration text, and the suite passes again.

| Command | Result | Before Phase 1b |
|---|---|---|
| `npm run typecheck` | clean | clean |
| `npm test` | 186 / 186 | 186 / 186 |
| `npm run test:db` | **208 / 208** (53 suites) | 183 / 183 |
| `npm run test:e2e` | 152 / 152 | 152 / 152 |
| `npm run test:e2e:cloud` | 55 / 55 | 55 / 55 |

One existing test changed, as intended: the Phase 1a test "a membership grants no access to the child's records yet"
now checks that a membership reaches that child, and only that child.

## 8. Known limitations

- **Editors can't add new photos.** Adding a photo needs family membership, so an editor from another family can't
  attach a new picture to a Moment yet. Phase 2 needs a child-scoped photo upload (section 9).
- **Members keep read access to a soft-deleted child.** Whether they should lose it at once is still an open product
  decision. Only the owner can delete or restore.
- **Plans are family-only.** Shared members don't see My Week. Shared Planned Activities needs its own child-scoped
  design (`plans.child_ids` would otherwise reveal siblings).
- **Photo checks scan Moments.** Each photo check looks up the Moments that show it (GIN index). Fine at family scale;
  measure before large shared libraries.
- **Profile photos of parents** are family photos. A co-parent or editor can't see another member's profile photo.
- **No undo migration** has been written yet. Phase 1b only adds a column, an index, functions and policies, so an
  undo is mechanical: restore the family policies and `t00_member`, and drop the new functions, column and index. It
  should exist before staging.
- **Not applied to an empty database here** (the local stack wasn't reset). CI's `db-tests.yml` does that on the first
  pull request.

## 9. Requirements for Phase 2

- [ ] **Scope-aware sync.** Fetch the caller's memberships, pull each child's rows from its home family
      (`family_id = home and child_id in (…)`), and keep cursors per family. Writes go to the record's home family,
      not the user's own. Remove the "space belongs to another family" stop for shared children.
- [ ] **Full re-sync on any membership change** for the affected scope (cursor reset). Invariant 5 in docs section
      5.4 depends on it.
- [ ] **Composite local keys** `(familyId, id)` in IndexedDB (seed ids like `emma` exist in many families), with an
      upgrade test.
- [ ] **Refused writes are permanent:** treat a `42501` on push as "access lost". Keep the edit locally, tell the user,
      and don't retry forever.
- [ ] **Revocation cleanup:** when a child disappears from the memberships, remove its synced rows and photo bytes from
      the device, and report unsent edits.
- [ ] **Child-scoped photo upload**, so editors can add photos: create the photo row and its file in the child's home
      family, allowed by write access to a named child. This needs a server function or a `photos.child_id` hint
      checked against the membership.
- [ ] **Owner-only and role-aware UI** (Phase 3) and **invitations** (Phase 4), still behind server functions.
- [ ] **Before staging:**
  - Phase 0 blockers: backups, and deployment gated on tests;
  - the Phase 1a read-only staging check;
  - undo migrations for 1a and 1b;
  - the staging privilege audit (docs section 19) re-run after applying.
