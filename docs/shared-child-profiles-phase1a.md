# Shared Child Profiles: Phase 1a (child membership foundation)

Phase 1a gives every child exactly one owner, recorded per child, and changes nothing anyone can see or do. There is
no sharing, no invitation, and no new access to child records. Branch `feature/shared-child-profiles`; follows Phase 0
(`9278965`, [shared-child-profiles-phase0.md](shared-child-profiles-phase0.md)). Done 2026-11-01.

**Status:** applied to the **local** stack only. **Not** applied to `rootmap-staging`. Phase 0 blocker 1 (no backups)
still applies before it may be.

## 1. Database changes

One additive migration: `supabase/migrations/20261101000100_child_memberships.sql`. Nothing existing is altered,
except that `children` gains two triggers.

**`public.child_memberships`**

| Column | Type | Notes |
|---|---|---|
| `family_id`, `child_id` | uuid, text | the child's existing identity; FK to `children (family_id, id)` `on delete cascade` |
| `user_id` | uuid | FK to `auth.users` `on delete cascade` (but see "owner accounts" in section 2) |
| `role` | text | `owner`, `editor` or `viewer` |
| `invited_by` | uuid, nullable | FK to `auth.users` `on delete set null`; unused until invitations |
| `created_at`, `updated_at` | timestamptz | `updated_at` set by trigger on every update |

- Primary key `(family_id, child_id, user_id)`: one membership per user per child.
- `child_memberships_one_owner`: a unique index on `(family_id, child_id) where role = 'owner'`.
- `child_memberships_user_id_idx`: index on `(user_id)`, for listing a user's children.
- RLS on; one select policy; no insert, update or delete policy (section 5).

**Functions** (all in `private`, security definer, `search_path = ''`):

| Function | Purpose | Who can execute |
|---|---|---|
| `is_child_owner(fid, cid)` | used by the select policy | `authenticated`, `service_role` (not exposed by the API) |
| `check_one_owner(fid, cid)` | raises unless the child, if it still exists, has exactly one owner | triggers only |
| `membership_guard()` | trigger `t00_lock_child`: locks the child row; identity columns immutable; sets `updated_at` | triggers only |
| `membership_one_owner()` | constraint trigger `t50_one_owner` on memberships | triggers only |
| `add_child_owner()` | trigger `t20_owner` on `children`: adds the owner | triggers only |
| `child_one_owner()` | constraint trigger `t50_one_owner` on `children` | triggers only |
| `backfill_child_owners()` | the backfill (section 3) | database owner only |

## 2. Ownership enforcement

"Exactly one owner" is enforced by the database for every client and every server job. It does not rely on the app.

| Part | Mechanism |
|---|---|
| At most one | the partial unique index; a second owner fails at once with `23505` |
| At least one | deferred constraint triggers on `child_memberships` (insert, update, delete) and on `children` (insert), checked at **commit** for each child the transaction touched; failure is `23514` and rolls back the whole transaction |
| New children | `t20_owner` (after insert on `children`) adds the owner in the same transaction |
| Existing children | the backfill, in the same migration (section 3) |
| Soft-deleted children | treated like live ones: they keep their owner, and the check applies to them |
| Future transfers | demote and promote inside one transaction, in either order: the unique index is checked per statement and the "at least one" check runs at commit. Tested. |
| Concurrency | `t00_lock_child` takes `select … for update` on the child's row before any membership change, so changes to one child's members run one after another |
| Hard deletion | only server jobs can remove a child; its memberships cascade, and the check skips a child that no longer exists |

**Who becomes owner of a new child.** The signed-in user who inserts it. `t00_member` has already checked that they
belong to the family, and today every family member is its owner. For a server job, with no `auth.uid()`, it is the
family's single owner, and the insert is refused if the family has none or several.

**Concurrency, precisely.** Removing ownership always touches the current owner's row, and adding an owner always hits
the unique index. So row locks and the index already serialize every change that affects ownership, and each commit
check re-reads committed state. The child-row lock is defence in depth. It keeps the guarantee if a later function
changes several members of a child, in different rows, in one transaction. Both races in the tests block, and the
loser is refused: a transfer racing a removal, and two transfers at once.

