# Shared Child Profiles: Phase 4 (invitations and circle management)

Phase 4 lets the person managing a child's profile (the Owner) invite other adults into that child's Circle, without
ever writing to `child_memberships` from the client. An invitation is a single-use, time-limited, cryptographically
random link; accepting it is one atomic server call. Everything else — who can do what once someone is in the circle,
how a shared child shows up on a device, how removal and leaving are cleaned up — is unchanged from Phase 3: this
phase only adds how a person gets into the circle in the first place, and a Manage sheet to run it.

Branch `feature/shared-child-profiles`, after Phase 3 (`818f0d2`). One new migration, local only. Sharing stays
switched off in production (`sharedSyncEnabled`, development server only); an invitation link is refused outright if
opened where sharing is off (`allowedRoute` in `App.tsx`), so a stale or copied link can never do anything in
production regardless of what it addresses.

## 1. Reviewed before building (no duplicated infrastructure)

Per the brief, before writing anything the existing Phase 1–3 infrastructure was reviewed and reused as-is:

- **`child_memberships`** (Phase 1a): still the only table a membership lives in, still never written to directly by
  a client, still enforces exactly one Owner via trigger `t50_one_owner`. Phase 4 adds rows to it only through new
  SECURITY DEFINER functions (`accept_invitation`, `set_member_role`, `remove_member`, `leave_circle`); no new client
  write path was added.
- **`ChildCircle.tsx`** (Phase 3): extended in place — the existing people list, relationship picker and "Manage"
  sheet gained an "Invite Someone" section and a pending-invitations list. The component's people-list query, its
  `canManage`/`canAddAndEdit` checks (`lib/childAccess.ts`) and its leave-circle button are unchanged.
- **`ChildAccess`** (`lib/childAccess.ts`): unchanged. Role → UI label mapping, `accessOf`, `canManage`, `canAddAndEdit`
  all still come from here; invitations only ever grant `editor` or `viewer`, never `owner`.
- **Supabase authentication**: unchanged. Invitation preview and acceptance both require `auth.uid()` (a real,
  signed-in session); no new auth mechanism was introduced for invitations.
- **Multi-family synchronization** (Phase 2a/2b): unchanged. An accepted invitation creates exactly the same kind of
  `child_memberships` row a server-side grant would, so the existing sync engine already knows how to bring the
  child's scope and records to the new member's device — Phase 4 only triggers an immediate round (`syncNow()`,
  `lib/sync/runner.ts`) so it doesn't wait for the regular interval.
- **Revocation cleanup** (Phase 2b): unchanged. Removing a member or leaving a circle simply deletes the
  `child_memberships` row; the device picks this up the same way it already does for any membership change (two
  membership answers), and the existing local cleanup (scope loss, archived unsent edits) runs exactly as before.
- **Existing RLS policies**: unchanged. `child_invitations` follows the same pattern as `child_memberships` — RLS
  enabled, no client policy at all, `service_role` only (for test fixtures); every real access goes through a
  SECURITY DEFINER function that re-checks the caller.

## 2. Database changes

New migration: `supabase/migrations/20261101000500_invitations.sql` (local only; not deployed to staging).

**New tables:**

| Table | Purpose |
|---|---|
| `public.child_invitations` | One row per invitation: `family_id`/`child_id` (FK to `children`, cascades on delete), `role` (`editor`/`viewer`, never `owner`), `token_hash` (SHA-256 hex, unique), optional lowercased `email`, `created_by`, `created_at`, `expires_at` (default `now() + 7 days`), `accepted_at`/`accepted_by`, `revoked_at`/`revoked_by`. RLS on, no client policy — `service_role` only. |
| `private.invitation_limits` | Per-account, per-day, per-kind (`preview`/`accept`) attempt counter for rate limiting. |

**New functions** (all `SECURITY DEFINER`, `search_path = ''`, each re-checking the caller's own role or identity
every time — nothing trusts a prior answer or what the client already rendered):

