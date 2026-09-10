-- Review only. Run once as postgres after the single-photo storage migration.
-- Coordinate deployment with the later application migration. No object rows
-- or file bytes are inserted, updated, renamed, or deleted by this SQL.
begin;

-- Fail safely if the existing bucket or RLS differs from the expected setup.
do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'profile-photos' and public = false
      and file_size_limit = 5242880
      and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']::text[]
      and allowed_mime_types <@ array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then
    raise exception 'Review the profile-photos bucket privacy, MIME types, and size limit before proceeding.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'Storage object RLS must be enabled.';
  end if;
end;
$$;

create table public.profile_photos (
  user_id uuid not null references auth.users(id) on delete cascade,
  position smallint not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, position),
  constraint profile_photos_position_valid check (position between 1 and 3),
  constraint profile_photos_path_valid check (
    storage_path = user_id::text || '/' || position::text
  ),
  constraint profile_photos_path_unique unique (storage_path)
);

alter table public.profile_photos enable row level security;
revoke all on table public.profile_photos from public, anon, authenticated;
grant select, insert, update, delete on table public.profile_photos to authenticated;

create policy profile_photos_select_own on public.profile_photos
for select to authenticated using ((select auth.uid()) = user_id);
create policy profile_photos_insert_own on public.profile_photos
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy profile_photos_update_own on public.profile_photos
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy profile_photos_delete_own on public.profile_photos
for delete to authenticated using ((select auth.uid()) = user_id);

comment on table public.profile_photos is
  'Canonical metadata for up to three numbered photos per user. Position 1 is primary. Owner-only; no signed URLs. Write metadata only after a successful Storage API upload or move. Metadata does not itself prove that file bytes exist.';
comment on column public.profiles.profile_photo_path is
  'Deprecated legacy /profile reference retained for migration recovery and old-client compatibility. New numbered photos use public.profile_photos exclusively. Clear only after the Storage API move to /1 and position-1 metadata save succeed. Remove in a later reviewed migration after all legacy objects and old clients are retired.';

-- Custom Storage index: /profile and /1 are aliases for the SAME primary slot.
-- Unique-index enforcement handles concurrent writes; counting objects in RLS
-- would be race-prone. /2 and /3 remain independent slots. Thus legacy + three
-- numbered objects cannot coexist. Existing conflicts abort the transaction.
-- This changes no object rows. Keep the index until legacy paths are retired.
create unique index profile_photos_primary_slot_unique
on storage.objects ((pg_catalog.regexp_replace(name, '/profile$', '/1')))
where bucket_id = 'profile-photos';

-- Replace the old bucket policies transactionally. No CASCADE.
drop policy profile_photos_owner_guard on storage.objects restrict;
drop policy profile_photos_insert_own on storage.objects restrict;
drop policy profile_photos_select_own on storage.objects restrict;
drop policy profile_photos_update_own on storage.objects restrict;
drop policy profile_photos_delete_own on storage.objects restrict;

-- Temporary /profile compatibility supports the current app and API migration.
-- The unique index prevents it from becoming a fourth photo or a second primary.
-- Restrictive guard prevents other permissive Storage policies bypassing this
-- bucket's owner/path restrictions. It leaves other buckets unaffected.
create policy profile_photos_owner_guard
on storage.objects as restrictive for all to public
using (
  bucket_id <> 'profile-photos' or (
    (select auth.role()) = 'authenticated'
    and owner_id = (select auth.uid())::text
    and name in (
      (select auth.uid())::text || '/1',
      (select auth.uid())::text || '/2',
      (select auth.uid())::text || '/3',
      (select auth.uid())::text || '/profile'
    )
  )
)
with check (
  bucket_id <> 'profile-photos' or (
    (select auth.role()) = 'authenticated'
    and owner_id = (select auth.uid())::text
    and name in (
      (select auth.uid())::text || '/1',
      (select auth.uid())::text || '/2',
      (select auth.uid())::text || '/3',
      (select auth.uid())::text || '/profile'
    )
  )
);

-- The guard above supplies the mandatory owner/path checks for every operation.
create policy profile_photos_insert_own on storage.objects
for insert to authenticated with check (bucket_id = 'profile-photos');
create policy profile_photos_select_own on storage.objects
for select to authenticated using (bucket_id = 'profile-photos');
create policy profile_photos_update_own on storage.objects
for update to authenticated using (bucket_id = 'profile-photos')
with check (bucket_id = 'profile-photos');
create policy profile_photos_delete_own on storage.objects
for delete to authenticated using (bucket_id = 'profile-photos');

-- No metadata backfill: /1 does not exist merely because /profile exists.
-- Later authenticated app flow, resumable after each step:
-- 1. Use Storage API move('<uid>/profile', '<uid>/1'); do not copy, since the
--    shared-slot index intentionally prevents both objects from coexisting.
-- 2. Verify /1 through Storage API, then upsert profile_photos position 1.
-- 3. Clear profiles.profile_photo_path only after both operations succeed.
-- On retry, inspect both paths through Storage API and resume; do not blindly
-- overwrite an existing /1 or discard the legacy reference on failure.
-- Keep legacy fallback reads until migration completes. Never dual-write new
-- numbered paths into the old column. A later migration can retire /profile
-- policies, the alias index, and the old column after verifying completion.
-- No bucket changes, profiles RLS changes, nearby RPC changes, or grants of
-- service-role credentials. Storage API operations remain authenticated.
notify pgrst, 'reload schema';
commit;
