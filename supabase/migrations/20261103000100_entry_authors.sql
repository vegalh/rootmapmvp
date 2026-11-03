-- Shared Child Profiles, Phase 5: who wrote a Moment (docs/shared-child-profiles-phase5.md).
--
-- When several people write in a child's Journal, a Moment should say who added it and who last changed it.
--
-- 1. `entries.created_by`: the account that inserted the row, set by the server and never changed afterwards. Clients
--    have no grant on it (a column added after 20261012000600_grants.sql gets none), and the trigger overwrites
--    whatever arrives anyway. `updated_by` (set by `stamp_row`) already says who changed it last.
--    Existing rows keep null: they were written before children could be shared, and filling them in would change
--    every row (its revision, change number and `updated_by`). The app shows no "added by" for them.
-- 2. `entry_people(family_id, entry_id)`: for anyone who can read the Moment (any role for its child), who added it
--    and who last changed it: display name and relationship to the child, and whether it is the caller. Never a user
--    id or an email. Someone no longer in the child's circle is returned without a name.

alter table public.entries add column created_by uuid references auth.users (id) on delete set null;

create function private.stamp_created_by() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger t91_created_by before insert or update on public.entries for each row execute function private.stamp_created_by();

-- Refused (the same way whether or not the Moment exists) for anyone who can't read it.
create function public.entry_people(p_family_id uuid, p_entry_id text)
returns table (kind text, display_name text, relationship text, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cid text;
  added uuid;
  changed uuid;
begin
  select en.child_id, en.created_by, en.updated_by into cid, added, changed
    from public.entries en where en.family_id = p_family_id and en.id = p_entry_id;
  if uid is null or cid is null or private.child_role(p_family_id, cid) is null then
    raise exception 'not allowed to read this Moment' using errcode = '42501';
  end if;
  return query
    select k.kind,
           case when m.user_id is not null then coalesce(p.display_name, '') else '' end,
           m.relationship,
           k.user_id = uid
    from (values (1, 'added', added), (2, 'changed', changed)) k (n, kind, user_id)
    left join public.child_memberships m on m.family_id = p_family_id and m.child_id = cid and m.user_id = k.user_id
    left join public.profiles p on p.user_id = k.user_id
    where k.user_id is not null
    order by k.n;
end;
$$;

revoke all on function private.stamp_created_by() from public, anon;
revoke all on function public.entry_people(uuid, text) from public, anon;
grant execute on function public.entry_people(uuid, text) to authenticated, service_role;
