begin;

-- REVIEW ONLY.
-- Requires migrations through 20260910001000.
-- Run eventually as postgres after staging/security/concurrency testing.
--
-- No Auth users or Storage objects are deleted by applying this migration.
-- No profile data is removed until the server-only deletion functions are called.
-- Keep private outside Data API exposed schemas.
--
-- Historical IDs remain internal pseudonymous linkage, not public identities.
-- Existing safe RPC output shapes remain unchanged.
-- A new archive-list RPC returns no participant UUIDs.

-- Prevent concurrent signups during participant backfill/trigger installation.
lock table auth.users in share row exclusive mode;

create table private.account_participants (
  participant_id uuid primary key,
  auth_user_id uuid unique
    references auth.users(id) on delete set null,

  state text not null default 'active',
  deletion_started_at timestamptz,
  storage_verified_at timestamptz,
  prepared_at timestamptz,
  deleted_at timestamptz,

  constraint account_participants_auth_identity check (
    auth_user_id is null or auth_user_id = participant_id
  ),
  constraint account_participants_state check (
    state in ('active', 'pending', 'prepared', 'deleted')
  ),
  constraint account_participants_phase check (
    (
      state = 'active'
      and auth_user_id is not null
      and deletion_started_at is null
      and storage_verified_at is null
      and prepared_at is null
      and deleted_at is null
    )
    or
    (
      state = 'pending'
      and auth_user_id is not null
      and deletion_started_at is not null
      and storage_verified_at is null
      and prepared_at is null
      and deleted_at is null
    )
    or
    (
      state = 'prepared'
      and auth_user_id is not null
      and deletion_started_at is not null
      and storage_verified_at is not null
      and prepared_at is not null
      and deleted_at is null
    )
    or
    (
      state = 'deleted'
      and auth_user_id is null
      and deletion_started_at is not null
      and storage_verified_at is not null
      and prepared_at is not null
      and deleted_at is not null
    )
  )
);

alter table private.account_participants enable row level security;
revoke all on private.account_participants
  from public, anon, authenticated, service_role;

insert into private.account_participants(participant_id, auth_user_id)
select u.id, u.id
from auth.users u;

comment on table private.account_participants is
  'Private immutable participant linkage and irreversible account-deletion phases. No profile fields, email, location or Auth metadata. Historical identifiers are pseudonymous, not anonymous.';


-- New accounts receive an active participant record.
create function private.create_account_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.account_participants(participant_id, auth_user_id)
  values (new.id, new.id);

  return new;
end;
$$;

create trigger los_create_account_participant
after insert on auth.users
for each row execute function private.create_account_participant();


-- Only legal forward phase transitions are allowed.
-- The Auth FK's SET NULL finalizes the tombstone.
-- Attempting Auth deletion before preparation aborts that deletion transaction.
create function private.preserve_account_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.participant_id is distinct from old.participant_id then
    raise exception using
      errcode = '23514', message = 'Participant identity is immutable.';
  end if;

  if new.auth_user_id is distinct from old.auth_user_id then
    if old.state <> 'prepared'
       or old.auth_user_id is null
       or new.auth_user_id is not null then
      raise exception using
        errcode = '23514', message = 'Account deletion is not prepared.';
    end if;

    new.state := 'deleted';
    new.deleted_at := pg_catalog.clock_timestamp();
  end if;

  if new.state is distinct from old.state
     and not (
       (old.state = 'active' and new.state = 'pending')
       or (old.state = 'pending' and new.state = 'prepared')
       or (old.state = 'prepared' and new.state = 'deleted')
     ) then
    raise exception using
      errcode = '23514', message = 'Invalid account lifecycle transition.';
  end if;

  if old.deletion_started_at is not null
     and new.deletion_started_at is distinct from old.deletion_started_at then
    raise exception using
      errcode = '23514', message = 'Deletion history is immutable.';
  end if;

  if old.storage_verified_at is not null
     and new.storage_verified_at is distinct from old.storage_verified_at then
    raise exception using
      errcode = '23514', message = 'Deletion history is immutable.';
  end if;

  if old.prepared_at is not null
     and new.prepared_at is distinct from old.prepared_at then
    raise exception using
      errcode = '23514', message = 'Deletion history is immutable.';
  end if;

  if old.deleted_at is not null
     and new.deleted_at is distinct from old.deleted_at then
    raise exception using
      errcode = '23514', message = 'Deletion history is immutable.';
  end if;

  return new;
end;
$$;