| Function | Who may call it | What it does |
|---|---|---|
| `create_invitation(family_id, child_id, role, email?)` | The child's Owner only | Generates a 192-bit random token (`gen_random_bytes(24)`), stores only its SHA-256 hash, returns the raw token **exactly once**. |
| `list_invitations(family_id, child_id)` | The Owner only | Lists all invitations for a child (pending, accepted, revoked), never the token or its hash. |
| `revoke_invitation(id)` | The Owner only | Idempotent: revoking an already-revoked/accepted invitation changes nothing and doesn't error. |
| `get_invitation_preview(token)` | Any signed-in account | Tells the caller what a token is worth (`invalid`/`expired`/`revoked`/`accepted`/`wrong_email`/`valid`) without ever naming a child unless the token is currently valid for them. |
| `accept_invitation(token)` | Any signed-in account | Locks the invitation row (`select … for update`) for the whole call, re-validates everything, creates (or updates) the membership, marks the invitation used. Atomic and race-safe (§3). |
| `set_member_role(family_id, child_id, user_id, role)` | The Owner only | Changes an editor/viewer's role; refuses to touch the Owner's own row. |
| `remove_member(family_id, child_id, user_id)` | The Owner only | Removes a member; refuses to remove the Owner. |
| `leave_circle(family_id, child_id)` | Any current editor/viewer, for themself | Removes their own membership; refused for the Owner (who has nowhere to "leave" to). |

`private.check_invitation_rate(kind, limit)` is called first thing inside `get_invitation_preview` (60/day) and
`accept_invitation` (30/day), raising `54000` once exceeded — bounding how many times a guessed or stolen token can be
tried per account per day.

## 3. Invitation security

- **Token generation**: `extensions.gen_random_bytes(24)` (192 bits of cryptographically secure randomness from
  PostgreSQL's `pgcrypto`), hex-encoded. Not derived from any predictable input (no sequential id, timestamp, or
  user-supplied value).
- **Storage**: only `encode(digest(raw_token, 'sha256'), 'hex')` is ever written to `child_invitations.token_hash`.
  The raw token is returned once, by `create_invitation`, in its RPC response — never stored, logged, or returned
  again by any other function.
- **Never logged**: `InvitePage.tsx`'s own comment states the rule it follows — the raw token never appears in its
  own text, a toast, or a log; it only ever lives inside the one link (`#/invite/<token>` in the address bar) and the
  RPC calls that read it. `ChildCircle.tsx`'s invite-generation flow puts the link straight onto the clipboard /
  into the Web Share sheet; nothing else renders or stores the raw token.
- **Atomic, race-safe acceptance**: `accept_invitation` takes `select … for update` on the invitation row for the
  whole function body, so two concurrent callers of the same token can never both create a membership — the second
  caller's transaction blocks until the first commits, then sees `accepted_at` already set and returns `'accepted'`
  instead of creating a duplicate row. Verified by DB test #8 ("two concurrent acceptances of the same token create
  only one membership") using two overlapping `Promise.all` calls against the same token.
- **Single-use**: `accepted_at`/`accepted_by` are set the moment acceptance succeeds; every subsequent attempt against
  the same token (by the same or a different account) sees `status = 'accepted'` and creates nothing.
- **Expiry**: `expires_at` defaults to `now() + interval '7 days'` at creation and is never extended; both preview
  and acceptance re-check it against `now()` on every call (not cached).
- **Revocation**: `revoke_invitation` is Owner-only and idempotent; both preview and acceptance check `revoked_at`
  on every call, so a revoked token stops working immediately, even one already open in another tab.
- **Unguessable, non-enumerable**: a 192-bit random hex token cannot feasibly be enumerated or brute-forced within the
  rate limit; an unknown token answers `'invalid'` — exactly the same answer a token whose child was deleted gives —
  so a guess learns nothing about whether a child or invitation ever existed.
- **Rate limiting**: `private.invitation_limits` bounds preview calls (60/account/day) and acceptance calls
  (30/account/day); exceeding either raises a Postgres exception (`errcode 54000`) before any invitation row is even
  looked at.

## 4. Optional email restriction

- `create_invitation`'s `p_email` is normalized (lowercased, trimmed) and validated with a simple email-shape check
  before being stored; an invalid shape is refused before any row is written.
