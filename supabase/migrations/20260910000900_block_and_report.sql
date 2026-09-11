-- REVIEW ONLY. Apply manually as postgres after migrations through 20260910000800.
-- Replaces the UNAPPLIED 009 draft; requires migrations through 008.
-- No app changes. Blocking permanently ends connections; messages are retained.
-- Realtime caches authorization: existing subscribers are not forcibly evicted.
-- Existing signed photo URLs remain usable until expiry; cached client data
-- cannot be erased by SQL. Subsequent RPCs/new channel joins enforce blocks.
begin;

-- Existing rows start active. The primary key and messages FK are unchanged.
alter table public.connections
  add column ended_at timestamptz,
  add column ended_reason text,
  add constraint connections_end_state check (
    (ended_at is null and ended_reason is null)
    or (ended_at is not null and pg_catalog.isfinite(ended_at)
        and ended_reason is not null and ended_reason = 'blocked')
  ),
  drop constraint connections_unique_pair restrict;

create unique index connections_one_active_pair
on public.connections(user_low, user_high) where ended_at is null;

-- Accepted requests remain history, not a permanent ban on new requests.
drop index public.connection_requests_one_active_pair restrict;
create unique index connection_requests_one_pending_pair
on public.connection_requests(sender_id, recipient_id) where status = 'pending';

create function private.preserve_connection_lifecycle()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_low is distinct from old.user_low
     or new.user_high is distinct from old.user_high
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '23514', message = 'Connection identity is immutable.';
  end if;
  if old.ended_at is not null and
     (new.ended_at is distinct from old.ended_at
      or new.ended_reason is distinct from old.ended_reason) then
    raise exception using errcode = '23514', message = 'Ended connections cannot be reopened.';
  end if;
  return new;
end;
$$;
create trigger preserve_connection_lifecycle
before update on public.connections
for each row execute function private.preserve_connection_lifecycle();

create table public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);
create index user_blocks_reverse on public.user_blocks(blocked_id, blocker_id);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from public, anon, authenticated;

create table public.user_reports (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  details text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint user_reports_not_self check (reporter_id <> reported_user_id),
  constraint user_reports_reason check (
    reason in ('Harassment', 'Spam', 'Fake profile',
               'Inappropriate content', 'Safety concern', 'Other')
  ),
  constraint user_reports_details check (pg_catalog.char_length(details) <= 1000)
);
create index user_reports_target on public.user_reports(reported_user_id, created_at);
alter table public.user_reports enable row level security;
revoke all on public.user_reports from public, anon, authenticated;
-- No client table policies or read endpoints for blocks/reports.
-- Account deletion cascades these records; blocking alone never deletes history.

create function private.users_are_blocked(user_a uuid, user_b uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare caller_id uuid := auth.uid();
begin
  -- Fail closed and prevent authenticated callers probing arbitrary third-party pairs.
  if caller_id is null or auth.role() is distinct from 'authenticated'
     or user_a is null or user_b is null
     or caller_id not in (user_a, user_b) then
    return true;
  end if;
  return exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = user_a and b.blocked_id = user_b)
       or (b.blocker_id = user_b and b.blocked_id = user_a)
  );
end;
$$;

-- All cooperating pair mutations take the same transaction-scoped lock BEFORE
-- checking blocks. Hash collisions only serialize unrelated pairs; they grant
-- no access. READ COMMITTED ensures checks after waiting see committed blocks.
create function private.lock_interaction_pair(user_a uuid, user_b uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '40001', message = 'Please retry the operation.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'los-interaction:' || least(user_a, user_b)::text || ':' ||
    greatest(user_a, user_b)::text, 0
  ));
end;
$$;

