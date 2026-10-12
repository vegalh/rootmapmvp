-- RootMap Phase 2B-1: Row Level Security.
-- See docs/data-architecture-phase2.md, section 7.1.
-- A signed-in user reaches a row only if they belong to that row's family. There are no delete policies:
-- deletion is always a soft delete (an update), and tombstones keep the same protection as live rows.
-- `anon` gets no policies at all (and no grants, see 20261012000600).

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.children enable row level security;
alter table public.entries enable row level security;
alter table public.activity_records enable row level security;
alter table public.plans enable row level security;
alter table public.goals enable row level security;
alter table public.saved_activities enable row level security;
alter table public.photos enable row level security;
alter table public.record_versions enable row level security;
alter table public.cloud_migrations enable row level security;

-- Ownership tables. Families and memberships are created only by create_family(); clients cannot insert,
-- update or delete them.
create policy families_select on public.families for select to authenticated
  using (id in (select private.my_family_ids()));

create policy family_members_select on public.family_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy user_settings_select on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_settings_insert on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy user_settings_update on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Family-data tables: member of the row's family, for the old row and the new row.
create policy children_select on public.children for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy children_insert on public.children for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy children_update on public.children for update to authenticated
  using (family_id in (select private.my_family_ids())) with check (family_id in (select private.my_family_ids()));

create policy entries_select on public.entries for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy entries_insert on public.entries for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy entries_update on public.entries for update to authenticated
  using (family_id in (select private.my_family_ids())) with check (family_id in (select private.my_family_ids()));

create policy activity_records_select on public.activity_records for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy activity_records_insert on public.activity_records for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy activity_records_update on public.activity_records for update to authenticated
  using (family_id in (select private.my_family_ids())) with check (family_id in (select private.my_family_ids()));

create policy plans_select on public.plans for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy plans_insert on public.plans for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy plans_update on public.plans for update to authenticated
  using (family_id in (select private.my_family_ids())) with check (family_id in (select private.my_family_ids()));

-- Goals belong to one parent: visible and writable only by their owner, even within the family.
create policy goals_select on public.goals for select to authenticated
  using (family_id in (select private.my_family_ids()) and owner_user_id = (select auth.uid()));
create policy goals_insert on public.goals for insert to authenticated
  with check (family_id in (select private.my_family_ids()) and owner_user_id = (select auth.uid()));
create policy goals_update on public.goals for update to authenticated
  using (family_id in (select private.my_family_ids()) and owner_user_id = (select auth.uid()))
  with check (family_id in (select private.my_family_ids()) and owner_user_id = (select auth.uid()));

create policy saved_activities_select on public.saved_activities for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy saved_activities_insert on public.saved_activities for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy saved_activities_update on public.saved_activities for update to authenticated
  using (family_id in (select private.my_family_ids())) with check (family_id in (select private.my_family_ids()));

create policy photos_select on public.photos for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy photos_insert on public.photos for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy photos_update on public.photos for update to authenticated
  using (family_id in (select private.my_family_ids())) with check (family_id in (select private.my_family_ids()));

create policy record_versions_select on public.record_versions for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy record_versions_insert on public.record_versions for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy record_versions_update on public.record_versions for update to authenticated
  using (family_id in (select private.my_family_ids())) with check (family_id in (select private.my_family_ids()));

create policy cloud_migrations_select on public.cloud_migrations for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy cloud_migrations_insert on public.cloud_migrations for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy cloud_migrations_update on public.cloud_migrations for update to authenticated
  using (family_id in (select private.my_family_ids())) with check (family_id in (select private.my_family_ids()));
