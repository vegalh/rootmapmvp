# Shared Child Profiles: Phase 3 (role-aware screens, a child's circle)

Phase 3 makes the screens follow what each person may do with each child, in warm, plain words. It adds a child's
circle (the people around a child, with how they are related), gentle notes when a profile is no longer shared, and a
small place to review and discard changes that could no longer be sent. The server's permissions are unchanged and
still decide everything; screens only reflect them.

Branch `feature/shared-child-profiles`, after Phase 2b (`634c391`). One new migration, local only. Done 2026-11-01.
Sharing stays switched off in the app (`sharedSyncEnabled`, development server only). Without children shared from
other families, every screen behaves exactly as before.

## 1. Terminology decisions

RootMap is about children and the people who care for them, so screens never say a child belongs to an account, and
never use words from workplace software. The database roles are **not renamed**. Screens map them to what a person can
do:

| Database role (unchanged) | In code (`lib/childAccess.ts`) | English | Chinese | What it means (shown when someone needs to know) |
|---|---|---|---|---|
| `owner` | `manage` | **Manage Profile** | **管理档案** | Can update the child’s profile, invite others and manage access. / 可以更新孩子的档案，邀请他人并管理权限。 |
| `editor` | `edit` | **Add & Edit** | **一起记录** | Can add, edit, and organize the child’s shared growth records. / 可以添加、编辑和整理孩子的成长记录。 |
| `viewer` | `view` | **View Only** | **看看成长** | Can view the child’s shared growth records but cannot make changes. / 可以查看孩子的成长记录，但不能修改。 |

**Other wording:**

