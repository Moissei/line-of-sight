-- Remove distance disclosure without changing server-side eligibility.
-- Return-type changes require recreation. Unexpected dependencies must fail closed.
begin;

drop function public.discover_nearby_users() restrict;
drop function private.discover_nearby_users_impl() restrict;

create function private.discover_nearby_users_impl()
returns table (user_id uuid, first_name text, age integer, gender text,
               bio text, intents text[])
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_radius_meters constant double precision := 20.0;
  v_max_age constant interval := interval '15 minutes';
  v_now constant timestamptz := pg_catalog.statement_timestamp();
  v_today constant date := (v_now at time zone 'UTC')::date;
  v_caller_id uuid := auth.uid();
  v_origin extensions.geography;
begin
  if v_caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  select extensions.st_setsrid(
    extensions.st_makepoint(s.longitude, s.latitude), 4326
  )::extensions.geography into v_origin
  from public.active_discovery_sessions s
  where s.user_id = v_caller_id and s.is_active = true
    and s.latitude between -90 and 90 and s.longitude between -180 and 180
    and s.updated_at > v_now - v_max_age and s.updated_at <= v_now
    and (s.expires_at is null or s.expires_at > v_now);
  if v_origin is null then return; end if;

  return query
  with candidates as materialized (
    select s.user_id as candidate_id,
      extensions.st_setsrid(
        extensions.st_makepoint(s.longitude, s.latitude), 4326
      )::extensions.geography as position
    from public.active_discovery_sessions s
    where s.user_id <> v_caller_id and s.is_active = true
      and s.latitude between -90 and 90 and s.longitude between -180 and 180
      and s.updated_at > v_now - v_max_age and s.updated_at <= v_now
      and (s.expires_at is null or s.expires_at > v_now)
      and not private.users_are_blocked(v_caller_id, s.user_id)
  ), nearby as materialized (
    select c.candidate_id
    from candidates c
    where extensions.st_dwithin(v_origin, c.position, v_radius_meters, true)
  )
  select p.user_id, p.first_name,
    extract(year from pg_catalog.age(v_today::timestamp, p.date_of_birth::timestamp))::integer,
    p.gender, p.bio, p.intents
  from nearby n join public.profiles p on p.user_id = n.candidate_id
  order by p.user_id;
end;
$$;

create function public.discover_nearby_users()
returns table (user_id uuid, first_name text, age integer, gender text,
               bio text, intents text[])
language plpgsql stable security invoker set search_path = ''
as $$
begin
  return query select n.user_id, n.first_name, n.age, n.gender, n.bio,
    n.intents from private.discover_nearby_users_impl() n order by n.user_id;
end;
$$;

alter function private.discover_nearby_users_impl() owner to postgres;
alter function public.discover_nearby_users() owner to postgres;
revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke all on function private.discover_nearby_users_impl() from public, anon, authenticated, service_role;
revoke all on function public.discover_nearby_users() from public, anon, authenticated, service_role;
grant execute on function private.discover_nearby_users_impl() to authenticated;
grant execute on function public.discover_nearby_users() to authenticated;

comment on function private.discover_nearby_users_impl() is
  'Authenticated nearby profiles within 20 meters using fresh active sessions and bilateral block/account checks. Coordinates stay internal; results contain no distance and are ordered by user UUID. Intentions do not filter eligibility.';
comment on function public.discover_nearby_users() is
  'Authenticated discovery: six safe profile fields, ordered by user UUID, with no coordinate or distance output. Eligibility is enforced by the private implementation.';

notify pgrst, 'reload schema';
commit;