- When an invitation carries an `email`, both `get_invitation_preview` and `accept_invitation` require the caller's
  own `auth.users.email` to match it **and** `email_confirmed_at` to be set (a verified address) — an unverified or
  different-but-accidentally-similar address is refused exactly the same as a mismatched one (`'wrong_email'`).
- The restricted email itself is **never returned** to the caller in `get_invitation_preview`'s `'wrong_email'`
  response — only the status, so an unauthorized viewer can't learn which address the invitation is restricted to.
- `InvitePage.tsx`'s wrong-email screen offers "Sign In With a Different Account" (`switchAccount`), which signs out
  **without losing the invitation address** (`signOutKeepingInvite` in `App.tsx` omits `screen` from the post-signout
  state, so the `#/invite/<token>` hash survives the reload) — the next sign-in returns straight to the same
  invitation instead of Profile.
- With no `email` set, any authenticated account holding the valid token may accept — unchanged, unrestricted
  behavior.

No invitation emails are sent in this phase; the Owner shares the link themselves (Web Share API or copy-link), per
the brief.

## 5. UI changes (`src/components/ChildCircle.tsx`, `src/pages/InvitePage.tsx`)

**Manage sheet** (extended, not replaced):

1. Open the child's Circle → "Manage" (Owner only, unchanged from Phase 3).
2. "Invite Someone" shows the two role choices using the same Phase 3 labels — **Add & Edit / 一起记录** and
   **View Only / 看看成长** — never "editor"/"viewer".