**Owner accounts can't be deleted alone (behaviour change).** Deleting an auth user cascades to their memberships. If
the user owns a child, the commit check refuses, so the deletion fails. Before Phase 1a, an operator could delete such
a user, which left their children in a family with no members (the "orphaned" gap in `account-deletion.test.ts`). Now:

- deleting the account of someone who owns a child fails, and nothing changes;
- an erasure first removes the family (`delete from public.families where id = …` as the service role, which takes its
  children, entries, records, photo rows and memberships with it), then the account. Photo **files** in storage still
  have to be removed separately;
- accounts without children are deleted as before (their empty family is still orphaned; the gap remains for that case).

`tests/db/account-deletion.test.ts` was updated to pin down this new behaviour. It is the only existing test that
changed.

## 3. Backfill behaviour

`private.backfill_child_owners()` runs inside the migration's transaction:

1. Locks `children` and `family_members` against writes (`share row exclusive`). Creating the `children` triggers
   already blocks concurrent writes to `children` until the migration commits. Inserts that were waiting then go
   through `t20_owner`, so no child can slip in without an owner.
2. Finds children that have no membership, soft-deleted ones included. For their families it requires **exactly one
   family member, whose role is `owner`**. If any such family has zero members, several members, or no owner, it raises
   `P0001` and the whole migration rolls back. It never picks a member.
3. Inserts one `owner` membership per such child for that member.
4. Checks that every child now has exactly one owner, or raises.
5. Returns the count, which the migration prints as a notice. Running it again adds nothing.

**Local results:**

- **First attempt: refused** (as designed): "child ownership is unclear in 5 famil(ies)". All 5 were fixtures left by
  earlier runs of `account-deletion.test.ts`: family `del-d`, child "Robin", entry `d-entry`, zero members, because the
  test deleted its user. The migration rolled back completely, and `child_memberships` did not exist afterwards.
- Those 5 local test families were deleted (cascade, local only, no storage files). A full `db reset` was avoided
  because the local stack also holds a non-test account.
- **Second attempt: applied.** 1,694 children (40 soft-deleted) were given 1,694 owner memberships. Each is the
  family's `owner` member. No child lacks exactly one owner.
- The updated `account-deletion.test.ts` no longer leaves families with children and no members, so this cannot
  recur locally.

**Staging (not applied).** Phase 0's planner estimates showed about 2 families with 2 members, which fits. If anyone
ever deleted a parent's auth user from the dashboard, though, that family will make the migration refuse, exactly as
above. Before applying it remotely, run this read-only check:

```sql
select f.id, count(m.user_id) as members, count(*) filter (where m.role = 'owner') as owners
from public.families f left join public.family_members m on m.family_id = f.id
where exists (select 1 from public.children c where c.family_id = f.id)
group by f.id having count(m.user_id) <> 1 or count(*) filter (where m.role = 'owner') <> 1;
```

An empty result means the backfill will succeed. Any rows are an owner decision. Do not hand-edit them away.

## 4. Compatibility decisions

- **No app change.** Children are created by direct inserts: the sync engine's `insertIfAbsent` upsert, the guest
  import (which uploads through the same sync), and tests. They are not created through an RPC. An owner trigger on
  `children` therefore covers every existing path without touching `src/`. `ON CONFLICT DO NOTHING` uploads of a child
  already there insert nothing and add no second owner.
- **Unchanged:** child ids, family ids, `family_members`, `create_family()`, IndexedDB schemas, sync code, photo paths,
  and all RLS on children, entries, activity records, photos and storage.
- **Nothing reads memberships for access yet.** An `editor` membership (only the server can create one) gives no access
  to the child. Tested.
- **Deferred to Phase 1b** (Phase 0 listed them under 1a; left out to keep this change minimal and strictly
  behaviour-preserving): `record_versions.child_id` and the `photo_children` link.

## 5. Security considerations

- **Read access:** a user reads their own memberships, plus every membership of a child they own. They cannot list
  other users' children or families: an outsider sees only their own rows, and filtering by another family or user
  returns nothing. `anon` has no grant.
- **Write access:** clients have no insert, update or delete grant or policy, the owner included. Every attempt returns
  `42501`. Only server jobs (service role) and future security-definer functions can change memberships, and they are
  still bound by the owner triggers.
- **Immutable identity:** a membership's family, child, user and `created_at` cannot change, even for the server
  (`42501`). A transfer changes `role` only.
