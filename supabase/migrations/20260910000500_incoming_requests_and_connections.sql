-- Review and run once as postgres after connection_requests. Do not run via app.
begin;

create table public.connections (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint connections_ordered_pair check (user_low < user_high),
  constraint connections_unique_pair unique (user_low, user_high)
);
alter table public.connections enable row level security;
revoke all on public.connections from public, anon, authenticated;
grant select on public.connections to authenticated;
create policy connections_read_participant on public.connections
for select to authenticated
using ((select auth.uid()) = user_low or (select auth.uid()) = user_high);

-- Preserve any pre-existing accepted requests, including opposite directions.
insert into public.connections (user_low, user_high, created_at)
select least(r.sender_id, r.recipient_id), greatest(r.sender_id, r.recipient_id),
  min(r.updated_at)
from public.connection_requests r where r.status = 'accepted'
group by least(r.sender_id, r.recipient_id), greatest(r.sender_id, r.recipient_id)
on conflict (user_low, user_high) do nothing;

create function private.respond_to_connection_request_impl(request_id uuid, response text)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  sender uuid;
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if response is null or response not in ('accepted', 'declined') then
    raise exception using errcode = '22023', message = 'Invalid response.';
  end if;
  -- Atomic conditional UPDATE locks the row. Concurrent/repeated responses
  -- cannot transition a terminal status, even if they request the same value.
  update public.connection_requests r
  set status = response
  where r.id = request_id and r.recipient_id = caller_id and r.status = 'pending'
  returning r.sender_id into sender;
  if not found then
    raise exception using errcode = '42501', message = 'Request is not available.';
  end if;
  -- Existing trigger sets updated_at using server time.
  if response = 'accepted' then
    insert into public.connections (user_low, user_high)
    values (least(sender, caller_id), greatest(sender, caller_id))
    on conflict (user_low, user_high) do nothing;
  end if;
  -- Both writes share the RPC transaction: neither can commit alone.
  return response;
end;
$$;

create function public.respond_to_connection_request(request_id uuid, response text)
returns text language sql volatile security invoker set search_path = ''
as $$ select private.respond_to_connection_request_impl(request_id, response); $$;

create function private.list_incoming_connection_requests_impl()
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
  order by r.created_at desc, r.id;
end;
$$;

create function public.list_incoming_connection_requests()
returns table (request_id uuid, first_name text, age integer, gender text, bio text, intents text[])
language sql stable security invoker set search_path = ''
as $$ select * from private.list_incoming_connection_requests_impl(); $$;

alter function private.respond_to_connection_request_impl(uuid, text) owner to postgres;
alter function public.respond_to_connection_request(uuid, text) owner to postgres;
alter function private.list_incoming_connection_requests_impl() owner to postgres;
alter function public.list_incoming_connection_requests() owner to postgres;
revoke all on function private.respond_to_connection_request_impl(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.respond_to_connection_request(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.list_incoming_connection_requests_impl() from public, anon, authenticated, service_role;
revoke all on function public.list_incoming_connection_requests() from public, anon, authenticated, service_role;
revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.respond_to_connection_request_impl(uuid, text) to authenticated;
grant execute on function public.respond_to_connection_request(uuid, text) to authenticated;
grant execute on function private.list_incoming_connection_requests_impl() to authenticated;
grant execute on function public.list_incoming_connection_requests() to authenticated;

comment on table public.connections is
  'One stable connection per unordered user pair for future chat. Created atomically on explicit acceptance. Participant reads only; no client writes. No messaging implemented.';
comment on function private.list_incoming_connection_requests_impl() is
  'Pending incoming requests only, with current safe sender profile fields. No exact birth date, location, email or photo URL. No proximity requirement for responding to an existing request.';
-- Existing request/profile RLS, send RPC, discovery and Storage remain unchanged.
-- Incoming cards use neutral placeholders; no new historical photo permission.
notify pgrst, 'reload schema';
commit;
