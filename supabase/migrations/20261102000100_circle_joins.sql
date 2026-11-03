-- Shared Child Profiles, release readiness: telling the person who manages a child's profile that someone joined
-- (docs/shared-child-profiles-release-readiness.md, "Invitation acceptance notifications").
--
-- Links without an email restriction stay (families share them through WeChat and other messaging apps), so the
-- person managing the profile needs to know when one is used. No new notification system: the invitation row
-- already records who accepted it and when, inside the same locked transaction that creates the membership. This
-- migration adds two columns to it and two functions:
--
-- 1. `child_invitations.joined_new`: set by `accept_invitation` when the acceptance made a new member (not someone
--    already in the circle changing their access). `join_seen_at`: when the person managing the profile dismissed
--    the notice. Written only by server functions (the table still has no client policy or grant).
-- 2. `circle_joins()`: the caller's unseen joins, for children whose profile they manage (never anyone else's), with
--    the child's first name and the new member's display name. No email, no user id.
-- 3. `dismiss_circle_joins(ids)`: marks them seen; idempotent; only for children the caller manages.
--
-- One acceptance, one notice: an invitation can be accepted once (the row is locked and re-checked), and a retry
-- answers 'accepted' without changing anything.
--
-- Also (finding S10): the person managing the profile opening their own link no longer spends it. They get
-- 'already_member' and the invitation stays pending for the person it was meant for.

alter table public.child_invitations
  add column joined_new boolean not null default false,
  add column join_seen_at timestamptz;

create or replace function public.accept_invitation(p_token text)
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

  -- Qualified throughout: the function's own output columns would otherwise shadow these (see 20261101000500).
  select cm.role into existing_role from public.child_memberships cm
   where cm.family_id = inv.family_id and cm.child_id = inv.child_id and cm.user_id = uid for update;
  if existing_role = 'owner' then
    -- Their own link: nothing to join, and the invitation stays usable by the person it was meant for.
    return query select 'already_member', null::uuid, null::text, null::text; return;
  end if;
  insert into public.child_memberships (family_id, child_id, user_id, role, invited_by)
  values (inv.family_id, inv.child_id, uid, inv.role, inv.created_by)
  on conflict on constraint child_memberships_pkey do update set role = excluded.role
    where public.child_memberships.role <> 'owner';

  update public.child_invitations set accepted_at = now(), accepted_by = uid, joined_new = existing_role is null
   where id = inv.id;
  return query select 'ok', inv.family_id, inv.child_id, coalesce(existing_role, inv.role);
end;
$$;

-- The caller's unseen joins, oldest first: only for children whose profile the caller manages (and that aren't
-- deleted), and only while the new member is still in the circle. Anyone else gets no rows.
create function public.circle_joins()
returns table (id uuid, family_id uuid, child_id text, child_first text, member_name text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.family_id, i.child_id, c.first, coalesce(p.display_name, ''), i.accepted_at
  from public.child_invitations i
  join public.children c on c.family_id = i.family_id and c.id = i.child_id and c.deleted_at is null
  left join public.profiles p on p.user_id = i.accepted_by
  where i.joined_new and i.accepted_at is not null and i.join_seen_at is null
    and (select auth.uid()) is not null
    and private.is_child_owner(i.family_id, i.child_id)
    and exists (select 1 from public.child_memberships m
                where m.family_id = i.family_id and m.child_id = i.child_id and m.user_id = i.accepted_by)
  order by i.accepted_at, i.id;
$$;

-- Marks joins as seen. Ids the caller doesn't manage, or already seen, are left alone (no error: a double tap or a
-- second device dismissing the same notice is harmless).
create function public.dismiss_circle_joins(p_ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.child_invitations i set join_seen_at = now()
  where i.id = any(p_ids) and i.join_seen_at is null and (select auth.uid()) is not null
    and private.is_child_owner(i.family_id, i.child_id);
$$;

revoke all on function public.circle_joins() from public, anon;
grant execute on function public.circle_joins() to authenticated, service_role;
revoke all on function public.dismiss_circle_joins(uuid[]) from public, anon;
grant execute on function public.dismiss_circle_joins(uuid[]) to authenticated, service_role;
