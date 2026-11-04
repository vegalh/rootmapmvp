-- Shared Child Profiles, Phase 5: handing a child's profile to someone else (docs/shared-child-profiles-phase5.md,
-- "Ownership transfer").
--
-- The person managing a child's profile (the Owner) can offer it to someone who already has Add & Edit access to that
-- child. Nothing changes until that person accepts: then they become the Owner and the previous Owner becomes Add &
-- Edit, in one transaction. The Owner can cancel an offer; the recipient can decline it. Built on the existing
-- membership model: no new client write path into `child_memberships` (still unwritable by clients, Phase 1a), and
-- the exactly-one-owner rule (`child_memberships_one_owner`, `t50_one_owner`) holds throughout.
--
-- 1. `child_ownership_transfers`: one row per offer. At most one pending offer per child (partial unique index). An
--    offer expires after 7 days. No client policy or grant: every read and write goes through a SECURITY DEFINER
--    function below, which re-checks the caller every time.
-- 2. Stale offers. An offer counts only while it is pending, not expired, its child isn't deleted, the person who made
--    it is still the Owner and the recipient still has Add & Edit (`private.transfer_is_live`). Anything else (the
--    recipient was moved to View Only, removed or left; the profile was deleted; ownership already changed) makes it
--    stale: it is never listed and can't be accepted. `accept_ownership_transfer` re-checks all of it itself.
-- 3. Concurrency. Every function that changes an offer locks the child's row first (the same lock `t00_lock_child`
--    takes for any membership change), then the offer. Two acceptances, an acceptance racing a cancellation, or a
--    racing role change or removal therefore run one after the other, and the second sees what the first committed.
-- 4. After a transfer the previous Owner is an Add & Edit member like any other: they can leave, and the new Owner can
--    change their access or remove them (`set_member_role`, `remove_member`, `leave_circle`, unchanged). The child's
--    rows stay in the family that created it, but every policy reaches them by child role (Phase 1b), so that family
--    keeps nothing of the child once its membership is gone. Its devices then remove their copy (lib/sync/scopes.ts).

create table public.child_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  child_id text not null,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'canceled', 'expired', 'stale')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  resolved_at timestamptz,
  check (from_user <> to_user),
  foreign key (family_id, child_id) references public.children (family_id, id) on delete cascade
);
create unique index child_ownership_transfers_one_pending on public.child_ownership_transfers (family_id, child_id) where status = 'pending';
create index child_ownership_transfers_to_user_idx on public.child_ownership_transfers (to_user) where status = 'pending';
create index child_ownership_transfers_from_user_idx on public.child_ownership_transfers (from_user) where status = 'pending';

alter table public.child_ownership_transfers enable row level security;
revoke all on public.child_ownership_transfers from public, anon, authenticated;
grant all on public.child_ownership_transfers to service_role;

-- ---- Helpers --------------------------------------------------------------------------------------------------

create function private.has_child_role(fid uuid, cid text, uid uuid, wanted text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.child_memberships m where m.family_id = fid and m.child_id = cid and m.user_id = uid and m.role = wanted);
$$;

-- Whether a pending offer can still be accepted (see 2. above).
create function private.transfer_is_live(t public.child_ownership_transfers) returns boolean
language sql stable security definer set search_path = '' as $$
  select t.status = 'pending' and t.expires_at > now()
     and not private.child_is_deleted(t.family_id, t.child_id)
     and private.has_child_role(t.family_id, t.child_id, t.from_user, 'owner')
     and private.has_child_role(t.family_id, t.child_id, t.to_user, 'editor');
$$;

-- Marks a child's pending offer expired or stale once it can no longer be accepted. The caller holds the child's lock.
create function private.close_dead_transfers(fid uuid, cid text) returns void
language sql security definer set search_path = '' as $$
  update public.child_ownership_transfers t
     set status = case when t.expires_at <= now() then 'expired' else 'stale' end, resolved_at = now()
   where t.family_id = fid and t.child_id = cid and t.status = 'pending' and not private.transfer_is_live(t);
$$;

-- Locks an offer's child, then the offer, for the caller (who must be its recipient, or its child's current Owner).
-- Refused the same way whether or not the offer exists.
create function private.lock_transfer(p_id uuid, as_recipient boolean) returns public.child_ownership_transfers
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.child_ownership_transfers%rowtype;
begin
  select * into t from public.child_ownership_transfers where id = p_id;
  if uid is null or not found
     or (as_recipient and t.to_user <> uid)
     or (not as_recipient and not private.is_child_owner(t.family_id, t.child_id)) then
    raise exception 'not allowed to change this transfer' using errcode = '42501';
  end if;
  perform 1 from public.children c where c.family_id = t.family_id and c.id = t.child_id for update;
  select * into t from public.child_ownership_transfers where id = p_id for update;
  return t;
end;
$$;

-- ---- Offering and cancelling (the Owner) ----------------------------------------------------------------------

