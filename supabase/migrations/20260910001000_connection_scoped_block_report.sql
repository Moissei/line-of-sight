begin;

-- REVIEW ONLY. Requires the migrated 009 connection lifecycle/block/report design.
-- Additive RPCs only. No existing tables, policies, or RPCs are changed.
-- Keep private outside the Data API exposed schemas.

create function private.block_connection_impl(p_connection_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  other_id uuid;
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select case when c.user_low = caller_id then c.user_high else c.user_low end
  into other_id
  from public.connections c
  where c.id = p_connection_id
    and c.ended_at is null
    and caller_id in (c.user_low, c.user_high);

  -- Same error for null/missing IDs, nonparticipants, and ended connections.
  if other_id is null or other_id = caller_id then
    raise exception using errcode = '42501', message = 'Connection is not available.';
  end if;

  -- Acquire the shared pair lock BEFORE rechecking the exact connection.
  -- The helper enforces READ COMMITTED, so this next statement sees commits
  -- made while we waited. Do not substitute a newer connection for the old ID.
  perform private.lock_interaction_pair(caller_id, other_id);

  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and c.ended_at is null
      and c.user_low = least(caller_id, other_id)
      and c.user_high = greatest(caller_id, other_id)
  ) then
    raise exception using errcode = '42501', message = 'Connection is not available.';
  end if;

  -- Reentrant acquisition of the same transaction lock is safe.
  -- Existing implementation derives auth.uid(), inserts the directional block,
  -- declines pending requests, and ends the active connection atomically.
  -- No historical messages are deleted or reassigned.
  perform private.block_user_impl(other_id);
end;
$$;

create function public.block_connection(connection_id uuid)
returns void
language sql volatile security invoker
set search_path = ''
as $$
  select private.block_connection_impl(connection_id);
$$;

create function private.report_connection_impl(
  p_connection_id uuid,
  p_reason text,
  p_details text
)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  other_id uuid;
begin
  if caller_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  -- Deliberately includes ended connections and blocked pairs. Immutable
  -- participant columns prove membership without exposing historical data.
  select case when c.user_low = caller_id then c.user_high else c.user_low end
  into other_id
  from public.connections c
  where c.id = p_connection_id
    and caller_id in (c.user_low, c.user_high);

  if other_id is null or other_id = caller_id then
    raise exception using errcode = '42501', message = 'Connection is not available.';
  end if;

  -- Reuse the exact controlled reasons and <=1000-character validation:
  -- Harassment, Spam, Fake profile, Inappropriate content, Safety concern, Other.
  -- The existing implementation trims details, derives reporter from auth.uid(),
  -- uses server time, and returns no report ID. Reporting does not block.
  -- No pair lock is needed: ending/blocking does not invalidate reporting rights.
  perform private.report_user_impl(other_id, p_reason, p_details);
end;
$$;

create function public.report_connection(
  connection_id uuid,
  reason text,
  details text default null
)
returns void
language sql volatile security invoker
set search_path = ''
as $$
  select private.report_connection_impl(connection_id, reason, details);
$$;

alter function private.block_connection_impl(uuid) owner to postgres;
alter function public.block_connection(uuid) owner to postgres;
alter function private.report_connection_impl(uuid, text, text) owner to postgres;
alter function public.report_connection(uuid, text, text) owner to postgres;

revoke all on function private.block_connection_impl(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.block_connection(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.report_connection_impl(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.report_connection(uuid, text, text)
  from public, anon, authenticated, service_role;

-- Invoker wrappers require caller EXECUTE on the private implementations.
-- Both private implementations independently authorize every call.
grant usage on schema private to authenticated;
grant execute on function private.block_connection_impl(uuid) to authenticated;
grant execute on function public.block_connection(uuid) to authenticated;
grant execute on function private.report_connection_impl(uuid, text, text) to authenticated;
grant execute on function public.report_connection(uuid, text, text) to authenticated;

comment on function public.block_connection(uuid) is
  'Participant-only active-connection block. Resolves target server-side and rechecks lifecycle under the shared pair lock. Returns no identifiers.';
comment on function public.report_connection(uuid, text, text) is
  'Participant-only report for an active or ended connection. Resolves target server-side; restores no chat access and returns no identifiers.';

-- No changes to messages, connections, list_connections, RLS, or Realtime.
-- Existing Realtime authorization-cache and signed-URL expiry limits still apply.
notify pgrst, 'reload schema';
commit;
