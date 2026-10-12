-- RootMap Phase 2B-1: server-side revision control and reference checks.
-- See docs/data-architecture-phase2.md, sections 4 and 5.
--
-- Trigger order is alphabetical by name:
--   t00_member  the caller must belong to the row's family. Runs first so that no later check can reveal
--               anything about another family (e.g. "unknown child" vs "not a member"), and so that no one
--               can lock another family's row. RLS would reject the write too, but only after the triggers.
--   t10_*       reference checks and per-table guards (cheap rejections, before any lock is taken)
--   t90_stamp   assigns the server columns and the family change number

-- auth.uid() is null for server jobs (service role) and direct database sessions, which are trusted.
create function private.require_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.is_family_member(new.family_id) then
    raise exception 'not a member of this family' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger t00_member before insert or update on public.children for each row execute function private.require_member();
create trigger t00_member before insert or update on public.entries for each row execute function private.require_member();
create trigger t00_member before insert or update on public.activity_records for each row execute function private.require_member();
create trigger t00_member before insert or update on public.plans for each row execute function private.require_member();
create trigger t00_member before insert or update on public.goals for each row execute function private.require_member();
create trigger t00_member before insert or update on public.saved_activities for each row execute function private.require_member();
create trigger t00_member before insert or update on public.photos for each row execute function private.require_member();
create trigger t00_member before insert or update on public.record_versions for each row execute function private.require_member();
create trigger t00_member before insert or update on public.cloud_migrations for each row execute function private.require_member();

-- Assigns rev, change_seq, server_updated_at and updated_by, overwriting whatever the client sent.
-- `change_seq` comes from the family row, updated here; the row lock is held until the transaction ends,
-- so a concurrent writer in the same family waits and then receives the next number. Within a family,
-- change numbers therefore become visible in commit order (no later number is visible before an earlier
-- one). A rolled-back transaction also rolls back its increment.
-- Security definer: clients have no privilege on families.change_seq.
create function private.stamp_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  seq bigint;
begin
  if tg_op = 'UPDATE' then
    if new.family_id is distinct from old.family_id or new.id is distinct from old.id then
      raise exception 'family_id and id cannot change' using errcode = '42501';
    end if;
    new.rev := old.rev + 1;
  else
    new.rev := 1;
  end if;
  update public.families f set change_seq = f.change_seq + 1 where f.id = new.family_id
  returning f.change_seq into seq;
  if seq is null then
    raise exception 'family % does not exist', new.family_id using errcode = '23503';
  end if;
  new.change_seq := seq;
  new.server_updated_at := now();
  new.updated_by := uid;
  return new;
end;
$$;

create trigger t90_stamp before insert or update on public.children for each row execute function private.stamp_row();
create trigger t90_stamp before insert or update on public.entries for each row execute function private.stamp_row();
create trigger t90_stamp before insert or update on public.activity_records for each row execute function private.stamp_row();
create trigger t90_stamp before insert or update on public.plans for each row execute function private.stamp_row();
create trigger t90_stamp before insert or update on public.goals for each row execute function private.stamp_row();
create trigger t90_stamp before insert or update on public.saved_activities for each row execute function private.stamp_row();
create trigger t90_stamp before insert or update on public.photos for each row execute function private.stamp_row();
create trigger t90_stamp before insert or update on public.record_versions for each row execute function private.stamp_row();
create trigger t90_stamp before insert or update on public.cloud_migrations for each row execute function private.stamp_row();

-- plans.child_ids: every id must be a child in the same family (an array cannot carry a foreign key).
create function private.check_plan_children() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  missing text;
begin
  if tg_op = 'UPDATE' and new.child_ids is not distinct from old.child_ids then
    return new;
  end if;
  select c into missing from unnest(new.child_ids) as c
  where not exists (select 1 from public.children ch where ch.family_id = new.family_id and ch.id = c)
  limit 1;
  if found then
    raise exception 'plan refers to unknown child %', missing using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger t10_check_children before insert or update on public.plans for each row execute function private.check_plan_children();

-- entries.photo_ids: every element is a photo id of a photo row in the same family.
create function private.check_entry_photos() returns trigger
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
  return new;
end;
$$;
create trigger t10_check_photos before insert or update on public.entries for each row execute function private.check_entry_photos();

-- children.photo_ref: a photo id must be a photo row in the same family (bundled keys need no row).
create function private.check_child_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.photo_ref is not distinct from old.photo_ref then
    return new;
  end if;
  if new.photo_ref like 'photo-%'
     and not exists (select 1 from public.photos ph where ph.family_id = new.family_id and ph.id = new.photo_ref) then
    raise exception 'child refers to unknown photo %', new.photo_ref using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger t10_check_photo before insert or update on public.children for each row execute function private.check_child_photo();

-- goals: the owner is the parent who creates the goal and never changes.
create function private.guard_goal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'owner_user_id cannot change' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null and new.owner_user_id is distinct from auth.uid() then
    raise exception 'goals belong to the parent who creates them' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger t10_guard before insert or update on public.goals for each row execute function private.guard_goal();

-- photos: the content identity (hash, type, size) is fixed at creation; verification is server-only.
create function private.guard_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.sha256 is distinct from old.sha256 or new.mime_type is distinct from old.mime_type
      or new.byte_size is distinct from old.byte_size) then
    raise exception 'photo content fields cannot change' using errcode = '42501';
  end if;
  if auth.uid() is not null then
    -- Defence in depth; column privileges already stop clients writing these.
    if tg_op = 'INSERT' and (new.server_sha256 is not null or new.verified_at is not null) then
      raise exception 'verification fields are server-only' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.server_sha256 is distinct from old.server_sha256 or new.verified_at is distinct from old.verified_at) then
      raise exception 'verification fields are server-only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger t10_guard before insert or update on public.photos for each row execute function private.guard_photo();

-- record_versions: what was saved is immutable; only its resolution (and soft deletion) can change.
create function private.guard_record_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  elsif new.table_name is distinct from old.table_name or new.record_id is distinct from old.record_id
     or new.version is distinct from old.version or new.base_rev is distinct from old.base_rev
     or new.reason is distinct from old.reason or new.created_by is distinct from old.created_by then
    raise exception 'saved versions cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger t10_guard before insert or update on public.record_versions for each row execute function private.guard_record_version();

-- cloud_migrations: only the server marks an attempt complete (Phase 2B-3, complete_migration()).
create function private.guard_cloud_migration() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
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
create trigger t10_guard before insert or update on public.cloud_migrations for each row execute function private.guard_cloud_migration();
