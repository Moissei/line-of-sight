-- Review and run once as postgres in Supabase SQL Editor. Not run by the app.
-- Requires public.profiles and Supabase Storage. No image uploads are performed.
begin;

-- Storage manages this table. Verify its RLS instead of changing its ownership
-- or grants. Abort the whole migration if the expected protection is missing.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
      and c.relrowsecurity
  ) then
    raise exception 'Storage object RLS must be enabled before this migration.';
  end if;
end;
$$;

-- A name conflict intentionally fails; do not silently alter an existing bucket.
-- 5 MB here means 5 * 1024 * 1024 bytes (5 MiB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos', 'profile-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
);

alter table public.profiles
  add column profile_photo_path text,
  add constraint profiles_primary_photo_path check (
    profile_photo_path is null
    or profile_photo_path = user_id::text || '/profile'
  );

comment on column public.profiles.profile_photo_path is
  'Optional object path in private profile-photos bucket: <auth-user-id>/profile. Never store image bytes, public URLs, or expiring signed URLs. Other users require a future authorized photo-access flow.';

-- Exactly one allowed object key per user. The extensionless name permits all
-- three supported formats at the same key; uploads must set the real Content-Type.
-- Storage already enforces uniqueness of (bucket_id, name).
-- Existing owner-only profiles RLS and grants are unchanged.

-- Restrictive policies combine with permissive policies using AND. This guard
-- prevents unrelated broad Storage policies from opening this bucket to others.
-- Other buckets are unaffected. Trusted service-role/owner access bypasses RLS;
-- never put service-role credentials in the app.
create policy profile_photos_owner_guard
on storage.objects as restrictive
for all to public
using (
  bucket_id <> 'profile-photos'
  or (
    (select auth.role()) = 'authenticated'
    and name = (select auth.uid())::text || '/profile'
    and owner_id = (select auth.uid())::text
  )
)
with check (
  bucket_id <> 'profile-photos'
  or (
    (select auth.role()) = 'authenticated'
    and name = (select auth.uid())::text || '/profile'
    and owner_id = (select auth.uid())::text
  )
);

create policy profile_photos_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and name = (select auth.uid())::text || '/profile'
  and owner_id = (select auth.uid())::text
);

create policy profile_photos_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and name = (select auth.uid())::text || '/profile'
  and owner_id = (select auth.uid())::text
);

create policy profile_photos_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-photos'
  and name = (select auth.uid())::text || '/profile'
  and owner_id = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-photos'
  and name = (select auth.uid())::text || '/profile'
  and owner_id = (select auth.uid())::text
);

create policy profile_photos_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and name = (select auth.uid())::text || '/profile'
  and owner_id = (select auth.uid())::text
);

-- Future app flow: upload/replace this fixed key through the Storage API, then
-- save the path to the owner's profile. Delete through Storage API and clear the
-- profile path. A path is a reference, not proof that an object currently exists.
-- Do not insert/delete storage.objects rows manually to upload/delete file bytes.
-- No bucket-management policy, anonymous allow policy, or broad photo-read grant.
notify pgrst, 'reload schema';
commit;