create trigger preserve_account_participant
before update on private.account_participants
for each row execute function private.preserve_account_participant();


-- Preserve existing historical participant values and connection/message IDs.
-- Constraint names are the names generated by the existing repo migrations.
alter table public.connections
  drop constraint connections_user_low_fkey restrict,
  drop constraint connections_user_high_fkey restrict,
  add constraint connections_user_low_fkey
    foreign key (user_low)
    references private.account_participants(participant_id) on delete restrict,
  add constraint connections_user_high_fkey
    foreign key (user_high)
    references private.account_participants(participant_id) on delete restrict,
  drop constraint connections_end_state restrict,
  add constraint connections_end_state check (
    (ended_at is null and ended_reason is null)
    or
    (
      ended_at is not null
      and pg_catalog.isfinite(ended_at)
      and ended_reason is not null
      and ended_reason in ('blocked', 'account_deleted')
    )
  );

-- Existing lifecycle trigger still forbids reopening or rewriting ended rows.
-- Existing partial unique index still permits only one ACTIVE pair.

alter table public.messages
  drop constraint messages_sender_id_fkey restrict,
  drop constraint messages_connection_id_fkey restrict,
  add constraint messages_sender_id_fkey
    foreign key (sender_id)
    references private.account_participants(participant_id) on delete restrict,
  add constraint messages_connection_id_fkey
    foreign key (connection_id)
    references public.connections(id) on delete restrict;

alter table public.user_reports
  drop constraint user_reports_reporter_id_fkey restrict,
  drop constraint user_reports_reported_user_id_fkey restrict,
  add constraint user_reports_reporter_id_fkey
    foreign key (reporter_id)
    references private.account_participants(participant_id) on delete restrict,
  add constraint user_reports_reported_user_id_fkey
    foreign key (reported_user_id)
    references private.account_participants(participant_id) on delete restrict;

-- No direct connection SELECT: historical internal participant identifiers
-- must not become visible if a future connection read policy is broadened.
-- App connections already use list_connections().
revoke all on public.connections from public, anon, authenticated;
revoke all on public.messages from public, anon, authenticated;
revoke all on public.user_reports from public, anon, authenticated;


-- Optional explicit moderation linkage to preserved messages.
-- No automatic bulk evidence collection and no client access.
-- Existing reports retain their reason/details/timestamp and participant links.
create table private.report_message_evidence (
  report_id uuid not null
    references public.user_reports(id) on delete restrict,
  message_id uuid not null
    references public.messages(id) on delete restrict,
  linked_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (report_id, message_id)
);

alter table private.report_message_evidence enable row level security;
revoke all on private.report_message_evidence
  from public, anon, authenticated, service_role;

comment on table private.report_message_evidence is
  'Confidential explicit moderation linkage to immutable preserved messages. Trusted moderation workflow only; no client grants or automatic collection.';


-- Internal state lookup. Not executable by app roles directly.
create function private.account_is_active(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.account_participants a
    where a.participant_id = p_id
      and a.auth_user_id = p_id
      and a.state = 'active'
  );
$$;

-- Narrow no-argument helper for owner RLS.
create function private.caller_account_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and auth.role() = 'authenticated'
    and private.account_is_active(auth.uid());
$$;

-- Account-level shared locks precede existing pair locks.
-- Deletion uses the same key with an exclusive lock.
create function private.lock_account_shared(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_id is null
     or pg_catalog.current_setting('transaction_isolation')
        <> 'read committed' then
    raise exception using
      errcode = '40001', message = 'Please retry the operation.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('los-account:' || p_id::text, 0)
  );
end;
$$;

-- VOLATILE: the state check after waiting must see the committed pending state.
create function private.caller_account_may_write()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or auth.role() is distinct from 'authenticated' then
    return false;
  end if;

  perform private.lock_account_shared(auth.uid());
  return private.account_is_active(auth.uid());
end;
$$;


-- Central interaction gate:
-- Existing discovery, incoming listing, active connection listing, message
-- authorization and Realtime helper already consult this function.
-- Inactive accounts are interaction-ineligible in both directions.
create or replace function private.users_are_blocked(user_a uuid, user_b uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null
     or auth.role() is distinct from 'authenticated'
     or user_a is null
     or user_b is null
     or caller_id not in (user_a, user_b)
     or not private.account_is_active(user_a)
     or not private.account_is_active(user_b) then
    return true;
  end if;

  return exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = user_a and b.blocked_id = user_b)
       or (b.blocker_id = user_b and b.blocked_id = user_a)
  );
