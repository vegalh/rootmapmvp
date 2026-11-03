-- Shared Child Profiles, Phase 4: invitations and circle management (docs/shared-child-profiles-phase4.md).
--
-- A child's Owner can invite another adult to become an Add & Edit or View Only member, without any new client
-- write path into `child_memberships` (still unwritable by clients, Phase 1a). Everything here is a SECURITY DEFINER
-- function that re-checks the caller's own role every time; nothing trusts what the client already showed.
--
-- 1. `child_invitations`: one row per invitation. Only a SHA-256 hash of the token is stored (`token_hash`); the raw
--    token is generated from `extensions.gen_random_bytes(24)` (192 bits) and returned exactly once, by
--    `create_invitation`. It never appears again in any table, log or response. An invitation may optionally be
--    restricted to one email address (stored lowercased); when it is, only a signed-in account with that email,
--    confirmed, may accept it. Invitations expire after 7 days and are single-use.
-- 2. Acceptance is atomic: `accept_invitation` locks the invitation row (`select … for update`) for the whole call,
--    so two concurrent callers of the same token never both create a membership — the second sees it already
--    accepted once the first commits. It re-validates expiry, revocation and the email restriction itself; it never
--    trusts `get_invitation_preview`'s earlier answer.
-- 3. Both `get_invitation_preview` and `accept_invitation` require a signed-in caller (`auth.uid()`), so an
--    invitation link reveals nothing about a child before authentication. A token that doesn't exist, one that is
--    expired, revoked, already used, or restricted to a different email are told apart only after sign-in, and an
--    unknown token answers exactly like a child that was never shared (`'invalid'`), so a guess can't learn whether
--    a child exists. Both functions are rate-limited per signed-in account per day (`private.check_invitation_rate`).
-- 4. Circle management: `set_member_role`, `remove_member` (the Owner, for anyone but themself) and `leave_circle`
--    (anyone but the Owner, for themself) are the only ways to change or remove a membership other than accepting an
--    invitation. All three refuse to ever touch the Owner's own row, so a child always keeps exactly one Owner
--    (enforced again, as always, by the existing `t50_one_owner` trigger). Removing or leaving simply deletes the
--    membership row; the device-side revocation cleanup already built in Phase 2b takes it from there.

-- ---- Invitations -----------------------------------------------------------------------------------------------

create table public.child_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  child_id text not null,
  -- Never 'owner': a child already has exactly one, and ownership transfer isn't part of this phase.
  role text not null check (role in ('editor', 'viewer')),
  -- SHA-256 of the raw token, hex-encoded. The raw token itself is never stored.
  token_hash text not null unique,
  -- Optional: only this (lowercased) address may accept. Null means any authenticated account with the token may.
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  -- Goes with the child: an invitation to a child that no longer exists can never be accepted.
  foreign key (family_id, child_id) references public.children (family_id, id) on delete cascade
);
create index child_invitations_child_idx on public.child_invitations (family_id, child_id);

alter table public.child_invitations enable row level security;
-- No client policy at all, on purpose (same as `child_memberships`, Phase 1a): every read and write goes through a
-- SECURITY DEFINER function below, which re-checks the caller every time. service_role (used only by tests seeding
-- fixtures directly) keeps full access.
revoke all on public.child_invitations from public, anon, authenticated;
grant all on public.child_invitations to service_role;

-- ---- Rate limiting ----------------------------------------------------------------------------------------------

-- Per signed-in account, per server day, per kind of call. Same shape as `private.usage_limits`
-- (20261027000100_usage_analytics.sql); an invitation link is far lower-volume than analytics, so one row per
-- account per day is plenty.
create table private.invitation_limits (
  user_id uuid not null,
  day date not null,
  kind text not null check (kind in ('preview', 'accept')),
  attempts integer not null default 0,
  primary key (user_id, day, kind)
);
alter table private.invitation_limits enable row level security;
revoke all on private.invitation_limits from public, anon, authenticated;

