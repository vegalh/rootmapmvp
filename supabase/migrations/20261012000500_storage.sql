-- RootMap Phase 2B-1: private photo storage.
-- See docs/data-architecture-phase2.md, sections 7.3 and 8.
-- Objects live at <family_id>/<photo_id>.<ext>. A signed-in member can read and create objects only at a
-- path that a photo row in their own family describes (photos.storage_path). There are no update or
-- delete policies: photos never change once uploaded (so `upsert` fails), and only server jobs remove them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family-photos', 'family-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- True when `object_name` is exactly the storage path of a photo row in one of the caller's families.
-- The name is matched against the strict pattern before anything is cast, so a malformed name returns
-- false instead of raising an error.
create function private.photo_object_allowed(object_name text) returns boolean
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
    select 1
    from public.photos p
    join public.family_members fm on fm.family_id = p.family_id
    where p.family_id = m[1]::uuid
      and p.id = m[2]
      and p.storage_path = object_name
      and fm.user_id = (select auth.uid())
  );
end;
$$;

create policy family_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'family-photos' and private.photo_object_allowed(name));

create policy family_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'family-photos' and private.photo_object_allowed(name));
