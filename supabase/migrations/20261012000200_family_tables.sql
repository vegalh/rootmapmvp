-- RootMap Phase 2B-1: family-data tables.
-- Every table is keyed by (family_id, id), where id is the Phase 1 record id kept exactly.
-- Common columns (same on every table, see docs/data-architecture-phase2.md section 3.2):
--   created_at        client; null = predates timestamps (Phase 1 rule)
--   updated_at        client; display only, never used for ordering
--   deleted_at        client; soft deletion
--   origin, position, legacy_id, migrated_at   client; from SyncMeta
--   rev               server; 1 on insert, +1 on every update
--   change_seq        server; the family's change number at this write (the sync cursor)
--   server_updated_at server; diagnostic only
--   updated_by        server; auth.uid(), null for service jobs
-- Server columns are assigned by triggers (20261012000300) and cannot be written by clients (20261012000600).

create table public.children (
  family_id uuid not null references public.families (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 128 and id !~ '[[:cntrl:]]'),
  first text not null default '' check (char_length(first) <= 200),
  last text not null default '' check (char_length(last) <= 200),
  dob date,
  enrolled text check (char_length(enrolled) <= 200),
  enrolled_zh text check (char_length(enrolled_zh) <= 200),
  lessons integer,
  group_name text check (char_length(group_name) <= 200),
  photo_ref text check (photo_ref ~ '^(photo-[0-9a-f-]{36}|bundled:[a-z0-9-]{1,64})$'),
  notes text check (char_length(notes) <= 100000),
  interests text[] not null default '{}',
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

create table public.entries (
  family_id uuid not null references public.families (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 128 and id !~ '[[:cntrl:]]'),
  child_id text not null,
  date date not null,
  title text check (char_length(title) <= 1000),
  text text check (char_length(text) <= 100000),
  text_zh text check (char_length(text_zh) <= 100000),
  photo_ids text[] not null default '{}',
  from_notes boolean not null default false,
  -- The original Phase 1 observation this entry was imported from (Entry.legacyObservation).
  legacy jsonb,
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
  primary key (family_id, id),
  foreign key (family_id, child_id) references public.children (family_id, id)
);

-- Phase 1 collection "records": activity records, including Mark as Tried (kind = 'tried').
create table public.activity_records (
  family_id uuid not null references public.families (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 128 and id !~ '[[:cntrl:]]'),
  child_id text not null,
  kind text not null default 'record' check (kind in ('record', 'tried')),
  activity_id text,
  lesson text not null default '' check (char_length(lesson) <= 1000),
  area text check (char_length(area) <= 200),
  stage text check (char_length(stage) <= 200),
  date date not null,
  notes text check (char_length(notes) <= 100000),
  next_steps text check (char_length(next_steps) <= 100000),
  skills text[] not null default '{}',
  notes_zh text check (char_length(notes_zh) <= 100000),
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
  primary key (family_id, id),
  foreign key (family_id, child_id) references public.children (family_id, id)
);

create table public.plans (
  family_id uuid not null references public.families (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 128 and id !~ '[[:cntrl:]]'),
  activity_id text not null,
  date date not null,
  -- Checked by trigger: every id must be a child in the same family.
  child_ids text[] not null default '{}',
  note text check (char_length(note) <= 100000),
  completed boolean not null default false,
  completed_date date,
  observation text check (char_length(observation) <= 100000),
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

-- A parent's own goals: visible only to owner_user_id, even within the family.
create table public.goals (
  family_id uuid not null references public.families (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 128 and id !~ '[[:cntrl:]]'),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) <= 1000),
  description text check (char_length(description) <= 100000),
  completed boolean not null default false,
  completed_at timestamptz,
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

-- Saved Discover activities, shared by the family. The id is the activity id.
create table public.saved_activities (
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

-- Photo metadata and integrity state. The bytes live in the private bucket at `storage_path`.
create table public.photos (
  family_id uuid not null references public.families (id) on delete cascade,
  id text not null check (id ~ '^photo-[0-9a-f-]{36}$'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 15728640),
  width integer check (width > 0),
  height integer check (height > 0),
  -- SHA-256 of the bytes, recorded when the photo is created. Can never change.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Derived, so clients cannot point a photo row at another object.
  storage_path text generated always as (
    family_id::text || '/' || id || '.' || case mime_type
      when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/heic' then 'heic'
    end
  ) stored,
  uploaded_at timestamptz,
  -- Written only by the server after it has hashed the stored object (verify-photo, Phase 2B-2).
  server_sha256 text check (server_sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz,
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
  primary key (family_id, id),
  unique (storage_path)
);

-- Versions that lost a conflict, kept so nothing is silently discarded (section 6).
create table public.record_versions (
  family_id uuid not null references public.families (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 128 and id !~ '[[:cntrl:]]'),
  table_name text not null check (table_name in ('children', 'entries', 'activity_records', 'plans', 'goals', 'saved_activities', 'photos')),
  record_id text not null,
  version jsonb not null check (pg_column_size(version) <= 1048576),
  base_rev bigint,
  reason text not null check (reason in ('field_conflict', 'text_conflict', 'edited_after_delete', 'other')),
  created_by uuid,
  resolved_at timestamptz,
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

-- First-login upload attempts (Phase 2B-3). Only the server marks an attempt complete.
create table public.cloud_migrations (
  family_id uuid not null references public.families (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 128 and id !~ '[[:cntrl:]]'),
  device_id text not null check (char_length(device_id) between 1 and 128),
  manifest jsonb not null default '{}' check (pg_column_size(manifest) <= 10485760),
  status text not null default 'started' check (status in ('started', 'complete')),
  completed_at timestamptz,
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

-- Pull queries: where family_id = $1 and change_seq > $cursor order by change_seq.
create index children_change_seq_idx on public.children (family_id, change_seq);
create index entries_change_seq_idx on public.entries (family_id, change_seq);
create index activity_records_change_seq_idx on public.activity_records (family_id, change_seq);
create index plans_change_seq_idx on public.plans (family_id, change_seq);
create index goals_change_seq_idx on public.goals (family_id, change_seq);
create index saved_activities_change_seq_idx on public.saved_activities (family_id, change_seq);
create index photos_change_seq_idx on public.photos (family_id, change_seq);
create index record_versions_change_seq_idx on public.record_versions (family_id, change_seq);
create index cloud_migrations_change_seq_idx on public.cloud_migrations (family_id, change_seq);

-- Per-child lookups and foreign-key checks.
create index entries_child_idx on public.entries (family_id, child_id);
create index activity_records_child_idx on public.activity_records (family_id, child_id);
