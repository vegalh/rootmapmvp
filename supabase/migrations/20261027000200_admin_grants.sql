-- Granting and revoking usage-analytics admins (docs/data-architecture-phase2.md section 20.6).
-- For the database owner only, in the Supabase SQL editor (which runs as `postgres`):
--   select private.grant_admin('<login email>');
--   select private.revoke_admin('<login email>');
--   select * from private.list_admins();
-- No client role can execute these or touch private.admins: there is no path from the app, the API, a
-- signed-in parent or the anonymous key. Emails are never stored here, only the account's id.

-- Adds the account that signs in with `login_email` (case-insensitive). The account must already exist (the
-- person has signed in to RootMap at least once). Refuses an unknown or ambiguous email instead of doing nothing.
create function private.grant_admin(login_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
begin
  select array_agg(u.id) into ids from auth.users u
  where lower(u.email) = lower(trim(login_email)) and u.deleted_at is null;
  if ids is null then
    raise exception 'no RootMap account signs in with %; ask them to sign in once first', login_email using errcode = 'P0002';
  end if;
  if array_length(ids, 1) > 1 then
    raise exception 'more than one account matches %', login_email using errcode = 'P0003';
  end if;
  insert into private.admins (user_id) values (ids[1]) on conflict do nothing;
  return ids[1];
end;
$$;

-- Removes the admin who signs in with `login_email`. Returns whether a row was removed. Takes effect on the next
-- request: admin_usage_summary() checks private.admins on every call, so an open admin page loses access at once.
create function private.revoke_admin(login_email text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.admins a using auth.users u
  where a.user_id = u.id and lower(u.email) = lower(trim(login_email));
  return found;
end;
$$;

-- Current admins with their login email, for the owner to check who has access.
create function private.list_admins() returns table (email text, user_id uuid, added_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.email::text, a.user_id, a.added_at from private.admins a join auth.users u on u.id = a.user_id order by a.added_at;
$$;

revoke all on function private.grant_admin(text) from public, anon, authenticated, service_role;
revoke all on function private.revoke_admin(text) from public, anon, authenticated, service_role;
revoke all on function private.list_admins() from public, anon, authenticated, service_role;
