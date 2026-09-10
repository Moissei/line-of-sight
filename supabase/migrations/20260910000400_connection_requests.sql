-- Review and run once as postgres. Requires nearby safe-profile discovery.
-- No existing profile, presence, photo, or discovery objects are changed.
begin;

create table public.connection_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_requests_not_self check (sender_id <> recipient_id),
  constraint connection_requests_status check (status in ('pending', 'accepted', 'declined'))
);

-- Directional requests. An accepted request also blocks another active request.
create unique index connection_requests_one_active_pair
on public.connection_requests (sender_id, recipient_id)
where status in ('pending', 'accepted');
create index connection_requests_recipient on public.connection_requests (recipient_id);

create function private.prepare_connection_request()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_at := new.updated_at;
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
alter function private.prepare_connection_request() owner to postgres;
revoke all on function private.prepare_connection_request()
  from public, anon, authenticated, service_role;
create trigger prepare_connection_request
before insert or update on public.connection_requests
for each row execute function private.prepare_connection_request();

alter table public.connection_requests enable row level security;
revoke all on table public.connection_requests from public, anon, authenticated;
grant select on table public.connection_requests to authenticated;
create policy connection_requests_read_participant
on public.connection_requests for select to authenticated
using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);
-- No direct INSERT, UPDATE, DELETE grants or policies. Status transitions are
-- deliberately unavailable to clients until a reviewed recipient-action RPC.

create function private.send_connection_request_impl(target_user_id uuid)
returns uuid language plpgsql volatile security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  request_id uuid;
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if target_user_id is null or target_user_id = caller_id then
    raise exception using errcode = '22023', message = 'Invalid recipient.';
  end if;
  -- Server authority: reuse active/fresh/unexpired/20-meter PostGIS discovery.
  -- No photo requirement, profile preference filtering, or client coordinates.
  if not exists (
    select 1 from private.discover_nearby_users_impl() n
    where n.user_id = target_user_id
  ) then
    raise exception using errcode = '42501', message = 'Recipient is not currently nearby.';
  end if;

  insert into public.connection_requests (sender_id, recipient_id)
  values (caller_id, target_user_id)
  on conflict (sender_id, recipient_id) where status in ('pending', 'accepted')
  do nothing
  returning id into request_id;

  if request_id is null then
    -- Separate statement sees a concurrent winner at READ COMMITTED.
    select r.id into request_id from public.connection_requests r
    where r.sender_id = caller_id and r.recipient_id = target_user_id
      and r.status in ('pending', 'accepted');
  end if;
  if request_id is null then
    raise exception using errcode = '40001', message = 'Please retry the request.';
  end if;
  return request_id;
end;
$$;
alter function private.send_connection_request_impl(uuid) owner to postgres;
revoke all on function private.send_connection_request_impl(uuid)
  from public, anon, authenticated, service_role;

create function public.send_connection_request(target_user_id uuid)
returns uuid language sql volatile security invoker
set search_path = ''
as $$
  select private.send_connection_request_impl(target_user_id);
$$;
alter function public.send_connection_request(uuid) owner to postgres;
revoke all on function public.send_connection_request(uuid)
  from public, anon, authenticated, service_role;
revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.send_connection_request_impl(uuid) to authenticated;
grant execute on function public.send_connection_request(uuid) to authenticated;

comment on table public.connection_requests is
  'Participant-only connection requests. RPC-only creation after server nearby eligibility. No automatic acceptance, chat, or location storage.';
comment on function private.send_connection_request_impl(uuid) is
  'Derives sender from auth.uid(), rejects self and non-nearby targets, inserts pending only, and returns the existing active request on duplicate sends.';
notify pgrst, 'reload schema';
commit;
