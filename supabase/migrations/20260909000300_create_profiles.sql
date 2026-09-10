-- Review and run this entire file once as postgres in Supabase SQL Editor.
-- No existing tables, discovery functions, or user records are modified.
begin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  date_of_birth date,
  gender text,
  bio text,
  intents text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_first_name_valid check (
    char_length(first_name) between 1 and 60
    and first_name ~ '[^[:space:]]'
  ),
  constraint profiles_birth_date_finite check (isfinite(date_of_birth)),
  constraint profiles_gender_length check (char_length(gender) <= 60),
  constraint profiles_bio_length check (char_length(bio) <= 200),
  constraint profiles_intents_valid check (
    cardinality(intents) <= 4
    and (cardinality(intents) = 0 or array_ndims(intents) = 1)
    and array_position(intents, null) is null
    and intents <@ array['Dating', 'Friendship', 'Networking', 'Socializing']::text[]
  ),
  -- Each selected intent occurs at most once; an empty selection is allowed.
  constraint profiles_intents_unique check (
    cardinality(intents) =
      ('Dating' = any(intents))::integer +
      ('Friendship' = any(intents))::integer +
      ('Networking' = any(intents))::integer +
      ('Socializing' = any(intents))::integer
  )
);

create function public.prepare_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Validate against server time at write time, not a time-dependent CHECK.
  if new.date_of_birth > (clock_timestamp() at time zone 'UTC')::date then
    raise exception using
      errcode = '23514', message = 'Date of birth cannot be in the future.';
  end if;

  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_at := new.updated_at;
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_profile() from public, anon, authenticated;

create trigger prepare_profile
before insert or update on public.profiles
for each row execute function public.prepare_profile();

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;

create policy profiles_select_own
on public.profiles for select to authenticated
using ((select auth.uid()) = user_id);

create policy profiles_insert_own
on public.profiles for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy profiles_update_own
on public.profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- No DELETE privilege, anonymous policy, or global profile-read policy.
comment on table public.profiles is
  'Owner-only profile data. Other users may only receive explicitly approved safe fields through a future dedicated nearby-profile RPC. No email or photo storage.';
comment on column public.profiles.date_of_birth is
  'Private birth date. Future nearby-profile RPCs may calculate an age but must not return another user''s exact birth date.';
comment on column public.profiles.intents is
  'Descriptive multi-select intentions only. Never filter nearby discovery by intentions, gender, age, or other profile preferences.';

commit;
