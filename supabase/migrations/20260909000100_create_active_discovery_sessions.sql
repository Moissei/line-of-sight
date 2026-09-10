-- Run this entire file once in the Supabase SQL Editor.
-- Schema only: no app integration, client policies, scheduled jobs, or sample data.
begin;

create table public.active_discovery_sessions (
  -- One current row per user, never one row per location update or past session.
  -- References Supabase's existing auth schema; does not create users or implement auth.
  user_id uuid primary key references auth.users (id) on delete cascade,
  latitude double precision,
  longitude double precision,
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  expires_at timestamptz default (now() + interval '15 minutes'),

  constraint discovery_latitude_range check (latitude between -90 and 90),
  constraint discovery_longitude_range check (longitude between -180 and 180),
  constraint discovery_current_location_only check (
    (is_active and latitude is not null and longitude is not null)
    or
    (not is_active and latitude is null and longitude is null)
  )
);

-- Deny client access until authenticated ownership policies are deliberately added.
alter table public.active_discovery_sessions enable row level security;
revoke all on table public.active_discovery_sessions from public, anon, authenticated;

create function public.prepare_active_discovery_session()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Use server time rather than trusting a client-supplied last-updated value.
  new.updated_at := clock_timestamp();

  -- STOP must remove coordinates, even if a caller only sends is_active = false.
  if not new.is_active then
    new.latitude := null;
    new.longitude := null;
    new.expires_at := null;
  end if;

  return new;
end;
$$;

revoke all on function public.prepare_active_discovery_session() from public, anon, authenticated;

create trigger prepare_active_discovery_session
before insert or update on public.active_discovery_sessions
for each row execute function public.prepare_active_discovery_session();

comment on table public.active_discovery_sessions is
  'Temporary current presence only. Explicit START LOOKING is required. Update in place; never append movement history. STOP deletes the row or clears active status and coordinates. Intentions never filter visibility.';
comment on column public.active_discovery_sessions.latitude is
  'Sensitive current coordinate. Never display in UI or expose to other users through discovery responses.';
comment on column public.active_discovery_sessions.longitude is
  'Sensitive current coordinate. Never display in UI or expose to other users through discovery responses.';
comment on column public.active_discovery_sessions.expires_at is
  'Optional session deadline. Expired rows must be excluded from discovery even before cleanup. A NULL deadline must still be subject to a freshness timeout using updated_at.';

commit;
