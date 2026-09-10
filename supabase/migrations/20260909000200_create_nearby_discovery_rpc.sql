-- Run once, in full, as postgres in the Supabase SQL Editor.
-- Requires the active_discovery_sessions migration. Does not modify session rows.
begin;

create extension if not exists postgis with schema extensions;

-- Do not move or replace an existing PostGIS installation automatically.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'postgis' and n.nspname = 'extensions'
  ) then
    raise exception 'PostGIS must be installed in the extensions schema. Review its existing installation before running this migration.';
  end if;
end;
$$;

create function public.discover_nearby_users()
returns table (user_id uuid, distance_meters integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Database-owner configuration, NOT client input. Tune via a reviewed migration.
  -- Keeping a shared radius preserves reciprocal, close-range discovery.
  v_radius_meters constant double precision := 20.0;
  v_max_age constant interval := interval '15 minutes';
  v_now constant timestamptz := statement_timestamp();
  v_caller_id uuid := auth.uid();
  v_origin extensions.geography;
begin
  if v_caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  -- The caller must also be actively discoverable, fresh, and unexpired.
  -- Never accept a caller ID or coordinates from RPC parameters.
  select extensions.st_setsrid(
    extensions.st_makepoint(s.longitude, s.latitude), 4326
  )::extensions.geography
  into v_origin
  from public.active_discovery_sessions s
  where s.user_id = v_caller_id
    and s.is_active = true
    and s.latitude between -90 and 90
    and s.longitude between -180 and 180
    and s.updated_at > v_now - v_max_age
    and s.updated_at <= v_now
    and (s.expires_at is null or s.expires_at > v_now);

  if v_origin is null then
    return;
  end if;

  return query
  with candidates as materialized (
    select s.user_id as candidate_id,
      extensions.st_setsrid(
        extensions.st_makepoint(s.longitude, s.latitude), 4326
      )::extensions.geography as position
    from public.active_discovery_sessions s
    where s.user_id <> v_caller_id
      and s.is_active = true
      and s.latitude between -90 and 90
      and s.longitude between -180 and 180
      and s.updated_at > v_now - v_max_age
      and s.updated_at <= v_now
      and (s.expires_at is null or s.expires_at > v_now)
  ), nearby as (
    select c.candidate_id,
      extensions.st_distance(v_origin, c.position, true) as measured_meters
    from candidates c
    -- Geography uses meters and spheroidal distance, including across the dateline.
    where extensions.st_dwithin(v_origin, c.position, v_radius_meters, true)
  )
  select n.candidate_id, pg_catalog.round(n.measured_meters)::integer
  from nearby n
  order by n.measured_meters, n.candidate_id;
end;
$$;

-- The trusted owner can read rows through RLS only inside this narrow function.
-- No table grants or row policies are added; other users' direct reads stay denied.
alter function public.discover_nearby_users() owner to postgres;
revoke all on function public.discover_nearby_users() from public, anon, authenticated, service_role;
grant execute on function public.discover_nearby_users() to authenticated;

comment on function public.discover_nearby_users() is
  'Close-range discovery: active + fresh + unexpired + nearby only. Default radius 20 meters, tunable by the database owner in the function body. Returns other user IDs and whole-meter distances, never coordinates. No intent or profile preference filters. Stable RPC contract allows later GPS/BLE implementation changes.';

commit;
