-- RootMap Phase 2B-1: privileges. A second layer under RLS.
-- See docs/data-architecture-phase2.md, sections 4 and 7.2.
--   anon           nothing: no tables, no functions. The publishable key opens nothing without a session.
--   authenticated  select; insert and update only on client-owned columns; never delete.
--   service_role   everything (server jobs only; never shipped to a client). Triggers still run for it.

-- New objects created by migrations get no automatic access; every grant below is explicit.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

-- Functions. Trigger functions need no execute grant to fire; policy helpers are evaluated as the caller.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_ids() to authenticated, service_role;
grant execute on function private.is_family_member(uuid) to authenticated, service_role;
grant execute on function private.photo_object_allowed(text) to authenticated, service_role;

revoke all on function public.create_family(text) from public, anon;
grant execute on function public.create_family(text) to authenticated, service_role;

-- Ownership tables: read-only for clients (families and memberships change only through create_family()).
grant select on public.families to authenticated;
grant select on public.family_members to authenticated;

grant select on public.profiles to authenticated;
grant insert (user_id, display_name, photo_ref, contact, locale, time_zone, created_at, updated_at) on public.profiles to authenticated;
grant update (display_name, photo_ref, contact, locale, time_zone, updated_at) on public.profiles to authenticated;

grant select on public.user_settings to authenticated;
grant insert (user_id, key, value, updated_at) on public.user_settings to authenticated;
grant update (value, updated_at) on public.user_settings to authenticated;

-- Family-data tables: every column except the server-controlled ones. Built from the catalogue so a column
-- list cannot drift from the table definition; a column added later needs its own grant in that migration.
do $$
declare
  t text;
  server_cols text[] := array['rev', 'change_seq', 'server_updated_at', 'updated_by'];
  -- Additional columns clients may not set on insert / change on update, per table.
  no_insert jsonb := '{
    "photos": ["storage_path", "server_sha256", "verified_at"],
    "record_versions": ["created_by"],
    "cloud_migrations": ["status", "completed_at"]
  }';
  no_update jsonb := '{
    "goals": ["owner_user_id"],
    "photos": ["storage_path", "server_sha256", "verified_at", "sha256", "mime_type", "byte_size"],
    "record_versions": ["created_by", "table_name", "record_id", "version", "base_rev", "reason"],
    "cloud_migrations": ["status", "completed_at", "device_id"]
  }';
  insert_cols text;
  update_cols text;
begin
  foreach t in array array['children', 'entries', 'activity_records', 'plans', 'goals', 'saved_activities',
                           'photos', 'record_versions', 'cloud_migrations'] loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into insert_cols
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t
      and c.column_name <> all (server_cols || array(select jsonb_array_elements_text(coalesce(no_insert -> t, '[]'))));

    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into update_cols
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t
      and c.column_name <> all (server_cols || array['family_id', 'id']
                                || array(select jsonb_array_elements_text(coalesce(no_update -> t, '[]'))));

    execute format('grant select on public.%I to authenticated', t);
    execute format('grant insert (%s) on public.%I to authenticated', insert_cols, t);
    execute format('grant update (%s) on public.%I to authenticated', update_cols, t);
  end loop;
end;
$$;
