-- Shared Child Profiles, Phase 1a: per-child memberships (docs/shared-child-profiles-phase1a.md).
--
-- Who belongs to each child, and in which role. Every child has exactly one owner, from the moment it is created.
-- Nothing reads these memberships for access yet: children, entries, records, photos and storage keep their family
-- policies unchanged (Phase 1b switches them). No one can be invited, and clients cannot write memberships at all.
--
-- A child keeps its existing identity, (family_id, id), and stays in the family that created it.
--
-- Exactly one owner, enforced in the database:
--   at most one   the partial unique index child_memberships_one_owner
--   at least one  the deferred constraint triggers t50_one_owner, checked at commit for every child a transaction
--                 touched (a transfer can demote and promote in either order within one transaction)
--   creation      t20_owner on children adds the owner in the same transaction as the child
--   concurrency   t00_lock_child locks the child's row before any membership change, so changes to one child's
--                 memberships run one after another and each commit check sees the others' committed result

create table public.child_memberships (
  family_id uuid not null,
  child_id text not null,
  -- An owner's account can't be deleted while they own a child: the cascade would remove the owner, and the commit
  -- check refuses that. Other members' memberships go with their account.
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, child_id, user_id),
  -- Memberships go only when the child itself is removed by a server job (clients never hard-delete).
  foreign key (family_id, child_id) references public.children (family_id, id) on delete cascade
);

create unique index child_memberships_one_owner on public.child_memberships (family_id, child_id) where role = 'owner';
-- "Which children can this user reach?"
create index child_memberships_user_id_idx on public.child_memberships (user_id);

-- ---- Helpers --------------------------------------------------------------------------------------------------

