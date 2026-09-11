-- Review and run once as postgres after the connections migration.
-- This migration creates RPC-only, immutable text messaging for accepted
-- connections. It does not enable Realtime or modify existing objects.
begin;

create table public.messages (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  connection_id uuid not null
    references public.connections (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint messages_body_valid check (
    pg_catalog.char_length(body) between 1 and 2000
    and body ~ '[^[:space:]]'
    and body = pg_catalog.regexp_replace(
      body, '^[[:space:]]+|[[:space:]]+$', '', 'g'
    )
  )
);

-- Supports newest-page keyset pagination and chronological rendering after the
-- client reverses each returned page. The UUID is a stable tie-breaker when two
-- messages have the same server timestamp.
create index messages_connection_chronology
on public.messages (connection_id, created_at desc, id desc);

-- Defense in depth: normalize and validate every insert, even if a future
-- trusted server path writes outside the current send_message RPC. Client code
-- cannot choose created_at, and sender must belong to the referenced connection.
create function private.prepare_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.body := pg_catalog.regexp_replace(
    new.body, '^[[:space:]]+|[[:space:]]+$', '', 'g'
  );

  if new.body is null
     or new.body !~ '[^[:space:]]'
     or pg_catalog.char_length(new.body) > 2000 then
    raise exception using
      errcode = '22023', message = 'Message body is invalid.';
  end if;

  if not exists (
    select 1
    from public.connections c
    where c.id = new.connection_id
      and new.sender_id in (c.user_low, c.user_high)
  ) then
    raise exception using
      errcode = '42501', message = 'Connection is not available.';
  end if;

  new.created_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

alter function private.prepare_message() owner to postgres;
revoke all on function private.prepare_message()
  from public, anon, authenticated, service_role;

create trigger prepare_message
before insert on public.messages
for each row execute function private.prepare_message();

alter table public.messages enable row level security;
revoke all on table public.messages from public, anon, authenticated;

-- Intentionally no direct table policies or grants. The exposed Data API table
-- cannot be selected from, inserted into, updated, or deleted by app roles.
-- Narrow RPCs below perform all participant authorization.

create function private.send_message_impl(
  p_connection_id uuid,
  p_body text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  normalized_body text;
  new_message_id uuid;
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using
      errcode = '42501', message = 'Authentication required.';
  end if;

  normalized_body := pg_catalog.regexp_replace(
    p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'
  );

  if normalized_body is null
     or normalized_body !~ '[^[:space:]]'
     or pg_catalog.char_length(normalized_body) > 2000 then
    raise exception using
      errcode = '22023', message = 'Message body is invalid.';
  end if;

  -- Use one generic failure for a missing connection and a connection belonging
  -- to other users so callers cannot probe connection identifiers.
  if not exists (
    select 1
    from public.connections c
    where c.id = p_connection_id
      and caller_id in (c.user_low, c.user_high)
  ) then
    raise exception using
      errcode = '42501', message = 'Connection is not available.';
  end if;

  insert into public.messages (connection_id, sender_id, body)
  values (p_connection_id, caller_id, normalized_body)
  returning id into new_message_id;

  return new_message_id;
end;
$$;

create function public.send_message(connection_id uuid, body text)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.send_message_impl(connection_id, body);
$$;

create function private.list_messages_impl(
  p_connection_id uuid,
  p_before_created_at timestamptz,
  p_before_message_id uuid,
  p_limit_count integer
)
returns table (
  message_id uuid,
  sender_is_me boolean,
  body text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using
      errcode = '42501', message = 'Authentication required.';
  end if;

  if p_limit_count is null or p_limit_count < 1 or p_limit_count > 100 then
    raise exception using
      errcode = '22023', message = 'Page size must be between 1 and 100.';
  end if;

  -- A complete two-part cursor is required. Timestamp-only pagination could
  -- skip messages that share the same created_at value.
  if (p_before_created_at is null) <> (p_before_message_id is null) then
    raise exception using
      errcode = '22023', message = 'The message cursor is invalid.';
  end if;

  if not exists (
    select 1
    from public.connections c
    where c.id = p_connection_id
      and caller_id in (c.user_low, c.user_high)
  ) then
    raise exception using
      errcode = '42501', message = 'Connection is not available.';
  end if;

  return query
  select
    m.id,
    m.sender_id = caller_id,
    m.body,
    m.created_at
  from public.messages m
  where m.connection_id = p_connection_id
    and (
      p_before_created_at is null
      or (m.created_at, m.id) <
         (p_before_created_at, p_before_message_id)
    )
  order by m.created_at desc, m.id desc
  limit p_limit_count;
end;
$$;

-- Both cursor values are nullable together. For the first/newest page, omit
-- both. For the next page, pass created_at and message_id from the last row of
-- the prior descending page.
create function public.list_messages(
  connection_id uuid,
  before_created_at timestamptz default null,
  before_message_id uuid default null,
  limit_count integer default 50
)
returns table (
  message_id uuid,
  sender_is_me boolean,
  body text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.message_id,
    m.sender_is_me,
    m.body,
    m.created_at
  from private.list_messages_impl(
    connection_id,
    before_created_at,
    before_message_id,
    limit_count
  ) m;
$$;

alter function private.send_message_impl(uuid, text) owner to postgres;
alter function public.send_message(uuid, text) owner to postgres;
alter function private.list_messages_impl(
  uuid, timestamptz, uuid, integer
) owner to postgres;
alter function public.list_messages(
  uuid, timestamptz, uuid, integer
) owner to postgres;

revoke all on function private.send_message_impl(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.send_message(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.list_messages_impl(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function public.list_messages(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.send_message_impl(uuid, text)
  to authenticated;
grant execute on function public.send_message(uuid, text)
  to authenticated;
grant execute on function private.list_messages_impl(
  uuid, timestamptz, uuid, integer
) to authenticated;
grant execute on function public.list_messages(
  uuid, timestamptz, uuid, integer
) to authenticated;

comment on table public.messages is
  'Immutable text messages for accepted connections. App access is RPC-only; no direct client table privileges, edits, deletes, attachments, reactions, read receipts, or typing state.';
comment on function private.send_message_impl(uuid, text) is
  'Authenticated participant-only message insertion. Derives sender from auth.uid(), normalizes and validates text, and returns only the new message ID.';
comment on function private.list_messages_impl(
  uuid, timestamptz, uuid, integer
) is
  'Authenticated participant-only newest-page message listing. Uses a created_at plus message_id keyset cursor and returns no participant UUIDs.';
comment on function public.list_messages(
  uuid, timestamptz, uuid, integer
) is
  'Safe message-list wrapper. Results are newest first; reverse each page for chronological display.';

-- Realtime is deliberately not enabled here. RPC-only reads keep the messages
-- table unavailable through direct Data API SELECT. A later reviewed migration
-- can add private Broadcast channels and Realtime Authorization without changing
-- the durable message or RPC contract.
notify pgrst, 'reload schema';
commit;
