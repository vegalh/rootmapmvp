-- RootMap Phase 2B-1: family ownership.
-- See docs/data-architecture-phase2.md, sections 3 and 7.

-- Helpers that policies and triggers call. Not exposed through the API (only `public` and
-- `graphql_public` are), so clients can never call these functions directly.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- One household. `change_seq` is the family's change number (section 5): every write to a family-data
-- table takes the next value while holding this row's lock, so numbers become visible in commit order.
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default '' check (char_length(name) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  change_seq bigint not null default 0,
  -- Highest change number whose tombstones have been purged. A device whose cursor is below this
  -- must do a full re-sync. Stays 0 until a purge job exists.
  purged_through_seq bigint not null default 0
);

create table public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'parent')),
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
create index family_members_user_id_idx on public.family_members (user_id);

-- One per signed-in parent.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 200),
  -- A photo id or a stable bundled-avatar key; never a build-specific asset URL or a data URL.
  photo_ref text check (photo_ref ~ '^(photo-[0-9a-f-]{36}|bundled:[a-z0-9-]{1,64})$'),
  contact text not null default '' check (char_length(contact) <= 500),
  locale text check (locale in ('en', 'zh')),
  time_zone text check (char_length(time_zone) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Settings that follow the parent across devices. Device-only settings stay local.
create table public.user_settings (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  value jsonb not null check (pg_column_size(value) <= 262144),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Families the current user belongs to. Used by policies as `family_id in (select private.my_family_ids())`,
-- which Postgres evaluates once per statement. Security definer so it can read family_members without
-- going through that table's own policy.
create function private.my_family_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.family_id from public.family_members m where m.user_id = (select auth.uid());
$$;

create function private.is_family_member(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.family_members m where m.family_id = fid and m.user_id = (select auth.uid())
  );
$$;

-- The only way to create a family or a membership. Exposed as an RPC because a signed-in parent calls it
-- once; it takes no user id and refuses if the caller already belongs to a family.
create function public.create_family(family_name text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  fid uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Two simultaneous calls by the same user must not both succeed.
  perform pg_advisory_xact_lock(hashtextextended('rootmap.create_family:' || uid::text, 0));
  if exists (select 1 from public.family_members m where m.user_id = uid) then
    raise exception 'user already belongs to a family' using errcode = 'P0001';
  end if;
  insert into public.families (name, created_by) values (coalesce(family_name, ''), uid) returning id into fid;
  insert into public.family_members (family_id, user_id, role) values (fid, uid, 'owner');
  return fid;
end;
$$;