-- Whether the current user owns this child. Security definer so the select policy below can read the table without
-- going through its own policy.
create function private.is_child_owner(fid uuid, cid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.child_memberships m
    where m.family_id = fid and m.child_id = cid and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

-- Raises unless this child (if it still exists) has exactly one owner.
create function private.check_one_owner(fid uuid, cid text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  owners integer;
begin
  if not exists (select 1 from public.children c where c.family_id = fid and c.id = cid) then
    return; -- the child itself was removed (server jobs only); its memberships went with it
  end if;
  select count(*) into owners from public.child_memberships m where m.family_id = fid and m.child_id = cid and m.role = 'owner';
  if owners <> 1 then
    raise exception 'a child must have exactly one owner (has %)', owners using errcode = '23514';
  end if;
end;
$$;

-- ---- Triggers on child_memberships ----------------------------------------------------------------------------

-- Locks the child's row before any change to its memberships. Two transactions changing the same child's members
-- (a transfer racing a removal, two transfers) therefore run one after the other, and the second one's commit check
-- sees what the first committed. Identity columns never change: a transfer changes roles, not rows.
create function private.membership_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  fid uuid := case when tg_op = 'DELETE' then old.family_id else new.family_id end;
  cid text := case when tg_op = 'DELETE' then old.child_id else new.child_id end;
begin
  perform 1 from public.children c where c.family_id = fid and c.id = cid for update;
  if tg_op = 'UPDATE' then
    if new.family_id is distinct from old.family_id or new.child_id is distinct from old.child_id
       or new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at then
      raise exception 'a membership''s child and user cannot change' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger t00_lock_child before insert or update or delete on public.child_memberships
  for each row execute function private.membership_guard();

create function private.membership_one_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.check_one_owner(old.family_id, old.child_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.check_one_owner(new.family_id, new.child_id);
  end if;
  return null;
end;
$$;
create constraint trigger t50_one_owner after insert or update or delete on public.child_memberships
  deferrable initially deferred for each row execute function private.membership_one_owner();

-- ---- Triggers on children -------------------------------------------------------------------------------------

-- A new child's owner, in the same transaction. The signed-in parent who creates it (t00_member has already checked
-- they belong to the family); for a server job (no auth.uid()), the family's one owner. Applies to every way a child
-- is created (sync uploads, guest import, tests), so the app needs no change. ON CONFLICT DO NOTHING inserts that
-- find the child already there insert nothing, and so add no owner.
create function private.add_child_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  owners integer;
begin
  if owner_id is null then
    select count(*), min(m.user_id::text)::uuid into owners, owner_id
      from public.family_members m where m.family_id = new.family_id and m.role = 'owner';
    if owners <> 1 then
      raise exception 'cannot choose an owner for the new child: its family has % owners', owners using errcode = '23514';
    end if;
  end if;
  insert into public.child_memberships (family_id, child_id, user_id, role) values (new.family_id, new.id, owner_id, 'owner');
  return null;
end;
$$;
create trigger t20_owner after insert on public.children for each row execute function private.add_child_owner();

-- Defence in depth: a child created any other way (or with t20_owner disabled) still can't commit without an owner.
create function private.child_one_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_one_owner(new.family_id, new.id);
  return null;
end;
$$;
create constraint trigger t50_one_owner after insert on public.children
  deferrable initially deferred for each row execute function private.child_one_owner();

-- ---- Access ---------------------------------------------------------------------------------------------------

-- Read only, and narrowly: a user's own memberships, and every membership of a child they own. No insert, update or
-- delete policy and no grant: memberships change only through server functions (later phases) and server jobs.
alter table public.child_memberships enable row level security;
create policy child_memberships_select on public.child_memberships for select to authenticated
  using (user_id = (select auth.uid()) or private.is_child_owner(family_id, child_id));

revoke all on public.child_memberships from anon, authenticated;
grant select on public.child_memberships to authenticated;
grant all on public.child_memberships to service_role;

revoke all on function private.is_child_owner(uuid, text) from public, anon;
grant execute on function private.is_child_owner(uuid, text) to authenticated, service_role;
revoke all on function private.check_one_owner(uuid, text) from public, anon, authenticated;
revoke all on function private.membership_guard() from public, anon, authenticated;
revoke all on function private.membership_one_owner() from public, anon, authenticated;
revoke all on function private.add_child_owner() from public, anon, authenticated;
revoke all on function private.child_one_owner() from public, anon, authenticated;

-- ---- Backfill -------------------------------------------------------------------------------------------------

-- Gives every child without memberships (soft-deleted ones too) its family's owner as owner, and returns how many it
-- added. Refuses, changing nothing, if any such child's family doesn't have exactly one member who is its owner:
-- create_family() is the only way to make a membership today, so anything else means ownership is unclear, and no
-- member is chosen for it. Kept as a function so it can be tested on copies of existing data; callable only by the
-- database owner. Running it again adds nothing.
create function private.backfill_child_owners() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  unclear integer;
  added integer;
begin
  -- No child is created and no family member added while this runs.
  lock table public.children, public.family_members in share row exclusive mode;
  select count(*) into unclear from (
    select distinct c.family_id from public.children c
    where not exists (select 1 from public.child_memberships cm where cm.family_id = c.family_id and cm.child_id = c.id)
  ) f
  where (select count(*) from public.family_members m where m.family_id = f.family_id) <> 1
     or not exists (select 1 from public.family_members m where m.family_id = f.family_id and m.role = 'owner');
  if unclear > 0 then
    raise exception 'child ownership is unclear in % famil(ies): each family with children needs exactly one member, its owner', unclear
      using errcode = 'P0001';
  end if;

  insert into public.child_memberships (family_id, child_id, user_id, role, created_at, updated_at)
  select c.family_id, c.id, m.user_id, 'owner', now(), now()
  from public.children c
  join public.family_members m on m.family_id = c.family_id and m.role = 'owner'
  where not exists (select 1 from public.child_memberships cm where cm.family_id = c.family_id and cm.child_id = c.id);
  get diagnostics added = row_count;

  -- Every child now has exactly one owner.
  if exists (
    select 1 from public.children c
    where (select count(*) from public.child_memberships m where m.family_id = c.family_id and m.child_id = c.id and m.role = 'owner') <> 1
  ) then
    raise exception 'backfill incomplete: a child does not have exactly one owner' using errcode = '23514';
  end if;
  return added;
end;
$$;
revoke all on function private.backfill_child_owners() from public, anon, authenticated, service_role;

do $$
declare
  added integer := private.backfill_child_owners();
begin
  raise notice 'child_memberships: % existing children given their family''s owner', added;
end;
$$;
