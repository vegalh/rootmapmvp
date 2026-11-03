-- Shared Child Profiles, Phase 2b: photos added for a shared child (docs/shared-child-profiles-phase2b.md).
--
-- Until now only members of a family could add a photo to it (Phase 1b), so an editor from another family couldn't
-- add a picture to a Moment of the child shared with them. A photo can now say which child it is for (`child_id`):
-- anyone who can write that child (owner or editor) may add it, and until a Moment or the child's profile shows it,
-- it is readable by that child's members and writable by its writers, and by no one else (not even other members of
-- the family who have no role on that child). Once a Moment
-- or profile shows it, it follows those children exactly as before (Phase 1b). Viewers and outsiders can't add one.
--
-- Nothing changes for existing photos or for a family adding its own (they never send child_id). Paths stay
-- <family_id>/<photo_id>.<ext>: the photo belongs to the child's family.

alter table public.photos add column child_id text
  check (child_id is null or (char_length(child_id) between 1 and 128 and child_id !~ '[[:cntrl:]]'));

-- Set once, with the new row; never changed (no update grant; the trigger below refuses it too).
grant insert (child_id) on public.photos to authenticated;

-- A photo's children: the children whose Moments or profile show it; if none, the child it was added for (`hint`, or
-- the row's own child_id); if none, its family (as before, for photos a family adds for itself). The policies pass the
-- row's child_id, because `insert … returning` is checked before the new row can be read back.
create function private.photo_access(fid uuid, pid text, want_write boolean, hint text) returns boolean
language sql stable security definer set search_path = '' as $$
  with linked as (
    select e.child_id from public.entries e where e.family_id = fid and e.photo_ids @> array[pid]
    union
    select c.id from public.children c where c.family_id = fid and c.photo_ref = pid
  ), hinted as (
    select coalesce(hint, (select p.child_id from public.photos p where p.family_id = fid and p.id = pid)) as child_id
  )
  select case
    when exists (select 1 from linked) then exists (
      select 1 from linked l
      where (want_write and private.can_write_child(fid, l.child_id)) or (not want_write and private.child_role(fid, l.child_id) is not null))
    when exists (select 1 from hinted where child_id is not null) then exists (
      select 1 from hinted h
      where (want_write and private.can_write_child(fid, h.child_id)) or (not want_write and private.child_role(fid, h.child_id) is not null))
    else private.is_family_member(fid)
  end;
$$;

create or replace function private.photo_access(fid uuid, pid text, want_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$ select private.photo_access(fid, pid, want_write, null); $$;

revoke all on function private.photo_access(uuid, text, boolean, text) from public, anon;
grant execute on function private.photo_access(uuid, text, boolean, text) to authenticated, service_role;

drop policy photos_select on public.photos;
drop policy photos_update on public.photos;
create policy photos_select on public.photos for select to authenticated
  using (private.photo_access(family_id, id, false, child_id));
create policy photos_update on public.photos for update to authenticated
  using (private.photo_access(family_id, id, true, child_id)) with check (private.photo_access(family_id, id, true, child_id));

create or replace function private.require_photo_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- Added by the family, or for a child the user can write.
    if not private.is_family_member(new.family_id)
       and (new.child_id is null or not private.can_write_child(new.family_id, new.child_id)) then
      raise exception 'not a member of this family' using errcode = '42501';
    end if;
  else
    if new.child_id is distinct from old.child_id then
      raise exception 'a photo''s child cannot change' using errcode = '42501';
    end if;
    if not private.can_write_photo(old.family_id, old.id) then
      raise exception 'no write access to this photo' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop policy photos_insert on public.photos;
create policy photos_insert on public.photos for insert to authenticated
  with check (family_id in (select private.my_family_ids())
              or (child_id is not null and private.can_write_child(family_id, child_id)));