-- Offers the child's profile to an Add & Edit member and returns the offer's id. Offering again to the same person
-- while their offer is pending returns that offer (a double tap makes one offer); an offer to someone else while one
-- is pending is refused (55000): the Owner cancels it first.
create function public.offer_ownership_transfer(p_family_id uuid, p_child_id text, p_to_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.child_ownership_transfers%rowtype;
  new_id uuid;
begin
  if uid is null or not private.is_child_owner(p_family_id, p_child_id) or private.child_is_deleted(p_family_id, p_child_id) then
    raise exception 'not allowed to transfer this child' using errcode = '42501';
  end if;
  perform 1 from public.children c where c.family_id = p_family_id and c.id = p_child_id for update;
  -- Checked again under the lock: a transfer or role change that committed meanwhile is seen now.
  if not private.is_child_owner(p_family_id, p_child_id) then
    raise exception 'not allowed to transfer this child' using errcode = '42501';
  end if;
  if p_to_user is null or p_to_user = uid or not private.has_child_role(p_family_id, p_child_id, p_to_user, 'editor') then
    raise exception 'a profile can only be handed to someone with Add & Edit access' using errcode = '22023';
  end if;
  perform private.close_dead_transfers(p_family_id, p_child_id);
  select * into t from public.child_ownership_transfers tr
   where tr.family_id = p_family_id and tr.child_id = p_child_id and tr.status = 'pending';
  if found then
    if t.to_user = p_to_user then
      return t.id;
    end if;
    raise exception 'another transfer of this child is pending' using errcode = '55000';
  end if;
  insert into public.child_ownership_transfers (family_id, child_id, from_user, to_user)
  values (p_family_id, p_child_id, uid, p_to_user)
  returning id into new_id;
  return new_id;
end;
$$;

-- The current Owner withdraws a pending offer. Idempotent: an offer already resolved is left as it is.
create function public.cancel_ownership_transfer(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.child_ownership_transfers%rowtype := private.lock_transfer(p_id, false);
begin
  if t.status = 'pending' then
    update public.child_ownership_transfers set status = 'canceled', resolved_at = now() where id = t.id;
  end if;
end;
$$;

-- ---- Accepting and declining (the recipient) -------------------------------------------------------------------

-- The recipient takes over the child's profile. Returns 'ok' (done now), or the offer's state when it can't be
-- accepted: 'accepted' (already, e.g. a second tap), 'declined', 'canceled', 'expired' or 'stale'. An offer found
-- expired or stale is marked so.
create function public.accept_ownership_transfer(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  t public.child_ownership_transfers%rowtype := private.lock_transfer(p_id, true);
begin
  if t.status <> 'pending' then
    return t.status;
  end if;
  if not private.transfer_is_live(t) then
    perform private.close_dead_transfers(t.family_id, t.child_id);
    return (select tr.status from public.child_ownership_transfers tr where tr.id = t.id);
  end if;
  -- Demote first: at most one owner at any moment (child_memberships_one_owner); exactly one again at commit
  -- (t50_one_owner).
  update public.child_memberships m set role = 'editor'
   where m.family_id = t.family_id and m.child_id = t.child_id and m.user_id = t.from_user and m.role = 'owner';
  update public.child_memberships m set role = 'owner'
   where m.family_id = t.family_id and m.child_id = t.child_id and m.user_id = t.to_user and m.role = 'editor';
  update public.child_ownership_transfers set status = 'accepted', resolved_at = now() where id = t.id;
  return 'ok';
end;
$$;

-- The recipient says no. Idempotent.
create function public.decline_ownership_transfer(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.child_ownership_transfers%rowtype := private.lock_transfer(p_id, true);
begin
  if t.status = 'pending' then
    update public.child_ownership_transfers set status = 'declined', resolved_at = now() where id = t.id;
  end if;
end;
$$;

-- ---- Listing ---------------------------------------------------------------------------------------------------

-- The caller's live offers: the ones they made as Owner (`incoming` false) and the ones made to them (`incoming`
-- true), with the child's first name and both people's display names. No email; the recipient's id only to the Owner,
-- who already sees it in the circle.
create function public.ownership_transfers()
returns table (id uuid, family_id uuid, child_id text, child_first text, from_name text, to_user uuid, to_name text, expires_at timestamptz, incoming boolean)
language sql stable security definer set search_path = '' as $$
  select t.id, t.family_id, t.child_id, c.first, coalesce(pf.display_name, ''),
         case when t.from_user = (select auth.uid()) then t.to_user end,
         coalesce(pt.display_name, ''), t.expires_at, t.to_user = (select auth.uid())
  from public.child_ownership_transfers t
  join public.children c on c.family_id = t.family_id and c.id = t.child_id
  left join public.profiles pf on pf.user_id = t.from_user
  left join public.profiles pt on pt.user_id = t.to_user
  where (select auth.uid()) in (t.from_user, t.to_user) and private.transfer_is_live(t)
  order by t.created_at, t.id;
$$;

-- ---- Grants ----------------------------------------------------------------------------------------------------

revoke all on function private.has_child_role(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function private.transfer_is_live(public.child_ownership_transfers) from public, anon, authenticated;
revoke all on function private.close_dead_transfers(uuid, text) from public, anon, authenticated;
revoke all on function private.lock_transfer(uuid, boolean) from public, anon, authenticated;
revoke all on function public.offer_ownership_transfer(uuid, text, uuid) from public, anon;
grant execute on function public.offer_ownership_transfer(uuid, text, uuid) to authenticated, service_role;
revoke all on function public.cancel_ownership_transfer(uuid) from public, anon;
grant execute on function public.cancel_ownership_transfer(uuid) to authenticated, service_role;
revoke all on function public.accept_ownership_transfer(uuid) from public, anon;
grant execute on function public.accept_ownership_transfer(uuid) to authenticated, service_role;
revoke all on function public.decline_ownership_transfer(uuid) from public, anon;
grant execute on function public.decline_ownership_transfer(uuid) to authenticated, service_role;
revoke all on function public.ownership_transfers() from public, anon;
grant execute on function public.ownership_transfers() to authenticated, service_role;
