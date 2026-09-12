-- REVIEW ONLY: no HTTP, webhook, extension, or deployment is performed here.
-- Requires account_deletion_lifecycle. Run once as postgres after review.
begin;

create table private.push_devices (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique check (token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' and pg_catalog.length(token) <= 256),
  enabled boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index push_devices_user on private.push_devices(user_id);

create table private.push_outbox (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('connection_request','connection_accepted','new_message')),
  source_id uuid not null,
  connection_id uuid references public.connections(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null default (pg_catalog.clock_timestamp() + interval '24 hours'),
  initialized boolean not null default false,
  unique(kind, source_id, recipient_id),
  check(actor_id <> recipient_id),
  check ((kind = 'connection_request' and connection_id is null) or
         (kind <> 'connection_request' and connection_id is not null))
);

create table private.push_deliveries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  event_id uuid not null references private.push_outbox(id) on delete cascade,
  device_id uuid not null references private.push_devices(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','sending','ticket','done','failed')),
  attempts integer not null default 0,
  lease_id uuid,
  available_at timestamptz not null default pg_catalog.clock_timestamp(),
  ticket_id text,
  unique(event_id, device_id)
);
create index push_deliveries_due on private.push_deliveries(status, available_at);
alter table private.push_devices enable row level security;
alter table private.push_outbox enable row level security;
alter table private.push_deliveries enable row level security;
revoke all on private.push_devices, private.push_outbox, private.push_deliveries from public, anon, authenticated, service_role;

create function private.register_push_device_impl(expo_token text, remove_device boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  perform private.lock_account_shared(caller);
  if not private.account_is_active(caller) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  if expo_token is null or pg_catalog.length(expo_token) > 256 or
     expo_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then
    raise exception 'Invalid device.' using errcode = '22023';
  end if;
  -- Serialize ownership changes on a shared physical device.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('los-push:' || expo_token, 0));
  if remove_device then
    delete from private.push_devices d where d.token = expo_token and d.user_id = caller;
  else
    -- Remove prior deliveries when the device changes accounts. Never carry
    -- another account's queued notifications onto the newly registered account.
    delete from private.push_devices d where d.token = expo_token and d.user_id <> caller;
    insert into private.push_devices(user_id, token) values(caller, expo_token)
    on conflict(token) do update set enabled = true, updated_at = pg_catalog.clock_timestamp();
  end if;
end;
$$;
create function public.register_push_device(expo_token text) returns void
language sql volatile security invoker set search_path = '' as $$
  select private.register_push_device_impl(expo_token, false);
$$;
create function public.unregister_push_device(expo_token text) returns void
language sql volatile security invoker set search_path = '' as $$
  select private.register_push_device_impl(expo_token, true);
$$;

-- Unlike users_are_blocked(), this server-only helper does not depend on a
-- caller JWT: a worker has service_role identity. No app EXECUTE privilege.
create function private.push_pair_allowed(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select a <> b and private.account_is_active(a) and private.account_is_active(b)
    and not exists(select 1 from public.user_blocks x
      where (x.blocker_id = a and x.blocked_id = b) or (x.blocker_id = b and x.blocked_id = a));
$$;

create function private.enqueue_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid; recipient uuid; event_kind text; cid uuid;
begin
  if tg_table_name = 'connection_requests' then
    if new.status <> 'pending' then return new; end if;
    actor := new.sender_id; recipient := new.recipient_id; event_kind := 'connection_request';
  elsif tg_table_name = 'connections' then
    if new.ended_at is not null then return new; end if;
    actor := auth.uid();
    if actor is null or actor not in (new.user_low, new.user_high) then return new; end if;
    recipient := case when actor = new.user_low then new.user_high else new.user_low end;
    event_kind := 'connection_accepted'; cid := new.id;
  else
    actor := new.sender_id; cid := new.connection_id; event_kind := 'new_message';
    select case when c.user_low = actor then c.user_high else c.user_low end into recipient
    from public.connections c where c.id = cid and c.ended_at is null and actor in (c.user_low,c.user_high);
  end if;
  if recipient is null or not private.push_pair_allowed(actor,recipient) then return new; end if;
  insert into private.push_outbox(actor_id,recipient_id,kind,source_id,connection_id)
  values(actor,recipient,event_kind,new.id,cid) on conflict do nothing;
  return new;
end;
$$;
create trigger push_request after insert on public.connection_requests for each row execute function private.enqueue_push();
-- Acceptance creates a new active connection AFTER updating the request. Trigger
-- here so cross-direction acceptance of an existing connection does not duplicate.
create trigger push_accepted after insert on public.connections for each row execute function private.enqueue_push();
create trigger push_message after insert on public.messages for each row execute function private.enqueue_push();

create function private.push_event_allowed(e private.push_outbox) returns boolean
language sql stable security definer set search_path = '' as $$
  select e.expires_at > pg_catalog.clock_timestamp() and private.push_pair_allowed(e.actor_id,e.recipient_id)
  and case when e.kind = 'connection_request' then exists (
    select 1 from public.connection_requests r where r.id=e.source_id and r.status='pending'
      and r.sender_id=e.actor_id and r.recipient_id=e.recipient_id
  ) else exists (
    select 1 from public.connections c where c.id=e.connection_id and c.ended_at is null
      and e.actor_id in(c.user_low,c.user_high) and e.recipient_id in(c.user_low,c.user_high)
  ) end;
$$;

-- Supabase's standard INSERT webhook payload contains the inserted outbox
-- record, including internal actor/recipient references. send-push uses only
-- record.id to select work after validating the webhook envelope. Supplied
-- actor, recipient, connection, kind, and other record fields are not authority:
-- recipient/token/type/routing information comes from this service-role claim
-- RPC's database reads. Never log the webhook record or expose it to clients.
-- Null event ID is a separate trusted scheduled drain/retry call.
create function private.claim_push_batch_impl(p_event_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare e private.push_outbox; result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not available.' using errcode='42501'; end if;
  for e in select o.* from private.push_outbox o
    where not o.initialized and (p_event_id is null or o.id=p_event_id)
    order by o.created_at limit 100 for update skip locked
  loop
    if private.push_event_allowed(e) then
      insert into private.push_deliveries(event_id,device_id)
      select e.id,d.id from private.push_devices d where d.user_id=e.recipient_id and d.enabled on conflict do nothing;
    end if;
    update private.push_outbox o set initialized=true where o.id=e.id;
  end loop;
  with candidates as (
    select d.id from private.push_deliveries d
    join private.push_outbox o on o.id=d.event_id
    join private.push_devices p on p.id=d.device_id
    where (p_event_id is null or o.id=p_event_id) and d.status in('pending','sending')
      and d.available_at <= pg_catalog.clock_timestamp() and d.attempts < 5
      and p.enabled and p.user_id=o.recipient_id and private.push_event_allowed(o)
    order by d.available_at limit 100 for update of d skip locked
  ), claimed as (
    update private.push_deliveries d set status='sending', attempts=d.attempts+1,
      lease_id=pg_catalog.gen_random_uuid(), available_at=pg_catalog.clock_timestamp()+interval '2 minutes'
    from candidates c where d.id=c.id returning d.*
  ) select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'delivery_id',d.id,'lease_id',d.lease_id,'token',p.token,'kind',o.kind,
      'connection_id',case when o.kind='new_message' then o.connection_id else null end)), '[]'::jsonb)
    into result from claimed d join private.push_devices p on p.id=d.device_id
    join private.push_outbox o on o.id=d.event_id;
  return result;
end;
$$;

create function private.finish_push_delivery_impl(delivery_id uuid, claim_id uuid, outcome text, expo_ticket text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare d private.push_deliveries; device_token text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not available.' using errcode='42501'; end if;
  if outcome not in('ticket','invalid','retry','done','failed') or outcome is null then raise exception 'Invalid outcome.'; end if;
  -- Same token lock ordering as registration/ownership transfer, before row
  -- locks, so an invalid-device result cannot deadlock a cascading transfer.
  select p.token into device_token from private.push_deliveries x
    join private.push_devices p on p.id=x.device_id where x.id=delivery_id;
  if not found then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('los-push:' || device_token,0));
  select x.* into d from private.push_deliveries x where x.id=delivery_id and x.lease_id=claim_id for update;
  if not found then return; end if;
  if outcome='ticket' and (expo_ticket is null or pg_catalog.length(expo_ticket)>256) then raise exception 'Invalid ticket.'; end if;
  if outcome='invalid' then update private.push_devices p set enabled=false,updated_at=pg_catalog.clock_timestamp() where p.id=d.device_id; end if;
  update private.push_deliveries x set
    status=case outcome when 'invalid' then 'failed' when 'retry' then case when x.attempts>=5 then 'failed' else 'pending' end else outcome end,
    ticket_id=case when outcome='ticket' then expo_ticket else x.ticket_id end,
    lease_id=null,
    available_at=pg_catalog.clock_timestamp()+case when outcome='ticket' then interval '15 minutes' else interval '1 minute' * pg_catalog.power(2,d.attempts) end
  where x.id=d.id;
end;
$$;

create function private.claim_push_receipts_impl() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not available.' using errcode='42501'; end if;
  -- Receipts disappear from Expo after 24 hours. Do not retain unresolved
  -- receipt work indefinitely; a ticket is never proof of device delivery.
  update private.push_deliveries d set status='failed',lease_id=null
    from private.push_outbox o where o.id=d.event_id and d.status='ticket'
    and o.created_at < pg_catalog.clock_timestamp()-interval '24 hours';
  with candidates as (select d.id from private.push_deliveries d where d.status='ticket'
    and d.available_at<=pg_catalog.clock_timestamp() order by d.available_at limit 100 for update skip locked),
  claimed as (update private.push_deliveries d set lease_id=pg_catalog.gen_random_uuid(),
    available_at=pg_catalog.clock_timestamp()+interval '15 minutes' from candidates c where d.id=c.id returning d.*)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('delivery_id',id,'lease_id',lease_id,'ticket_id',ticket_id)), '[]'::jsonb)
    into result from claimed;
  return result;
