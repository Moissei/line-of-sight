-- REVIEW ONLY. Run manually as postgres after the messaging migration.
-- Also disable "Allow public access" in Supabase Realtime Settings.
-- Keep private outside the Data API exposed schemas.
begin;

-- Supabase supports managing policies on realtime.messages. Do not create or
-- alter managed Realtime tables/functions, change grants, or write its rows.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'realtime' and c.relname = 'messages'
      and c.relrowsecurity
  ) then
    raise exception 'Realtime messages RLS must be enabled.';
  end if;
end;
$$;

create function private.can_join_connection_channel(channel_topic text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null or auth.role() is distinct from 'authenticated'
     or channel_topic is null then
    return false;
  end if;
  -- Compare with a server-generated canonical topic. No untrusted UUID casts.
  return exists (
    select 1 from public.connections c
    where channel_topic = 'connection:' || c.id::text
      and caller_id in (c.user_low, c.user_high)
  );
end;
$$;

alter function private.can_join_connection_channel(text) owner to postgres;
revoke all on function private.can_join_connection_channel(text)
  from public, anon, authenticated, service_role;
revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_join_connection_channel(text) to authenticated;

-- Restrictive guards protect this namespace even if another permissive policy
-- is added later. Other channel namespaces retain their existing behavior.
create policy connection_broadcast_receive_guard
on realtime.messages as restrictive for select to public
using (
  case when (select realtime.topic()) like 'connection:%' then
    case when (select auth.role()) = 'authenticated' then
      extension = 'broadcast'
      and private.can_join_connection_channel((select realtime.topic()))
    else false end
  else true end
);

create policy connection_broadcast_send_guard
on realtime.messages as restrictive for insert to public
with check (
  case when (select realtime.topic()) like 'connection:%' then
    case when (select auth.role()) = 'authenticated' then
      extension = 'broadcast'
      and private.can_join_connection_channel((select realtime.topic()))
    else false end
  else true end
);

create policy connection_broadcast_receive
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and private.can_join_connection_channel((select realtime.topic()))
);

create policy connection_broadcast_send
on realtime.messages for insert to authenticated
with check (
  extension = 'broadcast'
  and private.can_join_connection_channel((select realtime.topic()))
);

comment on function private.can_join_connection_channel(text) is
  'Participant-only private connection Broadcast authorization. Canonical connection:<uuid> topics only. No message content or participant IDs returned.';

-- Authorization is evaluated by Realtime when joining/refreshing credentials.
-- Broadcast is non-authoritative; every message read/write still uses RPCs.
-- No public.messages privileges, RPCs, publications, or connection RLS changed.
commit;