end;
$$;

-- All existing pair mutations call this before mutating rows:
-- send request, accept/decline, block/unblock, send message, block_connection.
-- Acquire both account locks in UUID order before the original pair lock.
create or replace function private.lock_interaction_pair(user_a uuid, user_b uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or auth.role() is distinct from 'authenticated'
     or user_a is null
     or user_b is null
     or auth.uid() not in (user_a, user_b) then
    raise exception using
      errcode = '42501', message = 'Interaction is not available.';
  end if;

  perform private.lock_account_shared(least(user_a, user_b));
  perform private.lock_account_shared(greatest(user_a, user_b));

  if not private.account_is_active(user_a)
     or not private.account_is_active(user_b) then
    raise exception using
      errcode = '42501', message = 'Interaction is not available.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'los-interaction:' || least(user_a, user_b)::text || ':' ||
      greatest(user_a, user_b)::text,
      0
    )
  );
end;
$$;


-- Direct participant request reads previously used a connections subquery.
-- Move that check into a definer helper because connections direct SELECT
-- is now revoked. No identifiers are returned.
create function private.request_is_visible(
  p_sender uuid,
  p_recipient uuid,
  p_status text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or auth.role() is distinct from 'authenticated'
     or auth.uid() not in (p_sender, p_recipient)
     or private.users_are_blocked(p_sender, p_recipient) then
    return false;
  end if;

  return p_status <> 'accepted' or exists (
    select 1
    from public.connections c
    where c.user_low = least(p_sender, p_recipient)
      and c.user_high = greatest(p_sender, p_recipient)
      and c.ended_at is null
  );
end;
$$;

drop policy connection_requests_block_guard
  on public.connection_requests restrict;

create policy connection_requests_block_guard
on public.connection_requests as restrictive
for select to authenticated
using (
  private.request_is_visible(sender_id, recipient_id, status)
);


-- Defense for direct owner-controlled table operations.
-- Existing permissive owner policies/grants remain unchanged.
create policy profiles_account_active
on public.profiles as restrictive
for all to public
using (private.caller_account_is_active())
with check (private.caller_account_may_write());

create policy profile_photos_account_active
on public.profile_photos as restrictive
for all to public
using (private.caller_account_is_active())
with check (private.caller_account_may_write());

create policy discovery_account_active
on public.active_discovery_sessions as restrictive
for all to public
using (private.caller_account_is_active())
with check (private.caller_account_may_write());


-- Also serialize direct profile/photo/presence writes before row processing.
-- These are application-owned tables, not managed Storage tables.
create function private.guard_account_table_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' then
    if not private.caller_account_may_write() then
      raise exception using
        errcode = '42501', message = 'Account is not available.';
    end if;
  elsif auth.role() = 'anon' then
    raise exception using
      errcode = '42501', message = 'Account is not available.';
  end if;

  -- Trusted server cleanup runs as service_role/postgres.
  return null;
end;
$$;

create trigger account_write_guard
before insert or update or delete on public.profiles
for each statement execute function private.guard_account_table_write();

create trigger account_write_guard
before insert or update or delete on public.profile_photos
for each statement execute function private.guard_account_table_write();

create trigger account_write_guard
before insert or update or delete on public.active_discovery_sessions
for each statement execute function private.guard_account_table_write();


-- Additional Storage gates; existing owner/path/nearby guards remain intact.
-- No managed Storage rows, bytes, table structure or ownership are modified.
create function private.photo_accounts_are_active(
  p_name text,
  p_owner text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.caller_account_is_active()
     or p_name is null
     or p_owner is null then
    return false;
  end if;

  -- Match text against a canonical server identity, without untrusted casts.
  if not exists (
    select 1
    from private.account_participants a
    where a.participant_id::text = p_owner
      and a.state = 'active'
      and a.auth_user_id = a.participant_id
  ) then
    return false;
  end if;

  if p_owner = auth.uid()::text then
    return p_name in (
      p_owner || '/1', p_owner || '/2',
      p_owner || '/3', p_owner || '/profile'
    );
  end if;

  return private.can_read_nearby_primary_object(p_name, p_owner);
end;
$$;

create policy profile_photos_account_select
on storage.objects as restrictive
for select to public
using (
  bucket_id <> 'profile-photos'
  or private.photo_accounts_are_active(name, owner_id)
);

create policy profile_photos_account_insert
on storage.objects as restrictive
for insert to public
with check (
  bucket_id <> 'profile-photos'
  or private.caller_account_may_write()
);

create policy profile_photos_account_update
on storage.objects as restrictive
for update to public
using (
  bucket_id <> 'profile-photos'
  or private.caller_account_may_write()
)
with check (
  bucket_id <> 'profile-photos'
  or private.caller_account_may_write()
);

create policy profile_photos_account_delete
on storage.objects as restrictive
for delete to public
using (
  bucket_id <> 'profile-photos'
  or private.caller_account_may_write()
);


-- Reporting remains possible about a retained participant after deletion.
-- Caller must remain active. Target is never returned.
-- Existing report_connection resolves the participant internally and delegates
-- here; its participant authorization remains unchanged.
create or replace function private.report_user_impl(
  target_user_id uuid,
  reason text,
  details text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null
     or auth.role() is distinct from 'authenticated'
     or target_user_id is null
     or target_user_id = caller_id then
    raise exception using
      errcode = '42501', message = 'Report is not available.';
  end if;

  perform private.lock_account_shared(least(caller_id, target_user_id));
  perform private.lock_account_shared(greatest(caller_id, target_user_id));

  if not private.account_is_active(caller_id)
     or not exists (
       select 1
       from private.account_participants a
       where a.participant_id = target_user_id
     ) then
    raise exception using
      errcode = '42501', message = 'Report is not available.';
  end if;

  if reason is null
     or reason not in (
       'Harassment', 'Spam', 'Fake profile',
       'Inappropriate content', 'Safety concern', 'Other'
     )
     or pg_catalog.char_length(details) > 1000 then
    raise exception using
      errcode = '22023', message = 'Invalid report.';
  end if;

  insert into public.user_reports(
    reporter_id, reported_user_id, reason, details
  )
  values (
    caller_id,
    target_user_id,
    reason,
    nullif(
      pg_catalog.regexp_replace(
        details, '^[[:space:]]+|[[:space:]]+$', '', 'g'
      ),
      ''
    )
  );
end;
$$;


-- Read permission for a conversation:
-- 1. Existing active/unblocked conversation, OR
-- 2. A deletion-ended conversation for its still-active survivor.
--
-- Block-ended connections NEVER qualify as deletion archives.
-- No reopening, sending, or Realtime authorization is added here.
create function private.can_read_connection_history(p_connection_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  other_id uuid;
  end_reason text;
  end_time timestamptz;
begin
  if not private.caller_account_is_active() then
    return false;
  end if;

  select
    case when c.user_low = caller_id then c.user_high else c.user_low end,
    c.ended_reason,
    c.ended_at
  into other_id, end_reason, end_time
  from public.connections c
  where c.id = p_connection_id
    and caller_id in (c.user_low, c.user_high);

  if not found then return false; end if;

  if end_time is null then
    return not private.users_are_blocked(caller_id, other_id);
  end if;

  if end_reason <> 'account_deleted' then
    return false;
  end if;

  return exists (
    select 1
    from private.account_participants a
    where a.participant_id = other_id
      and a.state in ('pending', 'prepared', 'deleted')
  );
end;
$$;

create or replace function private.list_messages_impl(
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
begin
  if not private.can_read_connection_history(p_connection_id) then
    raise exception using
      errcode = '42501', message = 'Connection is not available.';
  end if;

  if p_limit_count is null
     or p_limit_count < 1
     or p_limit_count > 100 then
    raise exception using
      errcode = '22023', message = 'Page size must be between 1 and 100.';
  end if;

  if (p_before_created_at is null) <> (p_before_message_id is null) then
    raise exception using
      errcode = '22023', message = 'The message cursor is invalid.';
  end if;

  return query
  select m.id, m.sender_id = auth.uid(), m.body, m.created_at
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

-- Separate archive list, so active list_connections() behavior is unchanged.
-- No deleted profile lookup and no participant ID in the return type.
create function private.list_deleted_conversations_impl()
returns table (
  connection_id uuid,
  display_name text,
  connected_at timestamptz,
  ended_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.caller_account_is_active() then
    raise exception using
      errcode = '42501', message = 'Account is not available.';
  end if;

  return query
  select
    c.id,
    'Deleted User'::text,
    c.created_at,
    c.ended_at
  from public.connections c
  where auth.uid() in (c.user_low, c.user_high)
    and c.ended_reason = 'account_deleted'
    and c.ended_at is not null
    and private.can_read_connection_history(c.id)
  order by c.ended_at desc, c.id;
end;
$$;

create function public.list_deleted_conversations()
returns table (
  connection_id uuid,
  display_name text,
  connected_at timestamptz,
  ended_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.connection_id, c.display_name, c.connected_at, c.ended_at
  from private.list_deleted_conversations_impl() c;
$$;


-- SERVER-ONLY workflow.
-- The future Edge Function must verify the real caller before choosing p_user_id.
-- App roles receive no EXECUTE on these functions.
create function private.begin_account_deletion_impl(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_state text;
begin
  if auth.role() is distinct from 'service_role'
     or p_user_id is null then
    raise exception using
      errcode = '42501', message = 'Operation is not available.';
  end if;

  if pg_catalog.current_setting('transaction_isolation')
     <> 'read committed' then
    raise exception using
      errcode = '40001', message = 'Please retry the operation.';
  end if;

  -- Serialize deletion jobs with one another, not ordinary app traffic.
  -- This avoids two deletion jobs acquiring overlapping connection row locks
  -- while each holds its own account's exclusive lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('los-account-deletion-jobs', 0)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('los-account:' || p_user_id::text, 0)
  );

  select a.state into current_state
  from private.account_participants a
  where a.participant_id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = '42501', message = 'Account is not available.';
  end if;

  if current_state <> 'active' then
    return; -- Pending/prepared/deleted retries never reactivate anything.
  end if;

  update private.account_participants a
  set state = 'pending',
      deletion_started_at = pg_catalog.clock_timestamp()
  where a.participant_id = p_user_id;

  -- Stop visibility and remove coordinates using the existing STOP trigger.
  update public.active_discovery_sessions s
  set is_active = false
  where s.user_id = p_user_id;

  update public.connection_requests r
  set status = 'declined'
  where r.status = 'pending'
    and p_user_id in (r.sender_id, r.recipient_id);

  update public.connections c
  set ended_at = pg_catalog.clock_timestamp(),
      ended_reason = 'account_deleted'
  where p_user_id in (c.user_low, c.user_high)
    and c.ended_at is null;

  -- Previously ended rows, especially blocked rows, remain unchanged.
end;
$$;

create function public.begin_account_deletion(p_user_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.begin_account_deletion_impl(p_user_id);
$$;


-- Call ONLY AFTER server-side Storage API removal and verification.
-- SQL can verify absence of managed rows, not prove physical byte deletion.
create function private.prepare_account_auth_deletion_impl(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_state text;
begin
  if auth.role() is distinct from 'service_role'
     or p_user_id is null then
    raise exception using
      errcode = '42501', message = 'Operation is not available.';
  end if;

  if pg_catalog.current_setting('transaction_isolation')
     <> 'read committed' then
    raise exception using
      errcode = '40001', message = 'Please retry the operation.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('los-account-deletion-jobs', 0)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('los-account:' || p_user_id::text, 0)
  );

  select a.state into current_state
  from private.account_participants a
  where a.participant_id = p_user_id
  for update;

  if not found or current_state = 'active' then
    raise exception using
      errcode = '42501', message = 'Account deletion has not started.';
  end if;

  if current_state = 'deleted' then return; end if;

  -- Check ownership across buckets, plus canonical-prefix objects even if
  -- object ownership metadata is unexpectedly missing or inconsistent.
  if exists (
    select 1
    from storage.objects o
    where o.owner_id = p_user_id::text
       or (
         o.bucket_id = 'profile-photos'
         and o.name like p_user_id::text || '/%'
       )
  ) then
    raise exception using
      errcode = '55000', message = 'Storage cleanup is incomplete.';
  end if;

  if current_state = 'prepared' then return; end if;

  delete from public.profile_photos p where p.user_id = p_user_id;
  delete from public.profiles p where p.user_id = p_user_id;
  delete from public.active_discovery_sessions s where s.user_id = p_user_id;

  delete from public.connection_requests r
  where p_user_id in (r.sender_id, r.recipient_id);

  delete from public.user_blocks b
  where p_user_id in (b.blocker_id, b.blocked_id);

  -- Deliberately retain connections, messages, reports and evidence links.
  update private.account_participants a
  set state = 'prepared',
      storage_verified_at = pg_catalog.clock_timestamp(),
      prepared_at = pg_catalog.clock_timestamp()
  where a.participant_id = p_user_id;
end;
$$;

create function public.prepare_account_auth_deletion(p_user_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.prepare_account_auth_deletion_impl(p_user_id);
$$;


-- Server can resume jobs after a request timeout or after Auth deletion.
-- No participant IDs are returned by this status function.
create function private.account_deletion_status_impl(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501', message = 'Operation is not available.';
  end if;

  select a.state into result
  from private.account_participants a
  where a.participant_id = p_user_id;

  if not found then
    raise exception using
      errcode = '42501', message = 'Account is not available.';
  end if;

  return result;
end;
$$;

create function public.account_deletion_status(p_user_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select private.account_deletion_status_impl(p_user_id);
$$;


-- Ownership and exact function ACL allowlists.
do $$
declare
  signature text;
begin
  foreach signature in array array[
    'private.create_account_participant()',
    'private.preserve_account_participant()',
    'private.account_is_active(uuid)',
    'private.caller_account_is_active()',
    'private.lock_account_shared(uuid)',
    'private.caller_account_may_write()',
    'private.users_are_blocked(uuid,uuid)',
    'private.lock_interaction_pair(uuid,uuid)',
    'private.request_is_visible(uuid,uuid,text)',
    'private.guard_account_table_write()',
    'private.photo_accounts_are_active(text,text)',
    'private.report_user_impl(uuid,text,text)',
    'private.can_read_connection_history(uuid)',
    'private.list_messages_impl(uuid,timestamptz,uuid,integer)',
    'private.list_deleted_conversations_impl()',
    'public.list_deleted_conversations()',
    'private.begin_account_deletion_impl(uuid)',
    'public.begin_account_deletion(uuid)',
    'private.prepare_account_auth_deletion_impl(uuid)',
    'public.prepare_account_auth_deletion(uuid)',
    'private.account_deletion_status_impl(uuid)',
    'public.account_deletion_status(uuid)'
  ] loop
    execute 'alter function ' || signature || ' owner to postgres';
    execute 'revoke all on function ' || signature ||
      ' from public, anon, authenticated, service_role';
  end loop;
end;
$$;

revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- Helpers referenced directly by policies must be executable by policy roles.
-- Their implementations fail closed for unauthenticated callers.
grant execute on function private.caller_account_is_active()
  to anon, authenticated;
grant execute on function private.caller_account_may_write()
  to anon, authenticated;
grant execute on function private.photo_accounts_are_active(text,text)
  to anon, authenticated;

grant execute on function private.users_are_blocked(uuid,uuid)
  to authenticated;
grant execute on function private.request_is_visible(uuid,uuid,text)
  to authenticated;
grant execute on function private.report_user_impl(uuid,text,text)
  to authenticated;
grant execute on function private.list_messages_impl(
  uuid,timestamptz,uuid,integer
) to authenticated;
grant execute on function private.list_deleted_conversations_impl()
  to authenticated;
grant execute on function public.list_deleted_conversations()
  to authenticated;

grant execute on function private.begin_account_deletion_impl(uuid)
  to service_role;
grant execute on function public.begin_account_deletion(uuid)
  to service_role;
grant execute on function private.prepare_account_auth_deletion_impl(uuid)
  to service_role;
grant execute on function public.prepare_account_auth_deletion(uuid)
  to service_role;
grant execute on function private.account_deletion_status_impl(uuid)
  to service_role;
grant execute on function public.account_deletion_status(uuid)
  to service_role;

comment on function public.begin_account_deletion(uuid) is
  'Server-only irreversible deletion start. Caller identity must be verified by the future server orchestrator. Gates app activity and ends active relationships without deleting history.';

comment on function public.prepare_account_auth_deletion(uuid) is
  'Server-only preparation after successful Storage API cleanup. Deletes personal application rows, preserves history/reports, and permits subsequent Auth Admin deletion. Does not delete Storage bytes or Auth users.';

comment on function public.list_deleted_conversations() is
  'Active surviving participant only. Lists deletion-ended archives with Deleted User label and no participant UUID/profile data. Block-ended connections remain inaccessible.';

comment on table public.connections is
  'Immutable historical participant references independent of Auth deletion. Only ended_at NULL relationships are active. Account deletion never reopens ended relationships.';

comment on table public.messages is
  'RPC-only immutable conversation history retained independently of Auth deletion. No participant UUIDs in message-list output. Conversation deletion is restricted.';

comment on table public.user_reports is
  'Confidential reports retained when either participant deletes Auth. Private participant linkage preserves moderation context. No ordinary client reads. Free-text details may contain personal information and require controlled retention.';

notify pgrst, 'reload schema';

commit;
