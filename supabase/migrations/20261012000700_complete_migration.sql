-- RootMap Phase 2B-2 M6: completing a first-login (guest) migration.
-- See docs/data-architecture-phase2.md, section 11 and the M6 notes.
--
-- A device that brought its guest data into the account records the attempt in cloud_migrations (status
-- 'started', with its manifest: every record id per table, and every photo with its SHA-256). Only this function
-- marks it 'complete', after re-checking on the server that every planned record is in the family and every
-- planned photo has been verified by verify-photo with the same SHA-256. The client never sets the status itself
-- (private.guard_cloud_migration, column grants).

-- The guard now lets exactly one path change the status: complete_migration(), which sets a transaction-local
-- flag around its own update. Clients cannot set it: PostgREST only sets request.* settings, and no exposed
-- function sets this one.
create or replace function private.guard_cloud_migration() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and coalesce(current_setting('rootmap.completing_migration', true), '') <> 'on' then
    if tg_op = 'INSERT' and (new.status <> 'started' or new.completed_at is not null) then
      raise exception 'only the server can complete a migration' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.status is distinct from old.status or new.completed_at is distinct from old.completed_at
        or new.device_id is distinct from old.device_id) then
      raise exception 'only the server can complete a migration' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Returns {"status": "complete"} once everything in the manifest is confirmed on the server, otherwise
-- {"status": "incomplete", "missing": ["<table>:<id>", ...], "unverified": ["<photo id>", ...]} and changes
-- nothing. Calling it again after completion returns "complete" and changes nothing. Takes no user id; the caller
-- must belong to the family.
create function public.complete_migration(p_family_id uuid, p_id text, p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  current_status text;
  tbl text;
  ids jsonb;
  found text[];
  missing text[] := '{}';
  unverified text[] := '{}';
  tables constant text[] := array['children', 'entries', 'activity_records', 'plans', 'goals', 'saved_activities'];
begin
  if uid is null or p_family_id is null or not private.is_family_member(p_family_id) then
    raise exception 'not a member of this family' using errcode = '42501';
  end if;
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'object'
     or jsonb_typeof(coalesce(p_manifest -> 'records', '{}')) <> 'object'
     or jsonb_typeof(coalesce(p_manifest -> 'photos', '[]')) <> 'array' then
    raise exception 'invalid manifest' using errcode = '22023';
  end if;

  -- One completion at a time for this attempt.
  select m.status into current_status from public.cloud_migrations m
   where m.family_id = p_family_id and m.id = p_id for update;
  if current_status is null then
    raise exception 'unknown migration' using errcode = 'P0002';
  end if;
  if current_status = 'complete' then
    return jsonb_build_object('status', 'complete');
  end if;

  -- Every planned record is in this family (deleted ones count: a deletion is part of the data).
  for tbl, ids in select key, value from jsonb_each(coalesce(p_manifest -> 'records', '{}')) loop
    if not tbl = any (tables) or jsonb_typeof(ids) <> 'array' then
      raise exception 'invalid manifest table %', tbl using errcode = '22023';
    end if;
    if tbl = 'goals' then
      -- Goals belong to one parent: the ones this parent brought in are theirs.
      select coalesce(array_agg(x), '{}') into found from jsonb_array_elements_text(ids) x
       where not exists (select 1 from public.goals g where g.family_id = p_family_id and g.id = x and g.owner_user_id = uid);
    else
      execute format(
        'select coalesce(array_agg(x), ''{}'') from jsonb_array_elements_text($1) x
          where not exists (select 1 from public.%I r where r.family_id = $2 and r.id = x)', tbl)
        into found using ids, p_family_id;
    end if;
    missing := missing || array(select tbl || ':' || f from unnest(found) f);
  end loop;

  -- Every planned photo was verified by the server with the SHA-256 the device recorded.
  select coalesce(array_agg(p ->> 'id'), '{}') into unverified
    from jsonb_array_elements(coalesce(p_manifest -> 'photos', '[]')) p
   where not exists (
     select 1 from public.photos ph
      where ph.family_id = p_family_id and ph.id = p ->> 'id' and ph.verified_at is not null
        and ph.sha256 = p ->> 'sha256' and ph.server_sha256 = p ->> 'sha256');

  if cardinality(missing) > 0 or cardinality(unverified) > 0 then
    return jsonb_build_object('status', 'incomplete', 'missing', to_jsonb(missing), 'unverified', to_jsonb(unverified));
  end if;

  perform set_config('rootmap.completing_migration', 'on', true);
  update public.cloud_migrations m
     set status = 'complete', completed_at = now(), manifest = p_manifest, updated_at = now()
   where m.family_id = p_family_id and m.id = p_id;
  perform set_config('rootmap.completing_migration', 'off', true);
  return jsonb_build_object('status', 'complete');
end;
$$;

revoke all on function public.complete_migration(uuid, text, jsonb) from public, anon;
grant execute on function public.complete_migration(uuid, text, jsonb) to authenticated, service_role;