create function private.block_user_impl(target_user_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare caller_id uuid := auth.uid();
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if target_user_id is null or target_user_id = caller_id then
    raise exception using errcode = '22023', message = 'Invalid user.';
  end if;
  perform private.lock_interaction_pair(caller_id, target_user_id);
  if not exists (select 1 from auth.users u where u.id = target_user_id) then
    raise exception using errcode = '22023', message = 'User is not available.';
  end if;
  insert into public.user_blocks(blocker_id, blocked_id)
  values (caller_id, target_user_id)
  on conflict (blocker_id, blocked_id) do nothing;

  -- Existing trigger supplies updated_at. No rejection notification is sent.
  -- Canceled pending requests do not revive on unblock.
  update public.connection_requests r set status = 'declined'
  where r.status = 'pending'
    and ((r.sender_id = caller_id and r.recipient_id = target_user_id)
      or (r.sender_id = target_user_id and r.recipient_id = caller_id));

  update public.connections c
  set ended_at = pg_catalog.clock_timestamp(), ended_reason = 'blocked'
  where c.user_low = least(caller_id, target_user_id)
    and c.user_high = greatest(caller_id, target_user_id)
    and c.ended_at is null;
  -- Never delete connections or move/delete their historical messages.
end;
$$;

create function public.block_user(target_user_id uuid)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.block_user_impl(target_user_id); $$;

create function private.unblock_user_impl(target_user_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare caller_id uuid := auth.uid();
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if target_user_id is null or target_user_id = caller_id then
    raise exception using errcode = '22023', message = 'Invalid user.';
  end if;
  perform private.lock_interaction_pair(caller_id, target_user_id);
  delete from public.user_blocks b
  where b.blocker_id = caller_id and b.blocked_id = target_user_id;
  -- No connection updates. Ended relationships never resume.
end;
$$;

create function public.unblock_user(target_user_id uuid)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.unblock_user_impl(target_user_id); $$;

create function private.report_user_impl(target_user_id uuid, reason text, details text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare caller_id uuid := auth.uid();
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if target_user_id is null or target_user_id = caller_id then
    raise exception using errcode = '22023', message = 'Invalid user.';
  end if;
  if reason is null or reason not in ('Harassment', 'Spam', 'Fake profile',
      'Inappropriate content', 'Safety concern', 'Other')
     or pg_catalog.char_length(details) > 1000 then
    raise exception using errcode = '22023', message = 'Invalid report.';
  end if;
  if not exists (select 1 from auth.users u where u.id = target_user_id) then
    raise exception using errcode = '22023', message = 'User is not available.';
  end if;
  insert into public.user_reports(reporter_id, reported_user_id, reason, details)
  values (caller_id, target_user_id, reason,
    nullif(pg_catalog.regexp_replace(details, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''));
  -- Reporting neither creates a block nor returns a report identifier.
end;
$$;

create function public.report_user(target_user_id uuid, reason text, details text default null)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.report_user_impl(target_user_id, reason, details); $$;

-- Existing function signatures and return shapes remain unchanged.
create or replace function private.discover_nearby_users_impl()
returns table (user_id uuid, first_name text, age integer, gender text,
               bio text, intents text[], distance_meters integer)
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
    select c.candidate_id,
      extensions.st_distance(v_origin, c.position, true) as measured_meters
    from candidates c
    where extensions.st_dwithin(v_origin, c.position, v_radius_meters, true)
  )
  select p.user_id, p.first_name,
    extract(year from pg_catalog.age(v_today::timestamp, p.date_of_birth::timestamp))::integer,
    p.gender, p.bio, p.intents,
    pg_catalog.round(n.measured_meters)::integer
  from nearby n join public.profiles p on p.user_id = n.candidate_id
  order by n.measured_meters, p.user_id;
end;
$$;

create or replace function public.discover_nearby_users()
returns table (user_id uuid, first_name text, age integer, gender text,
               bio text, intents text[], distance_meters integer)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  return query select n.user_id, n.first_name, n.age, n.gender, n.bio,
    n.intents, n.distance_meters from private.discover_nearby_users_impl() n;
end;
$$;

create or replace function private.send_connection_request_impl(target_user_id uuid)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare caller_id uuid := auth.uid(); request_id uuid;
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if target_user_id is null or target_user_id = caller_id then
    raise exception using errcode = '22023', message = 'Invalid recipient.';
  end if;
  perform private.lock_interaction_pair(caller_id, target_user_id);
  if private.users_are_blocked(caller_id, target_user_id) or not exists (
    select 1 from private.discover_nearby_users_impl() n where n.user_id = target_user_id
  ) then
    raise exception using errcode = '42501', message = 'Recipient is not available.';
  end if;
  if exists (
    select 1 from public.connections c
    where c.user_low = least(caller_id, target_user_id)
      and c.user_high = greatest(caller_id, target_user_id)
      and c.ended_at is null
  ) then
    raise exception using errcode = '42501', message = 'An active connection already exists.';
  end if;
  insert into public.connection_requests(sender_id, recipient_id)
  values (caller_id, target_user_id)
  on conflict (sender_id, recipient_id) where status = 'pending'
  do nothing returning id into request_id;
  if request_id is null then
    select r.id into request_id from public.connection_requests r
    where r.sender_id = caller_id and r.recipient_id = target_user_id
      and r.status = 'pending';
  end if;
  if request_id is null then
    raise exception using errcode = '40001', message = 'Please retry the request.';
  end if;
  return request_id;
end;
$$;

create or replace function public.send_connection_request(target_user_id uuid)
returns uuid language sql volatile security invoker set search_path = ''
as $$ select private.send_connection_request_impl(target_user_id); $$;

create or replace function private.list_incoming_connection_requests_impl()
returns table (request_id uuid, first_name text, age integer, gender text, bio text, intents text[])
language plpgsql stable security definer set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  today date := (pg_catalog.statement_timestamp() at time zone 'UTC')::date;
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  return query
  select r.id, coalesce(p.first_name, 'Someone'),
    extract(year from pg_catalog.age(today::timestamp, p.date_of_birth::timestamp))::integer,
    p.gender, p.bio, coalesce(p.intents, '{}'::text[])
  from public.connection_requests r
  left join public.profiles p on p.user_id = r.sender_id
  where r.recipient_id = caller_id and r.status = 'pending'
    and not private.users_are_blocked(caller_id, r.sender_id)
  order by r.created_at desc, r.id;
end;
$$;

create or replace function public.list_incoming_connection_requests()
returns table (request_id uuid, first_name text, age integer, gender text, bio text, intents text[])
language sql stable security invoker set search_path = ''
as $$
  select n.request_id, n.first_name, n.age, n.gender, n.bio, n.intents
  from private.list_incoming_connection_requests_impl() n;
$$;

create or replace function private.respond_to_connection_request_impl(request_id uuid, response text)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare caller_id uuid := auth.uid(); sender uuid;
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if response is null or response not in ('accepted', 'declined') then
    raise exception using errcode = '22023', message = 'Invalid response.';
  end if;
  select r.sender_id into sender from public.connection_requests r
  where r.id = request_id and r.recipient_id = caller_id and r.status = 'pending';
  if not found then
    raise exception using errcode = '42501', message = 'Request is not available.';
  end if;
  -- Pair lock precedes the row lock to avoid block/accept deadlocks.
  perform private.lock_interaction_pair(caller_id, sender);
  if private.users_are_blocked(caller_id, sender) then
    raise exception using errcode = '42501', message = 'Request is not available.';
  end if;
  update public.connection_requests r set status = response
  where r.id = request_id and r.recipient_id = caller_id and r.status = 'pending';
  if not found then
    raise exception using errcode = '42501', message = 'Request is not available.';
  end if;
  if response = 'accepted' then
    -- No active row means a NEW UUID. Opposite-direction acceptances share
    -- the active row, never an ended row.
    insert into public.connections(user_low, user_high)
    select least(sender, caller_id), greatest(sender, caller_id)
    where not exists (
      select 1 from public.connections c
      where c.user_low = least(sender, caller_id)
        and c.user_high = greatest(sender, caller_id)
        and c.ended_at is null
    )
    on conflict (user_low, user_high) where ended_at is null do nothing;
  end if;
  return response;
end;
$$;

create or replace function public.respond_to_connection_request(request_id uuid, response text)
returns text language sql volatile security invoker set search_path = ''
as $$ select private.respond_to_connection_request_impl(request_id, response); $$;

create or replace function private.list_connections_impl()
returns table (connection_id uuid, first_name text, age integer, gender text,
               bio text, intents text[], connected_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  today date := (pg_catalog.statement_timestamp() at time zone 'UTC')::date;
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  return query
  select c.id, coalesce(p.first_name, 'Someone'),
    extract(year from pg_catalog.age(today::timestamp, p.date_of_birth::timestamp))::integer,
    p.gender, p.bio, coalesce(p.intents, '{}'::text[]), c.created_at
  from public.connections c
  left join public.profiles p on p.user_id =
    case when c.user_low = caller_id then c.user_high else c.user_low end
  where caller_id in (c.user_low, c.user_high)
    and c.ended_at is null
    and not private.users_are_blocked(c.user_low, c.user_high)
  order by c.created_at desc, c.id;
end;
$$;

create or replace function public.list_connections()
returns table (connection_id uuid, first_name text, age integer, gender text,
               bio text, intents text[], connected_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select c.connection_id, c.first_name, c.age, c.gender, c.bio, c.intents, c.connected_at
  from private.list_connections_impl() c;
$$;

create or replace function private.prepare_message()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.body := pg_catalog.regexp_replace(new.body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if new.body is null or new.body !~ '[^[:space:]]'
     or pg_catalog.char_length(new.body) > 2000 then
    raise exception using errcode = '22023', message = 'Message body is invalid.';
  end if;
  if new.sender_id is distinct from auth.uid()
     or auth.role() is distinct from 'authenticated'
     or not exists (
       select 1 from public.connections c
       where c.id = new.connection_id and c.ended_at is null
         and new.sender_id in (c.user_low, c.user_high)
         and not private.users_are_blocked(c.user_low, c.user_high)
     ) then
    raise exception using errcode = '42501', message = 'Connection is not available.';
  end if;
  new.created_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create or replace function private.send_message_impl(p_connection_id uuid, p_body text)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  other_id uuid;
  normalized_body text;
  new_message_id uuid;
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  select case when c.user_low = caller_id then c.user_high else c.user_low end
  into other_id from public.connections c
  where c.id = p_connection_id and caller_id in (c.user_low, c.user_high)
    and c.ended_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'Connection is not available.';
  end if;
  perform private.lock_interaction_pair(caller_id, other_id);
  -- Recheck the exact row after waiting, including block-then-unblock races.
  if private.users_are_blocked(caller_id, other_id) or not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and c.ended_at is null
      and caller_id in (c.user_low, c.user_high)
  ) then
    raise exception using errcode = '42501', message = 'Connection is not available.';
  end if;
  normalized_body := pg_catalog.regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if normalized_body is null or normalized_body !~ '[^[:space:]]'
     or pg_catalog.char_length(normalized_body) > 2000 then
    raise exception using errcode = '22023', message = 'Message body is invalid.';
  end if;
  -- Existing prepare_message trigger validates sender membership and sets time.
  insert into public.messages(connection_id, sender_id, body)
  values (p_connection_id, caller_id, normalized_body)
  returning id into new_message_id;
  return new_message_id;
end;
$$;

create or replace function public.send_message(connection_id uuid, body text)
returns uuid language sql volatile security invoker set search_path = ''
as $$ select private.send_message_impl(connection_id, body); $$;

create or replace function private.list_messages_impl(
  p_connection_id uuid, p_before_created_at timestamptz,
  p_before_message_id uuid, p_limit_count integer
)
returns table (message_id uuid, sender_is_me boolean, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare caller_id uuid := auth.uid();
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and caller_id in (c.user_low, c.user_high)
      and c.ended_at is null
    and not private.users_are_blocked(c.user_low, c.user_high)
  ) then
    raise exception using errcode = '42501', message = 'Connection is not available.';
  end if;
  if p_limit_count is null or p_limit_count < 1 or p_limit_count > 100 then
    raise exception using errcode = '22023', message = 'Page size must be between 1 and 100.';
  end if;
  if (p_before_created_at is null) <> (p_before_message_id is null) then
    raise exception using errcode = '22023', message = 'The message cursor is invalid.';
  end if;
  return query
  select m.id, m.sender_id = caller_id, m.body, m.created_at
  from public.messages m
  where m.connection_id = p_connection_id
    and (p_before_created_at is null
      or (m.created_at, m.id) < (p_before_created_at, p_before_message_id))
  order by m.created_at desc, m.id desc limit p_limit_count;
end;
$$;

create or replace function public.list_messages(
  connection_id uuid, before_created_at timestamptz default null,
  before_message_id uuid default null, limit_count integer default 50
)
returns table (message_id uuid, sender_is_me boolean, body text, created_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select m.message_id, m.sender_is_me, m.body, m.created_at
  from private.list_messages_impl(connection_id, before_created_at, before_message_id, limit_count) m;
$$;

create or replace function private.can_join_connection_channel(channel_topic text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare caller_id uuid := auth.uid();
begin
  if caller_id is null or auth.role() is distinct from 'authenticated'
     or channel_topic is null then return false; end if;
  return exists (
    select 1 from public.connections c
    where channel_topic = 'connection:' || c.id::text
      and caller_id in (c.user_low, c.user_high)
      and c.ended_at is null
    and not private.users_are_blocked(c.user_low, c.user_high)
  );
end;
$$;

-- Close existing direct participant SELECT paths as well as RPC paths.
-- Original participant policies remain; these restrictions combine using AND.
create policy connections_block_guard
on public.connections as restrictive for select to authenticated
using (ended_at is null and not private.users_are_blocked(user_low, user_high));

create policy connection_requests_block_guard
on public.connection_requests as restrictive for select to authenticated
using (
  not private.users_are_blocked(sender_id, recipient_id)
  and (
    status <> 'accepted' or exists (
      select 1 from public.connections c
      where c.user_low = least(sender_id, recipient_id)
        and c.user_high = greatest(sender_id, recipient_id)
        and c.ended_at is null
    )
  )
);
-- Old accepted requests cannot disable fresh requests in outgoing reconciliation
-- when no active relationship exists. Their historical rows are retained.

-- Existing photo helpers reuse discover_nearby_users_impl, so new photo signing
-- for blocked pairs is denied without changing Storage policies or owner access.
-- Already-issued signed URLs cannot be revoked by these checks.

-- Reassert ownership/ACLs on this exact allowlist, including unchanged wrappers.
-- No global/default privilege changes and no EXECUTE grant for the lock helper.
do $$
declare signature text;
begin
  foreach signature in array array[
    'private.users_are_blocked(uuid,uuid)',
    'private.preserve_connection_lifecycle()', 'private.prepare_message()',
    'private.lock_interaction_pair(uuid,uuid)',
    'private.block_user_impl(uuid)', 'public.block_user(uuid)',
    'private.unblock_user_impl(uuid)', 'public.unblock_user(uuid)',
    'private.report_user_impl(uuid,text,text)', 'public.report_user(uuid,text,text)',
    'private.discover_nearby_users_impl()', 'public.discover_nearby_users()',
    'private.send_connection_request_impl(uuid)', 'public.send_connection_request(uuid)',
    'private.list_incoming_connection_requests_impl()', 'public.list_incoming_connection_requests()',
    'private.respond_to_connection_request_impl(uuid,text)', 'public.respond_to_connection_request(uuid,text)',
    'private.list_connections_impl()', 'public.list_connections()',
    'private.send_message_impl(uuid,text)', 'public.send_message(uuid,text)',
    'private.list_messages_impl(uuid,timestamptz,uuid,integer)',
    'public.list_messages(uuid,timestamptz,uuid,integer)',
    'private.can_join_connection_channel(text)'
  ] loop
    execute 'alter function ' || signature || ' owner to postgres';
    execute 'revoke all on function ' || signature ||
      ' from public, anon, authenticated, service_role';
    if signature not in ('private.lock_interaction_pair(uuid,uuid)',
      'private.preserve_connection_lifecycle()', 'private.prepare_message()') then
      execute 'grant execute on function ' || signature || ' to authenticated';
    end if;
  end loop;
end;
$$;
revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

comment on table public.user_blocks is
  'RPC-only directional blocks enforced bilaterally. No public block list. Unblock removes only caller-created blocks; ended connections never resume.';
comment on table public.user_reports is
  'RPC-only confidential reports. No client read access or report IDs returned. Reporting does not block. Trusted moderation access is outside the app.';
comment on table public.connections is
  'Only ended_at NULL connections are active. Blocks permanently end relationships without deleting messages. Unblocking never reopens a connection. New acceptance creates a new connection ID.';

notify pgrst, 'reload schema';
commit;
