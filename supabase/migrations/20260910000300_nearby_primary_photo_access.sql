-- Review and run once as postgres after the three-photo migration.
-- Keep private outside the Data API exposed schemas. No SQL is run by the app.
begin;

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'profile-photos' and public = false
      and file_size_limit = 5242880
      and allowed_mime_types @> array['image/jpeg','image/png','image/webp']::text[]
      and allowed_mime_types <@ array['image/jpeg','image/png','image/webp']::text[]
  ) then
    raise exception 'Review the private profile-photos bucket configuration.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
      and c.relrowsecurity
  ) then
    raise exception 'Storage object RLS must be enabled.';
  end if;
end;
$$;

create function private.can_view_nearby_primary_photo(target_user_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null or target_user_id is null or caller_id = target_user_id
     or auth.role() is distinct from 'authenticated' then
    return false;
  end if;

  -- Reuse the exact discovery eligibility, including server time, PostGIS
  -- spheroidal 20-meter proximity, both active sessions, 15-minute freshness,
  -- expiration, caller exclusion, and an existing target profile.
  -- No duplicated radius/freshness constants and no preference filtering.
  return exists (
    select 1 from private.discover_nearby_users_impl() n
    where n.user_id = target_user_id
  );
end;
$$;

-- Validate the entire canonical object key BEFORE any UUID cast.
-- This helper returns only authorization, never metadata or sensitive fields.
create function private.can_read_nearby_primary_object(
  object_name text, object_owner text
)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated'
     or object_name is null or object_owner is null then
    return false;
  end if;
  if object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/1$' then
    return false;
  end if;
  target_id := pg_catalog.split_part(object_name, '/', 1)::uuid;
  if object_name <> target_id::text || '/1'
     or object_owner <> target_id::text then
    return false;
  end if;

  -- Require canonical position-1 metadata as well as the actual Storage row
  -- under evaluation. Owner-only metadata RLS is bypassed only in this helper.
  if not exists (
    select 1 from public.profile_photos p
    where p.user_id = target_id and p.position = 1
      and p.storage_path = object_name
  ) then
    return false;
  end if;
  return private.can_view_nearby_primary_photo(target_id);
end;
$$;

alter function private.can_view_nearby_primary_photo(uuid) owner to postgres;
alter function private.can_read_nearby_primary_object(text, text) owner to postgres;
revoke all on function private.can_view_nearby_primary_photo(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.can_read_nearby_primary_object(text, text)
  from public, anon, authenticated, service_role;
revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_view_nearby_primary_photo(uuid) to authenticated;
grant execute on function private.can_read_nearby_primary_object(text, text) to authenticated;

-- Replace only the ALL-command restrictive guard. Existing permissive
-- SELECT/INSERT/UPDATE/DELETE policies remain, bounded by these command guards.
drop policy profile_photos_owner_guard on storage.objects restrict;

create policy profile_photos_select_guard
on storage.objects as restrictive for select to public
using (bucket_id <> 'profile-photos' or ((auth.role() = 'authenticated'
    and owner_id = auth.uid()::text
    and name in (auth.uid()::text || '/1', auth.uid()::text || '/2',
                 auth.uid()::text || '/3', auth.uid()::text || '/profile'))
    or private.can_read_nearby_primary_object(name, owner_id)));

create policy profile_photos_insert_guard
on storage.objects as restrictive for insert to public
with check (bucket_id <> 'profile-photos' or (auth.role() = 'authenticated'
    and owner_id = auth.uid()::text
    and name in (auth.uid()::text || '/1', auth.uid()::text || '/2',
                 auth.uid()::text || '/3', auth.uid()::text || '/profile')));

create policy profile_photos_update_guard
on storage.objects as restrictive for update to public
using (bucket_id <> 'profile-photos' or (auth.role() = 'authenticated'
    and owner_id = auth.uid()::text
    and name in (auth.uid()::text || '/1', auth.uid()::text || '/2',
                 auth.uid()::text || '/3', auth.uid()::text || '/profile')))
with check (bucket_id <> 'profile-photos' or (auth.role() = 'authenticated'
    and owner_id = auth.uid()::text
    and name in (auth.uid()::text || '/1', auth.uid()::text || '/2',
                 auth.uid()::text || '/3', auth.uid()::text || '/profile')));

create policy profile_photos_delete_guard
on storage.objects as restrictive for delete to public
using (bucket_id <> 'profile-photos' or (auth.role() = 'authenticated'
    and owner_id = auth.uid()::text
    and name in (auth.uid()::text || '/1', auth.uid()::text || '/2',
                 auth.uid()::text || '/3', auth.uid()::text || '/profile')));

comment on function private.can_view_nearby_primary_photo(uuid) is
  'Boolean authorization using the existing nearby implementation. Authenticated non-owner only; exact same active, fresh, unexpired, 20-meter PostGIS eligibility. No preference filters or sensitive output.';
comment on function private.can_read_nearby_primary_object(text, text) is
  'Validates canonical UUID/1, matching Storage owner, position-1 metadata, and nearby eligibility. Rejects malformed keys and all secondary/legacy paths for strangers.';

-- Existing owner permissions, three-slot unique index, bucket configuration,
-- profile/metadata RLS, nearby functions and return fields remain unchanged.
-- No Storage object rows or image bytes are modified.
--
-- Signed URL caveat: SELECT checks eligibility when a URL is issued.
-- An issued bearer URL can remain usable until expiry after STOP or movement.
-- This SQL cannot enforce a short expiresIn supplied to Storage by the client.
-- Later app code should request short lifetimes and keep URLs in memory only.
-- Strict per-download revocation or a server-enforced lifetime cap would need
-- a different delivery/signing mechanism. No signed URLs are created here.
notify pgrst, 'reload schema';
commit;
