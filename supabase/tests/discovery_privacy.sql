-- ISOLATED DATABASE ONLY, with all migrations through 20260919000100 already applied.
-- Run manually as postgres using psql -v ON_ERROR_STOP=1. Explicit opt-in required:
-- PGOPTIONS='-c line_of_sight.test_isolated=on' psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/discovery_privacy.sql
-- No migration is applied by this test. All fixtures and helper functions roll back.
begin;
do $$ begin
  if current_setting('line_of_sight.test_isolated', true) is distinct from 'on'
     or current_user <> 'postgres' then
    raise exception 'Requires explicit isolated-database opt-in and postgres';
  end if;
  if exists (select 1 from auth.users) then
    raise exception 'Requires an empty isolated Auth database';
  end if;
end $$;

create function pg_temp.check_true(ok boolean, label text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
end $$;

-- Verify both return contracts, attributes, ownership and exact execution ACLs.
do $$ declare p record; begin
  for p in select * from pg_proc where oid in (
    'public.discover_nearby_users()'::regprocedure,
    'private.discover_nearby_users_impl()'::regprocedure
  ) loop
    perform pg_temp.check_true(pg_get_function_result(p.oid) =
      'TABLE(user_id uuid, first_name text, age integer, gender text, bio text, intents text[])', 'six output columns');
    perform pg_temp.check_true(p.provolatile = 's' and
      p.prosecdef = (p.pronamespace = 'private'::regnamespace) and
      pg_get_userbyid(p.proowner) = 'postgres' and
      (p.proconfig @> array['search_path=""'] or p.proconfig @> array['search_path=']), 'function security attributes');
    perform pg_temp.check_true(has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'execution grants');
  end loop;
  perform pg_temp.check_true(not has_schema_privilege('authenticated', 'private', 'CREATE')
    and not has_schema_privilege('anon', 'private', 'CREATE'), 'private schema restrictions');
end $$;

-- UUID 2 is farther away than UUID 3: output must still be 2,3.
create temporary table fixtures (n integer primary key, id uuid, meters double precision);
insert into fixtures select n, ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  case n when 1 then 0 when 2 then 19 when 3 then 1 when 4 then 21 else 5 end
from generate_series(1, 10) n;
insert into auth.users(id) select id from fixtures;
insert into public.profiles(user_id, first_name, intents)
select id, 'Fixture', case n when 1 then array['Dating'] when 2 then array['Networking'] else array[]::text[] end
from fixtures;
insert into public.active_discovery_sessions(user_id, latitude, longitude, is_active)
select id, extensions.st_y(pos::extensions.geometry), extensions.st_x(pos::extensions.geometry), true
from fixtures cross join lateral (
  select extensions.st_project(extensions.st_setsrid(extensions.st_makepoint(0, 0), 4326)::extensions.geography,
    meters, 0.0) pos
) point;
-- Disable only timestamp preparation to create intentionally stale fixture timestamps.
alter table public.active_discovery_sessions disable trigger prepare_active_discovery_session;
update public.active_discovery_sessions s set
  updated_at = statement_timestamp() - case when f.n = 5 then interval '16 minutes' else interval '1 second' end,
  expires_at = case when f.n in (1, 2) then null when f.n = 6 then statement_timestamp() - interval '1 second'
    else statement_timestamp() + interval '15 minutes' end,
  is_active = f.n <> 7,
  latitude = case when f.n = 7 then null else s.latitude end,
  longitude = case when f.n = 7 then null else s.longitude end
from fixtures f where s.user_id = f.id;
alter table public.active_discovery_sessions enable trigger prepare_active_discovery_session;
insert into public.user_blocks(blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000008'),
  ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000001');
update private.account_participants set state = 'pending', deletion_started_at = statement_timestamp()
where participant_id = '00000000-0000-4000-8000-000000000010';
insert into public.profile_photos(user_id, position, storage_path) values
  ('00000000-0000-4000-8000-000000000002', 1, '00000000-0000-4000-8000-000000000002/1');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check_true((select array_agg(user_id) from public.discover_nearby_users()) = array[
  '00000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-4000-8000-000000000003'::uuid
], 'inside/outside 20m, UUID ordering, NULL expiry, stale/expired/inactive/self/bilateral block/nonactive exclusions and disjoint/empty intentions');
select pg_temp.check_true(private.can_view_nearby_primary_photo('00000000-0000-4000-8000-000000000002')
  and private.can_read_nearby_primary_object('00000000-0000-4000-8000-000000000002/1', '00000000-0000-4000-8000-000000000002')
  and not private.can_view_nearby_primary_photo('00000000-0000-4000-8000-000000000004'), 'photo eligibility');
select pg_temp.check_true(public.send_connection_request('00000000-0000-4000-8000-000000000002') is not null, 'eligible request succeeds');
reset role;

-- Move the previously discovered target outside the radius before requesting again.
update public.active_discovery_sessions set latitude = 0.001
where user_id = '00000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.check_true(not private.can_view_nearby_primary_photo('00000000-0000-4000-8000-000000000002'), 'photo eligibility revoked after moving');
do $$ begin
  begin
    perform public.send_connection_request('00000000-0000-4000-8000-000000000002');
    raise exception 'FAIL: request trusted earlier discovery';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Caller-side freshness, expiry, active flag and active-account enforcement.
alter table public.active_discovery_sessions disable trigger prepare_active_discovery_session;
update public.active_discovery_sessions set updated_at = statement_timestamp() - interval '16 minutes'
where user_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.check_true(not exists(select 1 from public.discover_nearby_users()), 'stale caller');
reset role;
update public.active_discovery_sessions set updated_at = statement_timestamp() - interval '1 second', expires_at = statement_timestamp() - interval '1 second'
where user_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.check_true(not exists(select 1 from public.discover_nearby_users()), 'expired caller');
reset role;
update public.active_discovery_sessions set expires_at = null, is_active = false, latitude = null, longitude = null
where user_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.check_true(not exists(select 1 from public.discover_nearby_users()), 'inactive caller');
reset role;
update public.active_discovery_sessions set is_active = true, latitude = 0, longitude = 0, updated_at = statement_timestamp() - interval '1 second'
where user_id = '00000000-0000-4000-8000-000000000001';
alter table public.active_discovery_sessions enable trigger prepare_active_discovery_session;
update private.account_participants set state = 'pending', deletion_started_at = statement_timestamp()
where participant_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.check_true(not exists(select 1 from public.discover_nearby_users()), 'nonactive caller account');
reset role;
rollback;
