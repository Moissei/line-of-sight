-- Review, then run the whole file as postgres. Do not expose private in the Data API.
-- Requires profiles, active_discovery_sessions, and PostGIS in extensions.
begin;

create schema if not exists private authorization postgres;

-- Return types changed: drop the dependent wrapper before its implementation.
-- RESTRICT intentionally fails on other dependencies; never use CASCADE here.
drop function if exists public.discover_nearby_users() restrict;
drop function if exists private.discover_nearby_users_impl() restrict;

create function private.discover_nearby_users_impl()
returns table (
  user_id uuid,
  first_name text,
  age integer,
  gender text,
  bio text,
  intents text[],
  distance_meters integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_radius_meters constant double precision := 20.0;
  v_max_age constant interval := interval '15 minutes';
  v_now constant timestamptz := statement_timestamp();
  v_today constant date := (v_now at time zone 'UTC')::date;
  v_caller_id uuid := auth.uid();
  v_origin extensions.geography;
begin
  if v_caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

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
  ), nearby as materialized (
    select c.candidate_id,
      extensions.st_distance(v_origin, c.position, true) as measured_meters
    from candidates c
    where extensions.st_dwithin(v_origin, c.position, v_radius_meters, true)
  )
  select p.user_id, p.first_name,
    extract(year from pg_catalog.age(
      v_today::timestamp, p.date_of_birth::timestamp
    ))::integer,
    p.gender, p.bio, p.intents,
    -- Temporary development field: remove or generalize before production.
    pg_catalog.round(n.measured_meters)::integer
  from nearby n
  inner join public.profiles p on p.user_id = n.candidate_id
  -- Missing profiles are excluded; no intent, gender, age, or preference filters.
  -- A missing birth date produces NULL age, not exclusion.
  order by n.measured_meters, p.user_id;
end;
$$;

alter function private.discover_nearby_users_impl() owner to postgres;
revoke all on function private.discover_nearby_users_impl()
  from public, anon, authenticated, service_role;

create function public.discover_nearby_users()
returns table (
  user_id uuid,
  first_name text,
  age integer,
  gender text,
  bio text,
  intents text[],
  distance_meters integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  -- Forward the implementation's nearest-first sequence and explicit safe fields.
  return query
    select n.user_id, n.first_name, n.age, n.gender, n.bio,
      n.intents, n.distance_meters
    from private.discover_nearby_users_impl() n;
end;
$$;

alter function public.discover_nearby_users() owner to postgres;
revoke all on function public.discover_nearby_users()
  from public, anon, authenticated, service_role;

-- An invoker wrapper requires its caller to execute the private implementation.
-- This grants no table access. The implementation independently validates auth.uid().
-- Keep private outside Supabase's exposed schemas; USAGE does not expose an API.
revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.discover_nearby_users_impl() to authenticated;
grant execute on function public.discover_nearby_users() to authenticated;

comment on function private.discover_nearby_users_impl() is
  'Privileged safe-profile projection for active, fresh, unexpired users within 20 meters. Excludes caller and missing profiles. No preference filters. Never returns coordinates or birth dates. Rounded distance is temporary development data; remove or generalize before production.';
comment on function public.discover_nearby_users() is
  'Authenticated invoker wrapper for private nearby-profile discovery. Returns only user_id, first_name, calculated age, gender, bio, intents, and temporary distance_meters.';

-- No table grants, RLS changes, profile/session writes, or application changes.
notify pgrst, 'reload schema';
commit;