-- Raises 54000 once the caller's attempts of this kind, today, pass `p_limit`. Called first thing inside
-- `get_invitation_preview` and `accept_invitation`, so a guessed or stolen token can only be tried a bounded number
-- of times a day per account.
create function private.check_invitation_rate(p_kind text, p_limit integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  used integer;
begin
  insert into private.invitation_limits (user_id, day, kind) values (uid, current_date, p_kind) on conflict do nothing;
  update private.invitation_limits set attempts = attempts + 1
   where user_id = uid and day = current_date and kind = p_kind
  returning attempts into used;
  if used > p_limit then
    raise exception 'rate limited' using errcode = '54000';
  end if;
end;
$$;

-- ---- Creating, listing and revoking (the Owner only) ---------------------------------------------------------

-- Returns the raw token exactly once; only its hash is ever stored. Refused for anyone but the child's Owner.
create function public.create_invitation(p_family_id uuid, p_child_id text, p_role text, p_email text default null)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  raw_token text;
  norm_email text;
  new_id uuid;
  new_expires timestamptz;
begin
  if auth.uid() is null or not private.is_child_owner(p_family_id, p_child_id) then
    raise exception 'not allowed to invite for this child' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  norm_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  if norm_email is not null
     and (char_length(norm_email) > 254 or norm_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  raw_token := encode(extensions.gen_random_bytes(24), 'hex');
  new_expires := now() + interval '7 days';
  insert into public.child_invitations (family_id, child_id, role, token_hash, email, created_by, expires_at)
  values (p_family_id, p_child_id, p_role, encode(extensions.digest(raw_token, 'sha256'), 'hex'), norm_email, auth.uid(), new_expires)
  returning child_invitations.id into new_id;
  return query select new_id, raw_token, new_expires;
end;
$$;

-- All invitations for a child (pending, accepted and revoked alike; the screen tells them apart from the
-- timestamps), newest first. Never the token or its hash. Refused for anyone but the child's Owner.
create function public.list_invitations(p_family_id uuid, p_child_id text)
returns table (id uuid, role text, email text, created_at timestamptz, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_child_owner(p_family_id, p_child_id) then
    raise exception 'not allowed to list invitations for this child' using errcode = '42501';
  end if;
  return query
    select i.id, i.role, i.email, i.created_at, i.expires_at, i.accepted_at, i.revoked_at
    from public.child_invitations i
    where i.family_id = p_family_id and i.child_id = p_child_id
    order by i.created_at desc;
end;
$$;

-- Idempotent: revoking an already-revoked or already-accepted invitation changes nothing (and doesn't error), so a
-- slow double-tap on "Revoke" is harmless.
create function public.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  inv public.child_invitations%rowtype;
begin
  select * into inv from public.child_invitations where id = p_id for update;
  if not found or auth.uid() is null or not private.is_child_owner(inv.family_id, inv.child_id) then
    raise exception 'not allowed to revoke this invitation' using errcode = '42501';
  end if;
  if inv.accepted_at is null and inv.revoked_at is null then
    update public.child_invitations set revoked_at = now(), revoked_by = auth.uid() where id = p_id;
  end if;
end;
$$;

-- ---- Previewing and accepting (any signed-in account) ---------------------------------------------------------

-- Tells a signed-in caller what a token is worth, without ever revealing a child before one holds a token that is
-- currently valid for them. `status` is one of 'invalid' (unknown token, or its child no longer exists or is
-- soft-deleted — the same answer either way), 'expired', 'revoked', 'accepted' (already used), 'wrong_email' (needs
-- a different, verified account) or 'valid'. Only 'valid' carries the child's first name, the family's name, the
-- role on offer and the inviter's display name; every other status carries only itself.
create function public.get_invitation_preview(p_token text)
returns table (status text, child_first text, family_name text, role text, inviter_name text)
language plpgsql security definer set search_path = '' as $$
declare
  h text;
  inv public.child_invitations%rowtype;
  caller_email text;
  caller_confirmed boolean;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  perform private.check_invitation_rate('preview', 60);
  h := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select * into inv from public.child_invitations where token_hash = h;
  if not found or private.child_is_deleted(inv.family_id, inv.child_id) then
    return query select 'invalid', null::text, null::text, null::text, null::text; return;
  end if;
  if inv.revoked_at is not null then
    return query select 'revoked', null::text, null::text, null::text, null::text; return;
  end if;
  if inv.accepted_at is not null then
    return query select 'accepted', null::text, null::text, null::text, null::text; return;
  end if;
  if inv.expires_at < now() then
    return query select 'expired', null::text, null::text, null::text, null::text; return;
  end if;
  if inv.email is not null then
    select u.email, u.email_confirmed_at is not null into caller_email, caller_confirmed from auth.users u where u.id = auth.uid();
    if caller_confirmed is not true or lower(coalesce(caller_email, '')) <> inv.email then
      return query select 'wrong_email', null::text, null::text, null::text, null::text; return;
    end if;
  end if;
  return query
    select 'valid', c.first, coalesce(f.name, ''), inv.role, coalesce(p.display_name, '')
    from public.children c
    left join public.families f on f.id = inv.family_id
    left join public.profiles p on p.user_id = inv.created_by
    where c.family_id = inv.family_id and c.id = inv.child_id;
end;
$$;

-- Accepts a token for the signed-in caller, atomically. Locks the invitation row for the whole call
-- (`select … for update`), so two concurrent acceptances of the same token can never both create a membership: the
-- loser sees `status = 'accepted'` once the winner commits. Re-validates everything `get_invitation_preview` checks
-- (never trusts it), then creates (or, for a repeat tap by the same already-accepted caller, leaves alone) the
-- membership and marks the invitation used. `status` adds 'ok' (accepted just now) to the preview's vocabulary; only
-- 'ok' carries the family, child and role the caller may now use.
create function public.accept_invitation(p_token text)
returns table (status text, family_id uuid, child_id text, role text)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h text;
  inv public.child_invitations%rowtype;
  caller_email text;
  caller_confirmed boolean;
  existing_role text;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  perform private.check_invitation_rate('accept', 30);
  h := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select * into inv from public.child_invitations where token_hash = h for update;
  if not found or private.child_is_deleted(inv.family_id, inv.child_id) then
    return query select 'invalid', null::uuid, null::text, null::text; return;
  end if;
  if inv.revoked_at is not null then
    return query select 'revoked', null::uuid, null::text, null::text; return;
  end if;
  if inv.accepted_at is not null then
    return query select 'accepted', null::uuid, null::text, null::text; return;
  end if;
  if inv.expires_at < now() then
    return query select 'expired', null::uuid, null::text, null::text; return;
  end if;
  if inv.email is not null then
    select u.email, u.email_confirmed_at is not null into caller_email, caller_confirmed from auth.users u where u.id = uid;
    if caller_confirmed is not true or lower(coalesce(caller_email, '')) <> inv.email then
      return query select 'wrong_email', null::uuid, null::text, null::text; return;
    end if;
  end if;

  -- Qualified throughout: the function's own `family_id`/`child_id`/`role` output columns would otherwise shadow
  -- these same-named `child_memberships` columns (PL/pgSQL resolves a bare name against OUT parameters first).
  select cm.role into existing_role from public.child_memberships cm
   where cm.family_id = inv.family_id and cm.child_id = inv.child_id and cm.user_id = uid for update;
  -- Never touches an existing Owner's row; otherwise creates the membership, or updates an existing editor/viewer
  -- row to the newly invited role (a person accepting a second, different invitation to the same child).
  if existing_role is distinct from 'owner' then
    -- By constraint name, not a column list: a column list here is read against this function's own `family_id`/
    -- `child_id` output columns first (PL/pgSQL substitutes its variables into `on conflict (...)` too), which
    -- would make the same ambiguous-column error as above.
    insert into public.child_memberships (family_id, child_id, user_id, role, invited_by)
    values (inv.family_id, inv.child_id, uid, inv.role, inv.created_by)
    on conflict on constraint child_memberships_pkey do update set role = excluded.role
      where public.child_memberships.role <> 'owner';
  end if;

  update public.child_invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  return query select 'ok', inv.family_id, inv.child_id, coalesce(existing_role, inv.role);
end;
$$;

-- ---- Circle management (role changes, removal, leaving) --------------------------------------------------------

-- The Owner changes someone else's access between Add & Edit and View Only. Never the Owner's own row (there is
-- only ever one Owner, and transferring ownership isn't part of this phase).
create function public.set_member_role(p_family_id uuid, p_child_id text, p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_child_owner(p_family_id, p_child_id) then
    raise exception 'not allowed to manage this circle' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'the owner cannot change their own role' using errcode = '42501';
  end if;
  update public.child_memberships set role = p_role
   where family_id = p_family_id and child_id = p_child_id and user_id = p_user_id and role <> 'owner';
  if not found then
    raise exception 'not in this child''s circle' using errcode = '42501';
  end if;
end;
$$;

-- The Owner removes someone else from the circle. Never themself — the Owner leaves a child's circle only by
-- deleting the child, never by this function.
create function public.remove_member(p_family_id uuid, p_child_id text, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_child_owner(p_family_id, p_child_id) then
    raise exception 'not allowed to manage this circle' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'the owner cannot remove themselves' using errcode = '42501';
  end if;
  delete from public.child_memberships
   where family_id = p_family_id and child_id = p_child_id and user_id = p_user_id and role <> 'owner';
  if not found then
    raise exception 'not in this child''s circle' using errcode = '42501';
  end if;
end;
$$;

-- An Add & Edit or View Only member removes themself. Refused for the Owner (who has nowhere to "leave" to; see
-- `remove_member`) and for anyone not currently in the circle.
create function public.leave_circle(p_family_id uuid, p_child_id text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  delete from public.child_memberships
   where family_id = p_family_id and child_id = p_child_id and user_id = auth.uid() and role <> 'owner';
  if not found then
    raise exception 'not in this child''s circle, or you manage it' using errcode = '42501';
  end if;
end;
$$;

-- ---- Grants --------------------------------------------------------------------------------------------------

revoke all on function private.check_invitation_rate(text, integer) from public, anon;
grant execute on function private.check_invitation_rate(text, integer) to authenticated, service_role;
revoke all on function public.create_invitation(uuid, text, text, text) from public, anon;
grant execute on function public.create_invitation(uuid, text, text, text) to authenticated, service_role;
revoke all on function public.list_invitations(uuid, text) from public, anon;
grant execute on function public.list_invitations(uuid, text) to authenticated, service_role;
revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated, service_role;
revoke all on function public.get_invitation_preview(text) from public, anon;
grant execute on function public.get_invitation_preview(text) to authenticated, service_role;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated, service_role;
revoke all on function public.set_member_role(uuid, text, uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, text, uuid, text) to authenticated, service_role;
revoke all on function public.remove_member(uuid, text, uuid) from public, anon;
grant execute on function public.remove_member(uuid, text, uuid) to authenticated, service_role;
revoke all on function public.leave_circle(uuid, text) from public, anon;
grant execute on function public.leave_circle(uuid, text) to authenticated, service_role;
