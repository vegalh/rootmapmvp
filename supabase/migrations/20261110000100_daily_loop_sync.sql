-- The daily loop: what devices of one family share (docs/data-architecture-phase2.md, section 21).
--
-- 1. `activity_records.enjoyed`: "Did {name} enjoy it?" after Mark as Tried ("loved" / "not-today", or null when not
--    answered). Part of the record, so it follows the record's child and the same child-role access (RLS and
--    triggers in 20261101000200_child_access.sql apply to every column).
-- 2. `entries.record_id`: the tried activity record a Moment was saved from ("Want to remember this?"). A plain id,
--    not a foreign key: entries sync before records, a record can be deleted while its Moment stays, and older
--    Moments have none.
-- 3. `family_settings`: preferences of the whole family, one row per key. Only "routine" ("When are you usually
--    together?") for now. Readable and writable by the family's own members (family_members), never by someone who
--    only shares a child with the family, and never deleted by a client.
--
-- Columns added after 20261012000600_grants.sql get no grant by default; each gets its own below. Clients that don't
-- know these columns keep working: nothing they send or read changes.

alter table public.activity_records add column enjoyed text check (enjoyed in ('loved', 'not-today'));
alter table public.entries add column record_id text check (char_length(record_id) between 1 and 128 and record_id !~ '[[:cntrl:]]');

grant insert (enjoyed), update (enjoyed) on public.activity_records to authenticated;
grant insert (record_id), update (record_id) on public.entries to authenticated;

create table public.family_settings (
  family_id uuid not null references public.families (id) on delete cascade,
  key text not null check (key in ('routine')),
  value jsonb not null check (pg_column_size(value) <= 16384),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (family_id, key)
);

alter table public.family_settings enable row level security;
create policy family_settings_select on public.family_settings for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy family_settings_insert on public.family_settings for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy family_settings_update on public.family_settings for update to authenticated
  using (family_id in (select private.my_family_ids())) with check (family_id in (select private.my_family_ids()));

-- Who changed it and when, set by the server.
create function private.stamp_family_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function private.stamp_family_setting() from public, anon, authenticated;
create trigger t90_stamp before insert or update on public.family_settings for each row execute function private.stamp_family_setting();

grant select on public.family_settings to authenticated;
grant insert (family_id, key, value) on public.family_settings to authenticated;
grant update (value) on public.family_settings to authenticated;
grant all on public.family_settings to service_role;
