-- Saved RootMap collections (src/data/collections.ts), shared by the family. The id is the collection id.
-- Same shape and protection as saved_activities: membership and stamping triggers, RLS by family, column grants
-- for clients, soft delete only. The app keeps them in its `savedCollections` collection (lib/sync/mapping.ts).

create table public.saved_collections (
  family_id uuid not null references public.families (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 128 and id !~ '[[:cntrl:]]'),
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  origin text check (origin in ('demo', 'user', 'unknown')),
  position double precision,
  legacy_id text,
  migrated_at timestamptz,
  rev bigint not null default 0,
  change_seq bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (family_id, id)
);

create index saved_collections_change_seq_idx on public.saved_collections (family_id, change_seq);

create trigger t00_member before insert or update on public.saved_collections for each row execute function private.require_member();
create trigger t90_stamp before insert or update on public.saved_collections for each row execute function private.stamp_row();

alter table public.saved_collections enable row level security;
create policy saved_collections_select on public.saved_collections for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy saved_collections_insert on public.saved_collections for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy saved_collections_update on public.saved_collections for update to authenticated
  using (family_id in (select private.my_family_ids())) with check (family_id in (select private.my_family_ids()));

-- Every column except the server-controlled ones (see 20261012000600_grants.sql); never delete.
grant select on public.saved_collections to authenticated;
grant insert (family_id, id, created_at, updated_at, deleted_at, origin, position, legacy_id, migrated_at)
  on public.saved_collections to authenticated;
grant update (created_at, updated_at, deleted_at, origin, position, legacy_id, migrated_at)
  on public.saved_collections to authenticated;

-- A version of a saved collection that lost a conflict can be kept like any other record's.
alter table public.record_versions drop constraint record_versions_table_name_check;
alter table public.record_versions add constraint record_versions_table_name_check
  check (table_name in ('children', 'entries', 'activity_records', 'plans', 'goals', 'saved_activities', 'saved_collections', 'photos'));

-- complete_migration(): a first-login manifest may now list saved collections. Unchanged otherwise
-- (20261012000700_complete_migration.sql).
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