3. An optional email field ("Only one email can accept (optional)").
4. "Create Invitation Link" calls `create_invitation`, then shows "Copy Link" and "Share Link" (Web Share API
   `navigator.share` where available, with an automatic clipboard-copy fallback when it isn't, or on failure).
5. The raw token is never shown as text anywhere in the sheet — only ever embedded in the link itself.
6. "Pending Invitations" lists existing invitations by role, email restriction (if any) and status (pending /
   joined / expired / canceled, with `inviteExpiresOn`), with a "Cancel Invitation" action (confirmed) for
   still-pending ones.
7. The existing member list gained role-change and remove controls (Owner only; both refuse to touch the Owner's
   own row, matching the server-side refusal), and "Leave the Circle" for non-Owners (unchanged from Phase 3,
   confirmed before acting).
8. Each member — including the caller themself (`is_me`) — can still set their own relationship from the same
   picker as Phase 3; the eight existing choices (mom/dad/grandma/grandpa/teacher/caregiver/family/other) are
   unchanged, and nothing is inferred automatically.

All copy was written to avoid corporate terminology (no "invite collaborator", "share access", "admin", etc. — the
Phase 3 unit test that fails on banned words in new English/Chinese copy still passes with the Phase 4 additions).

## 6. Accept invitation (`src/pages/InvitePage.tsx`, `src/App.tsx`)

- **Route**: `#/invite/<token>` (`lib/routes.ts`); a brand-new `Screen` (`"invite"` in `types.ts`).
- **Defense in depth**: `allowedRoute()` in `App.tsx` refuses the `invite` screen outright unless
  `cloudConfig.enabled && sharedSyncEnabled` — an invitation link opened in a build where sharing is off (i.e.
  production, today) does nothing, regardless of whether the token itself is valid.
- **Signed out**: the invitation is never shown before authentication. `App.tsx` detects
  `screen === "invite" && cloud.status === "signed-out"` and routes straight to the sign-in form (no "Continue as
  guest", no Welcome screen first) while **preserving `#/invite/<token>` in the address bar** throughout — sign-in
  (email + code, or password) completes and the app lands back on the same invitation automatically, because the
  hash was never changed.
- **Preview before acceptance**: once signed in, `InvitePage` calls `get_invitation_preview` and shows only what it
  returns — the child's first name, the family's name, the role on offer, and the inviter's display name, **only**
  when `status === 'valid'`. Every other status (`invalid`/`expired`/`revoked`/`accepted`/`wrong_email`) shows a
  single gentle, non-technical sentence (e.g. "This invitation has expired. Ask them for a new link." /
  "This invitation is no longer available.") — nothing about the child is ever shown first.
- **Accept or Decline**: both buttons are always available once a preview is valid; "Decline" simply navigates to
  Today (no server call). "Accept" calls `accept_invitation`, then waits (polling the same local, reactive
  `children` collection My Children reads from, up to 20×400ms while nudging `syncNow()`) until the newly shared
  child is actually present on the device before opening its profile — so the profile is never opened half-loaded.
- **No duplicate child**: acceptance only ever creates a `child_memberships` row; the child record itself already
  exists (it belongs to the inviting family) and is never copied or recreated. Confirmed by e2e step "Accepting: …
  no duplicate child …" and DB test #22.
- **Token leaves the address bar on acceptance**: `App.tsx`'s `accepted` callback replaces the current history entry
  with `#/today` (`history.replaceState`) before navigating to the child's profile, so the spent token is not only
  off-screen but also not reachable via browser Back.
- **Fixed this phase**: `InvitePage` is now mounted with `key={inviteToken}` in `App.tsx`, so navigating from one
  invitation link straight to a different one (without an intervening reload) always remounts the page with fresh
  state, instead of briefly showing the previous token's stale phase/message. (Found via the "Revoked invitation"
  e2e step intermittently showing a stale "expired" message for a different, just-revoked token.)

## 7. Manage the Circle, leaving, and relationship labels

Unchanged from the brief's existing design, now backed by the new server functions:

- **View members / change roles / remove members / revoke pending invitations / view expiration**: all exposed in
  the extended Manage sheet (§5), backed by `list_invitations`, `set_member_role`, `remove_member`,
  `revoke_invitation`.
- **The Owner cannot accidentally remove themselves**: `set_member_role` and `remove_member` both raise
  (`42501`) if `p_user_id = auth.uid()` when the caller is the Owner; the UI doesn't even render those controls next
  to the Owner's own row. Ownership transfer remains out of scope for this phase; `t50_one_owner` (Phase 1a)
  continues to guarantee exactly one Owner regardless.
- **Leaving**: `leave_circle` deletes the caller's own membership row (refused for the Owner). The existing Phase 2b
  revocation path (two membership answers → scope loss → archived unsent edits → child disappears from My Children)
  is unchanged and untouched by this phase; it already handles both server-initiated removal and self-initiated
  leaving identically, since both simply delete the same `child_memberships` row.
- **Relationship labels**: members (including one who joined by invitation) set their own label from the same
  Circle picker as Phase 3 (`set_circle_relationship`, unchanged); the eight existing choices are preserved exactly,
  and nothing is inferred from the invited role.

## 8. Authentication and privacy

Reviewed per the brief (§9):

- **Email sign-in / session restoration**: unchanged (`lib/cloud/auth.ts`, `lib/cloud/session.ts`); invitations reuse
  the existing signed-in/signed-out state (`cloud.status`) without any new session mechanism.
- **Deep links**: `#/invite/<token>` round-trips through `formatRoute`/`parseRoute` (`lib/routes.ts`) the same as
  every other address; a browser refresh or a fresh tab opened directly on the link lands on the same invitation.
- **Mobile Capacitor behavior**: not separately touched this phase — the invitation route is a plain hash address,
  the same mechanism every other deep link in the app already uses on the Capacitor build; no new native code.
- **Wrong account can't accept**: `accept_invitation` and `get_invitation_preview` both check the *signed-in*
  account's own identity (`auth.uid()`, and its own `auth.users.email` for a restricted invitation) on every call;
  there is no way for a client to assert a different identity, since these are `SECURITY DEFINER` functions that
  only ever trust `auth.uid()` from the request's own JWT.
- **Signing out removes server access immediately**: unchanged, existing behavior — RLS and every function here
  check `auth.uid()` fresh each call, so a signed-out browser has no residual access; there is no separate
  "continued access" state to revoke.
- **Invitations don't expose unrelated family data**: `get_invitation_preview` returns only the one child's first
  name, the one family's name, the offered role and the inviter's display name — nothing else about the family, and
  nothing at all unless the token is valid for the caller right now.
- **Expired/invalid links**: both show a single gentle sentence (§6); an invalid or unknown token's answer
  (`'invalid'`) is indistinguishable from one whose child no longer exists, so a guess never learns whether a child
  exists (DB test "an unknown token answers exactly like one whose child no longer exists").
- **Tokens kept out of logs/analytics**: no invitation code path calls into `lib/analytics/*`; `InvitePage.tsx` and
  `ChildCircle.tsx`'s invite flow never pass the token to `notify()`/toast text, console, or any tracked event.
- **Removed from browser history after use**: handled for acceptance by the explicit `history.replaceState` (§6);
  declining an invitation also leaves the token behind naturally, since navigating to `"today"` reformats the hash
  via `formatRoute` to `#/today` (the `invite` field is only read for the `"invite"` screen itself).

## 9. Tests

All 23 scenarios from the brief are covered, split between the DB layer (server-enforced rules) and the browser
layer (end-to-end flows through real UI and real HTTP calls against the local Supabase stack):

| # | Scenario | Covered by |
|---|---|---|
| 1 | Owner creates invitation | `tests/db/invitations.test.ts` #1; e2e "Owner creates an invitation …" |
| 2 | Editor cannot invite | `tests/db/invitations.test.ts` #2; e2e "An Editor cannot invite …" |
| 3 | Viewer cannot invite | `tests/db/invitations.test.ts` #3 |
| 4 | Valid invitation acceptance | `tests/db/invitations.test.ts` #4; e2e "Accepting: …" |
| 5 | Expired invitation | `tests/db/invitations.test.ts` #5; e2e "Expired invitation: …" |
| 6 | Revoked invitation | `tests/db/invitations.test.ts` #6; e2e "Revoked invitation: …" |
| 7 | Single-use token | `tests/db/invitations.test.ts` #7; e2e "Single-use: …" |
| 8 | Concurrent acceptance | `tests/db/invitations.test.ts` #8 (two overlapping `accept_invitation` calls) |
| 9 | Email-restricted invitation | `tests/db/invitations.test.ts` #9; e2e "Email-restricted invitation, matching account: …" |
| 10 | Wrong-email rejection | `tests/db/invitations.test.ts` #10; e2e "Email-restricted invitation, wrong account: …" |
| 11 | Multiple members on one child | `tests/db/invitations.test.ts` #11; e2e "Manage: changing a member's role …" |
| 12 | One user joining multiple children | `tests/db/invitations.test.ts` #12 |
| 13 | Role changes | `tests/db/invitations.test.ts` #13; e2e "Manage: …" |
| 14 | Member removal | `tests/db/invitations.test.ts` #14; e2e "Manage: …" |
| 15 | Member leaving | `tests/db/invitations.test.ts` #15; e2e "Leaving the Circle: …" |
| 16 | Relationship editing | `tests/db/invitations.test.ts` #16 |
| 17 | Sign-out during invitation | e2e "Email-restricted invitation, wrong account: …" (`switchAccount`/`signOutKeepingInvite`) |
| 18 | Account switching | e2e "Email-restricted invitation, wrong account: …" → "… matching account: …" |
| 19 | Invitation deep-link restoration | e2e "Deep link, signed out: …" |
| 20 | Existing guest behavior | `tests/e2e/circle.mjs` "Guest: no circle, no notes, the profile's own actions as before" |
| 21 | No duplicate child creation | `tests/db/invitations.test.ts` #22 (first assertion); e2e "Accepting: … no duplicate child …" |
| 22 | Full sync after joining | `tests/db/invitations.test.ts` #22; e2e "Accepting: … a full sync brings Mia and her Moment …" |
| 23 | Revocation cleanup after removal | `tests/db/invitations.test.ts` #23; `tests/e2e/circle.mjs` "Removed from Mia's circle with a change made offline: …" |

**Full results** (this session, local Supabase stack, `npm run db:start`):

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **203 / 203** (+1: a route round-trips the invite screen/token) |
| `npm run test:db` | **252 / 252** (63 suites; +23 in 6 new `describe` blocks, `tests/db/invitations.test.ts`) |
| `npm run test:e2e` (non-cloud, 14 suites) | **149 / 149**, unaffected — no file in this chain was touched |
| `npm run test:e2e:cloud` (8 suites) | **93 / 93** — `cloud.mjs` 15/15, `spaces.mjs` 10/10, `sync.mjs` 12/12, `guestImport.mjs` 7/7, `analytics.mjs` 11/11, `sharing.mjs` 17/17, `circle.mjs` 9/9, `invitations.mjs` 12/12 |

`invitations.mjs` was newly written this phase (12 steps, listed in §9's table above) and wired into
`test:e2e:cloud` as its final suite. The full chain was run three times in a row with 0 failures to confirm it
wasn't flaky, and once more as the final check before this commit.

**Bugs found and fixed while getting to a clean run** (not pre-existing issues; all introduced or newly surfaced by
this phase's own code):

1. **`InvitePage` stale phase on token change** (production bug): the fetch effect never reset `phase` back to
   `"checking"` when `token` changed, so navigating between two different invitation links without a full reload
   could show the previous invitation's stale message. Fixed with `key={inviteToken}` in `App.tsx` (§6).
2. **`tests/e2e/invitations.mjs` itself leaked one headless Chrome instance per run** (test-only bug): the "Deep
   link, signed out" step reassigned a device variable to a freshly launched browser without closing the previous
   one. Fixed by closing it first.
3. Two test-only fixture bugs (not app bugs) while writing `invitations.mjs`: `ChildCircle`'s `people` list is only
   fetched once per mount (needed an explicit navigate-away-and-back in the test to see a just-joined member — see
   "remaining risks" below), and a test helper used `PATCH` to set a display name before the corresponding
   `profiles` row existed (silently a no-op); replaced with an upserting helper.

## 10. Remaining risks

- **The Circle's member list only refreshes on remount.** `ChildCircle.tsx` fetches `people` once per mount
  (`useEffect(() => void load(), [familyId, childId])`); reopening the same child's page repeatedly (without
  visiting a different screen in between) will not show a member who joined moments ago via their own device until
  the component remounts. This is pre-existing Phase 3 behavior, not introduced by Phase 4, but invitations make it
  more likely someone checks "did they join yet?" right after sharing a link. Worth a small follow-up (e.g. a
  pull-to-refresh or a refetch on sheet-open) in a later phase; not addressed here as it's outside this phase's
  scope and does not affect correctness (the server is always authoritative).
- **No invitation emails are sent** (by design, per the brief) — the Owner must share the link themselves. A future
  phase could add optional email delivery.
- **Ownership transfer is out of scope** for this phase (per the brief) — a child can never have more than one
  Owner, and the Owner can only stop managing a child by deleting it (unchanged from Phase 3), not by handing off
  management.
- **Mobile Capacitor-specific deep-link handling** (e.g. universal links opening the installed app directly from a
  shared URL, rather than a browser tab) was not built or tested this phase — the invitation route works as a plain
  in-app hash address today, which is sufficient for the web app and for links opened inside the installed app's own
  webview, but a true OS-level deep link (opening the app from outside it) is unaddressed.
- **`analytics.mjs` has a pre-existing, unrelated environmental flake** (an uncaught `waitFor timed out: app
  rendered` under heavy system load) observed once this session and not reproduced in isolation; not a Phase 4
  regression (no files in that suite were touched), but worth noting since it surfaced during this phase's testing.
- **Staging blockers from Phase 0 still stand**: no backups, deployment not gated on tests, no undo migrations.
  Every migration through this phase, including `20261101000500_invitations.sql`, is local only.

## 11. Is Shared Child Profiles ready for controlled testing?

Yes, for a small, trusted group of real users on a non-production (development/local) build, with the following
understanding:

- Every database rule (ownership, expiry, revocation, single-use, email restriction, rate limiting, atomic
  concurrent acceptance) is enforced server-side and covered by passing tests; the client UI only ever reflects what
  the server allows.
- Sharing remains switched off in production (`sharedSyncEnabled`) and the invitation route itself additionally
  refuses to open unless sharing is on, so none of this is reachable by real users until that flag changes.
- The one known UX gap (member list needing a remount to show a very recently joined member) is cosmetic, not a
  security or data-integrity issue, and worth fixing before a wider rollout but not before controlled testing with a
  small group who can tolerate "pull down or navigate away and back to refresh."
- No staging deployment, migration, or production flag change has been made as part of this phase, per the brief.