- **The owner can't be removed or demoted directly**, even by the service role (`23514`), unless another owner is
  promoted in the same transaction.
- `backfill_child_owners()` is executable only by the database owner. The trigger functions are executable by no
  client role. `is_child_owner()` lives in `private`, which the API doesn't expose.
- **Lock order:** a child insert locks the family row (`t90_stamp`), then the new child row (`t20_owner`). A membership
  change locks only the child row. No path locks a child and then its family in the opposite order, so this adds no
  deadlock.

## 6. Test results

All on this Mac on 2026-11-01, against the local stack.

| Command | Result | Before Phase 1a |
|---|---|---|
| `npm run typecheck` | clean | clean |
| `npm test` | 186 / 186 | 186 / 186 |
| `npm run test:db` | **183 / 183** (44 suites) | 161 / 161 |
| `npm run test:e2e` | 152 / 152 (14 suites) | 152 / 152 |
| `npm run test:e2e:cloud` | 55 / 55 (5 suites) | 55 / 55 |

New: `tests/db/childMemberships.test.ts` (20 tests). Changed: `tests/db/account-deletion.test.ts` (5 tests became 7,
section 2). How the required cases map to tests:

| # | Required case | Test |
|---|---|---|
| 1 | existing child backfill | "1, 2. gives every existing child … its family's owner, once"; "every child in the database has exactly one owner" |
| 2 | soft-deleted child backfill | same test (one simulated pre-migration child is soft-deleted) |
| 3 | new child gets an owner | "3, 9. a child created the usual way …"; "… by a server job …" |
| 4 | exactly one owner | "4, 5. a second owner is refused"; the transfer test; the database-wide check |
| 5 | second owner rejected | "4, 5." (insert and promotion, `23505`) |
| 6 | owner can't be removed directly | "6. … can't be removed or demoted, even by the server" (`23514`) |
| 7 | unauthorized modification rejected | "7. no client can create, change or delete a membership, not even the owner" |
| 8 | outsider can't enumerate | "8. an outsider can't enumerate memberships, children or families" |
| 9 | child creation still works | "3, 9."; the upsert test; every existing suite that creates children |
| 10 | sync unchanged | "10. a child created on a device by the app's sync engine …"; `sync.test.ts`, `sync-full-audit.test.ts`, `guestImport.test.ts` and the cloud browser suites, all unchanged and passing |
| 11 | concurrency can't leave a child owner-less | "11. concurrent changes can't leave a child without an owner, or with two" (two connections, with the second shown to block) |
| 12 | family isolation | "12. families stay isolated …"; `security.test.ts` unchanged and passing |

Also covered: both refusals of the backfill (no member; two members), soft delete and restore keep the owner,
immutable identity, removal of a child cascading its memberships, and that a membership grants no record access yet.

**Not verified here:** applying all migrations to an **empty** database. The local stack was not reset (see section
3). CI's `db-tests.yml` does exactly that on the first pull request. The backfill on an empty database finds nothing
and adds nothing.

## 7. Remaining Phase 1b work

- [ ] Access by child role on `children`, `entries`, `activity_records`: select for any role; insert and update for
      owner or editor, checked on the old and new row. `t00_member` becomes a child-role check on these tables.
- [ ] Owner-only identity columns on `children` (`first`, `last`, `dob`, `photo_ref`, `deleted_at` …), via a `t10`
      trigger.
- [ ] Editors may edit and soft-delete records created by others (decided). Viewers read only.
- [ ] `record_versions.child_id` (backfilled from `version`), and versions readable only by the child's owner and the
      version's creator.
- [ ] `photo_children` link, maintained by triggers on `entries.photo_ids` and `children.photo_ref`;
      `photo_object_allowed()` and photo RLS by child role.
- [ ] `complete_migration()` counts only records the caller can access.
- [ ] A helper such as `private.child_role(fid, cid)`, for policies.
- [ ] Three-role test matrix with raw clients (owner, editor, viewer, outsider, plus an unshared sibling), memberships
      created by the service role.
- [ ] Undo migration for 1a and 1b, written and tested locally, not applied.
- [ ] Before any of this reaches staging: Phase 0 blockers 1 and 2 (backups; deployment gated on tests), and the
      read-only staging check in section 3.
