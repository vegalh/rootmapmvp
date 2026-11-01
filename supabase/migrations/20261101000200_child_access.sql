-- Shared Child Profiles, Phase 1b: access to child records by child role (docs/shared-child-profiles-phase1b.md).
--
-- Until now any member of a family could read and write every child, record and photo in it. From here on the
-- records of a child are reached through that child's membership (20261101000100):
--
--   owner   reads everything of the child; writes its records; the only one who can change or (soft-)delete the
--           child itself
--   editor  reads everything of the child; creates, edits and soft-deletes its Moments, Journal entries and activity
--           records (anyone's); can't change the child
--   viewer  reads only
--   anyone else: nothing
--
-- Behaviour today is unchanged: every child's only member is its family's owner (Phase 1a backfill and trigger), so
-- each parent reaches exactly the rows they reached before. Memberships for other users can be made only by the
-- server (no client grant), and the app reads only its own family's rows, so no cross-family data reaches the app
-- before Phase 2.
--
-- Family-scoped tables keep their family policies: plans (My Week), goals, saved activities and collections, cloud
-- migrations. Children are still created only in your own family. Photo files keep their paths.

-- ---- Helpers --------------------------------------------------------------------------------------------------

-- The current user's role for a child, or null. Security definer (reads child_memberships past its own policy).
create function private.child_role(fid uuid, cid text) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.child_memberships m
  where m.family_id = fid and m.child_id = cid and m.user_id = (select auth.uid());
$$;

create function private.can_write_child(fid uuid, cid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.child_role(fid, cid) in ('owner', 'editor'), false);
$$;

-- Whether the current user may read this child. A member of any role may. So may a member of the child's family
-- while the child has no membership at all: that is only ever true inside the transaction that creates the child,
-- between the insert and its owner trigger (t20_owner), when Postgres checks `insert … returning` against the select
-- policy. Every committed child has an owner (Phase 1a), so this never opens a committed child to anyone else.
create function private.can_read_child(fid uuid, cid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.child_role(fid, cid) is not null
      or (private.is_family_member(fid)
          and not exists (select 1 from public.child_memberships m where m.family_id = fid and m.child_id = cid));
$$;

-- A photo belongs to the children whose Moments or profile show it. It is readable by anyone who can read one of
-- those children, and writable by anyone who can write one. A photo no child shows yet (just uploaded, a parent's
-- profile photo, or removed from every Moment) belongs to its family, as before.
create function private.photo_access(fid uuid, pid text, want_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  with linked as (
    select e.child_id from public.entries e where e.family_id = fid and e.photo_ids @> array[pid]
    union
    select c.id from public.children c where c.family_id = fid and c.photo_ref = pid
  )
  select case
    when exists (select 1 from linked) then exists (
      select 1 from linked l
      where (want_write and private.can_write_child(fid, l.child_id)) or (not want_write and private.child_role(fid, l.child_id) is not null))
    else private.is_family_member(fid)
  end;
$$;

create function private.can_read_photo(fid uuid, pid text) returns boolean
language sql stable security definer set search_path = '' as $$ select private.photo_access(fid, pid, false); $$;
create function private.can_write_photo(fid uuid, pid text) returns boolean
language sql stable security definer set search_path = '' as $$ select private.photo_access(fid, pid, true); $$;

-- For photo_access: which Moments show a photo.
create index entries_photo_ids_idx on public.entries using gin (photo_ids);

-- ---- record_versions: which child a kept version belongs to ---------------------------------------------------

-- Set by the server (t00_access below), never by clients (no column grant): the child itself for a children version;
-- the child of the version for a Moment or activity record (or, if the version doesn't say, of the record on the
-- server); null for family-scoped records.
alter table public.record_versions add column child_id text;

-- Versions kept before this migration (server jobs; no client is involved).
update public.record_versions v set child_id = case
    when v.table_name = 'children' then v.record_id
    when v.table_name = 'entries' then coalesce(v.version ->> 'child_id', (select e.child_id from public.entries e where e.family_id = v.family_id and e.id = v.record_id))
    when v.table_name = 'activity_records' then coalesce(v.version ->> 'child_id', (select r.child_id from public.activity_records r where r.family_id = v.family_id and r.id = v.record_id))
  end
where v.table_name in ('children', 'entries', 'activity_records');

create function private.version_child(fid uuid, tbl text, rid text, version jsonb) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when tbl = 'children' then rid
    when tbl = 'entries' then coalesce(version ->> 'child_id', (select e.child_id from public.entries e where e.family_id = fid and e.id = rid))
    when tbl = 'activity_records' then coalesce(version ->> 'child_id', (select r.child_id from public.activity_records r where r.family_id = fid and r.id = rid))
  end;
$$;

-- A version of a child's record: the child's owner, and whoever kept it while they still belong to the child. A
-- goal's version: only the parent who kept it (goals are private). Anything else: the family, as before.
create function private.can_read_version(fid uuid, tbl text, cid text, created_by uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when cid is not null then private.child_role(fid, cid) = 'owner'
                              or (created_by = (select auth.uid()) and private.child_role(fid, cid) is not null)
    when tbl in ('children', 'entries', 'activity_records') then false
    when tbl = 'goals' then created_by = (select auth.uid()) and private.is_family_member(fid)
    else private.is_family_member(fid)
  end;
$$;

-- ---- First triggers (t00): access checked before anything else ------------------------------------------------
-- They replace t00_member on these tables and keep its purpose: refuse before any lock or reference check, with the
-- same answer whether or not the row exists. auth.uid() is null for server jobs, which are trusted.

create function private.require_child_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_table_name = 'children' then
    if tg_op = 'INSERT' then
      -- Children are created in your own family; the creator becomes the owner (t20_owner).
      if not private.is_family_member(new.family_id) then
        raise exception 'not a member of this family' using errcode = '42501';
      end if;
    elsif private.child_role(old.family_id, old.id) is distinct from 'owner' then
      raise exception 'only the child''s owner can change the child' using errcode = '42501';
    end if;
    return new;
  end if;
  -- entries, activity_records: write access to the child, before and after (a record can move to another child
  -- only between two children the user can write).
  if not private.can_write_child(new.family_id, new.child_id)
     or (tg_op = 'UPDATE' and not private.can_write_child(old.family_id, old.child_id)) then
    raise exception 'no write access to this child' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.require_photo_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- New photos are added by the family, as before (an editor from another family can't add one yet: Phase 2).
    if not private.is_family_member(new.family_id) then
      raise exception 'not a member of this family' using errcode = '42501';
    end if;
  elsif not private.can_write_photo(old.family_id, old.id) then
    raise exception 'no write access to this photo' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.require_version_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.child_id := private.version_child(new.family_id, new.table_name, new.record_id, new.version);
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.child_id is distinct from old.child_id then
    raise exception 'saved versions cannot be changed' using errcode = '42501';
  end if;
  if new.table_name in ('children', 'entries', 'activity_records') then
    if new.child_id is null or not private.can_write_child(new.family_id, new.child_id) then
      raise exception 'no write access to this child' using errcode = '42501';
    end if;
  elsif not private.is_family_member(new.family_id) then
    raise exception 'not a member of this family' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger t00_member on public.children;
drop trigger t00_member on public.entries;
drop trigger t00_member on public.activity_records;
drop trigger t00_member on public.photos;
drop trigger t00_member on public.record_versions;
create trigger t00_access before insert or update on public.children for each row execute function private.require_child_access();
create trigger t00_access before insert or update on public.entries for each row execute function private.require_child_access();
create trigger t00_access before insert or update on public.activity_records for each row execute function private.require_child_access();
create trigger t00_access before insert or update on public.photos for each row execute function private.require_photo_access();
create trigger t00_access before insert or update on public.record_versions for each row execute function private.require_version_access();

-- ---- Reference checks (t10): a record can only point at what its writer can reach ----------------------------

-- entries.photo_ids: every element is a photo of the same family (as before), and a photo newly added to a Moment
-- must be one the writer can read, so no one can pull another child's photo into a child they share.
create or replace function private.check_entry_photos() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  missing text;
begin
  if tg_op = 'UPDATE' and new.photo_ids is not distinct from old.photo_ids then
    return new;
  end if;
  select p into missing from unnest(new.photo_ids) as p
  where not exists (select 1 from public.photos ph where ph.family_id = new.family_id and ph.id = p)
  limit 1;
  if found then
    raise exception 'entry refers to unknown photo %', missing using errcode = '23503';
  end if;
  if auth.uid() is not null then
    select p into missing from unnest(new.photo_ids) as p
    where (tg_op = 'INSERT' or not p = any (old.photo_ids)) and not private.can_read_photo(new.family_id, p)
    limit 1;
    if found then
      raise exception 'entry refers to unknown photo %', missing using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

-- children.photo_ref: the same for a child's profile photo.
create or replace function private.check_child_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.photo_ref is not distinct from old.photo_ref then
    return new;
  end if;
  if new.photo_ref like 'photo-%'
     and (not exists (select 1 from public.photos ph where ph.family_id = new.family_id and ph.id = new.photo_ref)
          or (auth.uid() is not null and not private.can_read_photo(new.family_id, new.photo_ref))) then
    raise exception 'child refers to unknown photo %', new.photo_ref using errcode = '23503';
  end if;
  return new;
end;
$$;

-- plans.child_ids: every id is a child of the same family (as before), and a child newly added to a plan must be
-- one the writer can write. Plans stay family-scoped: read and written by the family.
create or replace function private.check_plan_children() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  missing text;
begin
  if tg_op = 'UPDATE' and new.child_ids is not distinct from old.child_ids then
    return new;
  end if;
  select c into missing from unnest(new.child_ids) as c
  where not exists (select 1 from public.children ch where ch.family_id = new.family_id and ch.id = c)
     or (auth.uid() is not null and (tg_op = 'INSERT' or not c = any (old.child_ids)) and not private.can_write_child(new.family_id, c))
  limit 1;
  if found then
    raise exception 'plan refers to unknown child %', missing using errcode = '23503';
  end if;
  return new;
end;
$$;

-- ---- Row Level Security ---------------------------------------------------------------------------------------

drop policy children_select on public.children;
drop policy children_update on public.children;
create policy children_select on public.children for select to authenticated
  using (private.can_read_child(family_id, id));
-- children_insert is unchanged: a child is created in your own family.
create policy children_update on public.children for update to authenticated
  using (private.child_role(family_id, id) = 'owner') with check (private.child_role(family_id, id) = 'owner');

drop policy entries_select on public.entries;
drop policy entries_insert on public.entries;
drop policy entries_update on public.entries;
create policy entries_select on public.entries for select to authenticated
  using (private.child_role(family_id, child_id) is not null);
create policy entries_insert on public.entries for insert to authenticated
  with check (private.can_write_child(family_id, child_id));
create policy entries_update on public.entries for update to authenticated
  using (private.can_write_child(family_id, child_id)) with check (private.can_write_child(family_id, child_id));

drop policy activity_records_select on public.activity_records;
drop policy activity_records_insert on public.activity_records;
drop policy activity_records_update on public.activity_records;
create policy activity_records_select on public.activity_records for select to authenticated
  using (private.child_role(family_id, child_id) is not null);
create policy activity_records_insert on public.activity_records for insert to authenticated
  with check (private.can_write_child(family_id, child_id));
create policy activity_records_update on public.activity_records for update to authenticated
  using (private.can_write_child(family_id, child_id)) with check (private.can_write_child(family_id, child_id));

drop policy photos_select on public.photos;
drop policy photos_update on public.photos;
create policy photos_select on public.photos for select to authenticated
  using (private.can_read_photo(family_id, id));
-- photos_insert is unchanged: photos are added by the family.
create policy photos_update on public.photos for update to authenticated
  using (private.can_write_photo(family_id, id)) with check (private.can_write_photo(family_id, id));

drop policy record_versions_select on public.record_versions;
drop policy record_versions_insert on public.record_versions;
drop policy record_versions_update on public.record_versions;
create policy record_versions_select on public.record_versions for select to authenticated
  using (private.can_read_version(family_id, table_name, child_id, created_by));
create policy record_versions_insert on public.record_versions for insert to authenticated
  with check (case when table_name in ('children', 'entries', 'activity_records') then private.can_write_child(family_id, child_id)
                   else family_id in (select private.my_family_ids()) end);
create policy record_versions_update on public.record_versions for update to authenticated
  using (private.can_read_version(family_id, table_name, child_id, created_by))
  with check (private.can_read_version(family_id, table_name, child_id, created_by));

-- ---- Storage: a photo file follows its photo row -------------------------------------------------------------

-- True when `object_name` is exactly the storage path of a photo row the caller can read (before: of any photo row in
-- one of the caller's families). Paths are unchanged.
create or replace function private.photo_object_allowed(object_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  m text[];
begin
  m := regexp_match(object_name,
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(photo-[0-9a-f-]{36})\.(jpg|png|webp|heic)$');
  if m is null then
    return false;
  end if;
  return exists (
    select 1 from public.photos p
    where p.family_id = m[1]::uuid and p.id = m[2] and p.storage_path = object_name
      and private.can_read_photo(p.family_id, p.id)
  );
end;
$$;

-- ---- complete_migration(): only records the caller can reach count ------------------------------------------

-- Unchanged (20261020000100) except that a child's record, or a photo, counts as present only if the caller can read
-- it, so the function can't be used to learn about records outside the caller's children.
create or replace function public.complete_migration(p_family_id uuid, p_id text, p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  current_status text;
  tbl text;
  ids jsonb;
  found text[];
  missing text[] := '{}';
  unverified text[] := '{}';
  tables constant text[] := array['children', 'entries', 'activity_records', 'plans', 'goals', 'saved_activities', 'saved_collections'];
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
    elsif tbl = 'children' then
      select coalesce(array_agg(x), '{}') into found from jsonb_array_elements_text(ids) x
       where not exists (select 1 from public.children c where c.family_id = p_family_id and c.id = x)
          or private.child_role(p_family_id, x) is null;
    elsif tbl in ('entries', 'activity_records') then
      execute format(
        'select coalesce(array_agg(x), ''{}'') from jsonb_array_elements_text($1) x
          where not exists (select 1 from public.%I r where r.family_id = $2 and r.id = x
                              and private.child_role(r.family_id, r.child_id) is not null)', tbl)
        into found using ids, p_family_id;
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
        and ph.sha256 = p ->> 'sha256' and ph.server_sha256 = p ->> 'sha256'
        and private.can_read_photo(ph.family_id, ph.id));

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

-- ---- Privileges -----------------------------------------------------------------------------------------------

-- Policy helpers are evaluated as the caller; nothing here is exposed by the API (schema private).
revoke all on function private.child_role(uuid, text) from public, anon;
revoke all on function private.can_write_child(uuid, text) from public, anon;
revoke all on function private.can_read_child(uuid, text) from public, anon;
revoke all on function private.photo_access(uuid, text, boolean) from public, anon;
revoke all on function private.can_read_photo(uuid, text) from public, anon;
revoke all on function private.can_write_photo(uuid, text) from public, anon;
revoke all on function private.can_read_version(uuid, text, text, uuid) from public, anon;
grant execute on function private.child_role(uuid, text) to authenticated, service_role;
grant execute on function private.can_write_child(uuid, text) to authenticated, service_role;
grant execute on function private.can_read_child(uuid, text) to authenticated, service_role;
grant execute on function private.photo_access(uuid, text, boolean) to authenticated, service_role;
grant execute on function private.can_read_photo(uuid, text) to authenticated, service_role;
grant execute on function private.can_write_photo(uuid, text) to authenticated, service_role;
grant execute on function private.can_read_version(uuid, text, text, uuid) to authenticated, service_role;
revoke all on function private.version_child(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.require_child_access() from public, anon, authenticated;
revoke all on function private.require_photo_access() from public, anon, authenticated;
revoke all on function private.require_version_access() from public, anon, authenticated;
-- record_versions.child_id is server-set: no client insert or update grant (20261012000600 granted only the columns
-- that existed then).