end;
$$;

create function public.claim_push_batch(event_id uuid default null) returns jsonb
language sql volatile security invoker set search_path = '' as $$ select private.claim_push_batch_impl(event_id); $$;
create function public.finish_push_delivery(delivery_id uuid, claim_id uuid, outcome text, expo_ticket text default null) returns void
language sql volatile security invoker set search_path = '' as $$ select private.finish_push_delivery_impl(delivery_id,claim_id,outcome,expo_ticket); $$;
create function public.claim_push_receipts() returns jsonb
language sql volatile security invoker set search_path = '' as $$ select private.claim_push_receipts_impl(); $$;

-- Never expose private tables or tokens to ordinary clients, including via RPC.
do $$
declare signature text;
begin
  foreach signature in array array[
    'private.register_push_device_impl(text,boolean)', 'public.register_push_device(text)',
    'public.unregister_push_device(text)', 'private.push_pair_allowed(uuid,uuid)',
    'private.enqueue_push()', 'private.push_event_allowed(private.push_outbox)',
    'public.claim_push_batch(uuid)', 'public.finish_push_delivery(uuid,uuid,text,text)', 'public.claim_push_receipts()',
    'private.claim_push_batch_impl(uuid)', 'private.finish_push_delivery_impl(uuid,uuid,text,text)', 'private.claim_push_receipts_impl()'
  ] loop
    execute 'alter function ' || signature || ' owner to postgres';
    execute 'revoke all on function ' || signature || ' from public, anon, authenticated, service_role';
  end loop;
end;
$$;
grant usage on schema private to authenticated;
revoke create on schema private from public, anon, authenticated;
grant execute on function private.register_push_device_impl(text,boolean), public.register_push_device(text), public.unregister_push_device(text) to authenticated;
grant execute on function public.claim_push_batch(uuid), public.finish_push_delivery(uuid,uuid,text,text), public.claim_push_receipts() to service_role;
grant usage on schema private to service_role;
grant execute on function private.claim_push_batch_impl(uuid), private.finish_push_delivery_impl(uuid,uuid,text,text), private.claim_push_receipts_impl() to service_role;
comment on table private.push_outbox is 'Private generic push events; no profile text or message bodies. Auth deletion cascades. Delivery eligibility rechecked at claim. Review scheduled retention cleanup before production.';
notify pgrst, 'reload schema';
commit;