| Where | English | Chinese |
|---|---|---|
| The child's people | {name}’s Circle | 陪伴{name}成长的人 |
| Yourself in the circle | You | 你 |
| A person without a name | Someone in the circle | 一位陪伴者 |
| Your own access (people who don't manage the profile) | What you can do: … | 你可以做的事: … |
| A view-only child's page | You can look at {name}’s growth records. | 你可以看看{name}的成长记录。 |
| Inviting (copy only) | Invite someone to be part of {name}’s Circle · The person who manages {name}’s profile can invite others and manage access. · Invitations are coming soon. | 邀请更多人一起陪伴 {name} 成长 · 管理 {name} 档案的人可以邀请他人并管理权限。 · 邀请功能即将推出。 |
| No longer shared | You no longer have access to this child’s profile. (several: You no longer have access to {n} children’s profiles.) | 你已无法查看这份孩子档案。 (several: 你已无法查看 {n} 份孩子档案。) |
| Kept changes | {n} unsent changes are kept on this device. · Review · Unsent changes · Discard / Discard all | 有 {n} 项未发送的更改保留在这台设备上。 · 查看 · 未发送的更改 · 丢弃 / 全部丢弃 |

**Relationship labels**, stored as keys:

| Key | English | Chinese |
|---|---|---|
| mom | Mom | 妈妈 |
| dad | Dad | 爸爸 |
| grandma | Grandma | 奶奶 |
| grandpa | Grandpa | 爷爷 |
| teacher | Teacher | 老师 |
| caregiver | Caregiver | 照护者 |
| family | Family | 家人 |
| other | Other | 其他 |

A unit test fails if any of the new English or Chinese copy contains owner, editor, viewer, admin, collaborator,
membership, revoked, authorization or RLS.

**Where access labels appear:** only in the circle's Manage sheet (for the person managing the profile) and in the
one-line "What you can do" for everyone else. The circle itself shows only people and relationships: no badges.

## 2. Screens changed

| Screen | Change |
|---|---|
| Child profile (`ChildProfilePage`) | Edit and Delete only for Manage Profile. Add Entry, Add Activity, the "save to Journal" import, and Edit/Delete on activity records only for Add & Edit or Manage. View Only shows "You can look at {name}’s growth records." instead. Moving a record offers only children of the same family the person can add to. The circle sits under the child's photo when sharing is on and the person is signed in. |
| Moment detail (`EntryDetailPage`) | Edit and Delete only for Add & Edit or Manage. |
| Moment editor (`EntryEditorPage`, via App) | Chooses only children the person can add to. An existing Moment can only be about a child of its own family. |
| Add Activity (`RecordFormPage`, via App) | Only children the person can add to. |
| Mark as Tried (`ModalOverlay`) | Only children the person can add to. |
| Add to My Week, Repeat, My Week (`ModalOverlay`, `MyWeekPage`) | Only the user's own family's children (My Week is the family's). |
| My Children (`ChildrenPage`) | A gentle note when a profile is no longer shared, with **Review** for kept changes and **Done**. |
| New: `components/ChildCircle.tsx` | The circle, and Manage (relationships, what each kind of access means, invitation copy). |
| New: `components/AccessNotice.tsx` | The note, and the "Unsent changes" sheet. |
| Backup page | Unchanged in Phase 3 (Phase 2b's add-only note). |

**Not changed:** navigation, Discover and the activity catalog, Today (read-only), guest screens, how a child is
created, authentication, and every unrelated page. The styles reuse the existing cards, colours and fonts. Touch
targets are at least 44 px, and the layout is mobile-first.

## 3. Permission behaviour

| Can… | Manage Profile | Add & Edit | View Only |
|---|---|---|---|
| See the child, Moments, activity records, photos | yes | yes | yes |
| Add, edit, delete Moments and activity records (anyone's) | yes | yes | no |
| Attach photos | yes | yes | no |
| Edit the child's profile, delete or restore the child | yes | no | no |
| Give relationships in the circle | anyone's | own (server only; no screen yet) | own (server only) |
| See everyone's access in the circle | yes | own only | own only |

The user's own children, and every child in the guest space, are always Manage Profile. Screens read a shared child's
role from what sync last confirmed (`ScopeState.shared`). A child sync doesn't know yet is treated as View Only.

**The server still decides.** Hiding buttons only spares people a refusal. Phase 1b's RLS, Phase 2's refusal
handling and every database test are unchanged.

**Soft-deleted children (database change, migration `20261101000400_circle.sql`):**

- `private.child_role` now gives nobody but the owner a role for a soft-deleted child. Every Phase 1b policy and
  trigger goes through it, so for everyone else the child, its records, photos (rows and files), versions and circle
  disappear until it is restored.
- The person's own membership row is hidden too. Their devices therefore remove the child through the usual two-answer
  removal (archiving any unsent changes) and show "You no longer have access to this child’s profile."
- Memberships are kept, so the owner's existing Recently Deleted → Restore brings everyone back, data included.
- Nothing is permanently deleted.

## 4. Relationship-label implementation

The schema had no place for relationships, so this is the smallest additive change (same migration):

- `child_memberships.relationship`: nullable, one of the eight keys above. Nothing is inferred from identity, gender
  or role, and it is empty until someone chooses one. Screens show nothing for an empty relationship.
- `public.child_circle(family, child)` (security definer): the circle for anyone in it, with display name (from
  `profiles`) and relationship. Each person's access and id go only to the owner (needed to manage them); everyone
  else gets only their own. No emails. Someone not in the circle gets the same refusal whether or not the child exists.
- `public.set_circle_relationship(family, child, user, relationship)`: the owner for anyone in the circle; anyone else
  only for themselves. Memberships stay unwritable by clients (Phase 1a), and roles can't change through it.
- Screens: Manage offers the eight choices plus "Not set" for each person.

## 5. Photo handling

- Add & Edit and Manage Profile can attach photos to a shared child's Moments. A new photo for one shared child goes
  to that child's family (Phase 2b, `photos.child_id`). View Only has no editor, and the server refuses a viewer's
  photo anyway (Phase 2b).
- **A Moment about children of two families.** A photo always belongs to one family, so each other family gets its
  own copy (`lib/sharedPhotos.ts` `photosForChildren`, store `copyPhotoForFamily`):
  - the bytes are copied on this device into a new photo of the destination family, for that child, and uploaded and
    verified there;
  - the original is never changed or deleted;
  - the first family a new photo is for keeps it, and a photo already in a family stays there;
  - if any copy can't be made, nothing is saved and the person sees "A photo couldn’t be prepared for every child, so
    nothing was saved. Please try again."
- This removes the Phase 2b risk of a cross-family photo reference that would wait forever.

## 6. Revocation and archived edits

- Feedback is plain: no "membership", "revoked", "authorization" or "RLS".
- The note appears once per child, on this device, until **Done**. That is remembered in the device-only setting
  `rootmap-access-notices`, which is not backed up.
- **Unsent changes:** Review lists each kept change only by kind (Moment, Activity record, Profile change, Photo,
  Earlier version) and the date it was kept.
  - Never its text, photos, or the child's name: the store function `archivedChanges()` returns only that.
  - Discard and Discard all remove them from the device for good (`discardArchived`).
  - Another account on the device never sees them (Phase 2b).

## 7. Test results

All on 2026-11-01, against the local stack.

| Command | Result | Before Phase 3 |
|---|---|---|
| `npm run typecheck` | clean | clean |
| `npm test` | **202 / 202** (5 new) | 197 / 197 |
| `npm run test:db` | **229 / 229** (57 suites; 6 new) | 223 / 223 |
| `npm run test:e2e` | 152 / 152 | 152 / 152 |
| `npm run test:e2e:cloud` | **81 / 81** (7 suites; new `circle.mjs` 9 / 9) | 72 / 72 |
| `vite build` (cloud off) | builds; no Supabase in the bundle | same |

`circle.mjs` also passed 9/9 on two standalone runs before the full run.

**New and changed tests:**

- `tests/unit/childAccess.test.ts` (5): role mapping; own and guest children are always Manage; pickers; the exact
  English and Chinese labels and descriptions; no technical words; relationship labels.
- `tests/db/circle.test.ts` (6):
  - the owner's view (everyone, with access and ids, no emails);
  - everyone else's view (names and relationships, only their own access);
  - outsider refusal;
  - who can set a relationship, refused labels, roles unchanged, no client writes;
  - the circle while the child is soft-deleted.
- `tests/db/childAccess.test.ts`: the soft-deletion test now checks the new rule (members lose child, records and
  their membership row; can't write or restore; the owner keeps everything; restore brings them back).
- `tests/db/multiFamilySync.test.ts`: a soft-deleted shared child is removed from members' devices after two answers,
  and restoring brings it back with its Moments.
- `tests/e2e/circle.mjs` (9; real browsers for Lin, Grandma Wu, Sarah, and a guest):

| Case | Step |
|---|---|
| Owner permissions; circle display; English labels; relationships | "Managing the profile …" |
| Editor and viewer permissions; multiple children with different roles | "Add & Edit (Mia) and View Only (Leo) on one device …" |
| Chinese labels; missing relationship label | "View Only, in Chinese …" |
| Child pickers | "Pickers …" |
| Shared photo attachment | "A photo for a Moment about Emi and Mia …" |
| Soft-deleted child access; revocation feedback; owner recovery | "Deleting Leo's profile …" |
| Archived edits | "Removed from Mia's circle with a change made offline …" |
| Guest behaviour | "Guest: no circle, no notes …" |

**Failures found along the way:** one, in my own test. A review-sheet assertion read the whole page and found Emi's
own Moment behind the sheet. It now reads the sheet's dialog only. No product fixes were needed after the first run.

**The intermittent analytics test** did not fail this phase (cause unchanged; see Phase 2a).

## 8. Remaining risks

- **Editors and viewers can't set their own relationship from a screen.** The server allows it; the screen is for the
  person managing the profile only.
- **Display names** come from each person's RootMap profile. Someone who never set a name appears as "Someone in the
  circle".
- **The circle needs the network.** Offline it says "The circle can’t be shown right now." It isn't cached on the
  device.
- **Invitations don't exist yet** (Phase 4). The circle can only grow through the server, which is the only way
  memberships are made.
- **A shared child that sync doesn't know yet** is treated as View Only on screen until the next round.
- **Removal is never instant:** a member's device needs two membership answers, about a minute, before a deleted or
  unshared child disappears.
- **Signed URLs** created before a child was deleted or unshared work until they expire (Phase 2b).
- **Staging blockers from Phase 0 still stand:** no backups, deployment not gated on tests, no undo migrations.
  Migrations `000100`–`000400` of this work are local only.
