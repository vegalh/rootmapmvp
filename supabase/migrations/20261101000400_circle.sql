-- Shared Child Profiles, Phase 3: a child's circle, and what a soft-deleted child means for it
-- (docs/shared-child-profiles-phase3.md).
--
-- 1. Relationship labels. Each membership may say how the person is related to the child (mom, dad, grandma, …),
--    given by the person who manages the child's profile, or by the person themselves. Never inferred; empty until
--    someone chooses one.
-- 2. The circle. `child_circle()` lists the people in a child's circle (name and relationship) for anyone in it. Only
--    the person managing the profile also gets each person's access and id (to manage it); everyone else gets only
--    their own. No email or other account detail is returned.
-- 3. Soft-deleted children. Until now members kept reading a child its owner had soft-deleted (Phase 1b). Now only
--    the owner reaches a soft-deleted child and its records (they can restore it, as before); for everyone else the
--    child is as if not shared, until it is restored. Their own memberships are hidden too, so their devices remove
--    the child the usual way (two answers, then removal; lib/sync/scopes.ts). Memberships themselves are kept, so a
--    restore brings everyone back.
--
-- Technical roles (owner, editor, viewer) are unchanged; the app shows them as Manage Profile, Add & Edit, View Only.

alter table public.child_memberships add column relationship text
  check (relationship in ('mom', 'dad', 'grandma', 'grandpa', 'teacher', 'caregiver', 'family', 'other'));

-- ---- Soft-deleted children: only their owner ------------------------------------------------------------------

create function private.child_is_deleted(fid uuid, cid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.deleted_at is not null from public.children c where c.family_id = fid and c.id = cid), false);
$$;

-- The caller's role for a child, or null; for a soft-deleted child only the owner keeps theirs. Every policy and
-- trigger of Phase 1b goes through this function, so records, photos, versions and storage follow at once.
create or replace function private.child_role(fid uuid, cid text) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.child_memberships m
  where m.family_id = fid and m.child_id = cid and m.user_id = (select auth.uid())
    and (m.role = 'owner' or not private.child_is_deleted(fid, cid));
$$;

drop policy child_memberships_select on public.child_memberships;
create policy child_memberships_select on public.child_memberships for select to authenticated
  using ((user_id = (select auth.uid()) and (role = 'owner' or not private.child_is_deleted(family_id, child_id)))
         or private.is_child_owner(family_id, child_id));

-- ---- The circle -----------------------------------------------------------------------------------------------

-- People in a child's circle, the caller first, then in the order they joined. Refused (the same way whether or not
-- the child exists) for anyone not in it.
create function public.child_circle(p_family_id uuid, p_child_id text)
returns table (user_id uuid, display_name text, relationship text, role text, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  mine text := private.child_role(p_family_id, p_child_id);
begin
  if uid is null or mine is null then
    raise exception 'not in this child''s circle' using errcode = '42501';
  end if;
  return query
    select case when mine = 'owner' or m.user_id = uid then m.user_id end,
           coalesce(p.display_name, ''),
           m.relationship,
           case when mine = 'owner' or m.user_id = uid then m.role end,
           m.user_id = uid
    from public.child_memberships m
    left join public.profiles p on p.user_id = m.user_id
    where m.family_id = p_family_id and m.child_id = p_child_id
    order by m.user_id = uid desc, m.created_at, m.user_id;
end;
$$;

-- Sets (or, with null, clears) how a person is related to the child: the person managing the profile for anyone in the
-- circle, anyone else only for themselves.
create function public.set_circle_relationship(p_family_id uuid, p_child_id text, p_user_id uuid, p_relationship text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  mine text := private.child_role(p_family_id, p_child_id);
begin
  if uid is null or mine is null or (mine <> 'owner' and p_user_id is distinct from uid) then
    raise exception 'not allowed to change this circle' using errcode = '42501';
  end if;
  update public.child_memberships m set relationship = p_relationship
   where m.family_id = p_family_id and m.child_id = p_child_id and m.user_id = p_user_id;
  if not found then
    raise exception 'not in this child''s circle' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.child_is_deleted(uuid, text) from public, anon;
grant execute on function private.child_is_deleted(uuid, text) to authenticated, service_role;
revoke all on function public.child_circle(uuid, text) from public, anon;
grant execute on function public.child_circle(uuid, text) to authenticated, service_role;
revoke all on function public.set_circle_relationship(uuid, text, uuid, text) from public, anon;
grant execute on function public.set_circle_relationship(uuid, text, uuid, text) to authenticated, service_role;
