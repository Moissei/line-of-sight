-- Review and run once as postgres after the connections migration.
-- No table, RLS, Storage, or discovery changes.
begin;

create function private.list_connections_impl()
returns table (
  connection_id uuid, first_name text, age integer, gender text,
  bio text, intents text[], connected_at timestamptz
)
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
  left join public.profiles p on p.user_id = case
    when c.user_low = caller_id then c.user_high else c.user_low end
  where c.user_low = caller_id or c.user_high = caller_id
  order by c.created_at desc, c.id;
end;
$$;

create function public.list_connections()
returns table (
  connection_id uuid, first_name text, age integer, gender text,
  bio text, intents text[], connected_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select c.connection_id, c.first_name, c.age, c.gender,
    c.bio, c.intents, c.connected_at
  from private.list_connections_impl() c;
$$;

alter function private.list_connections_impl() owner to postgres;
alter function public.list_connections() owner to postgres;
revoke all on function private.list_connections_impl() from public, anon, authenticated, service_role;
revoke all on function public.list_connections() from public, anon, authenticated, service_role;
revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.list_connections_impl() to authenticated;
grant execute on function public.list_connections() to authenticated;
comment on function private.list_connections_impl() is
  'Participant-only accepted connections with safe current profile fields of the other participant. No other-user ID, birth date, location, email or photo URL. Missing profiles retain the connection with neutral display fields.';
-- Keep private outside the exposed Data API schemas. No photo authorization or
-- messaging is introduced. Existing owner-only profiles RLS remains unchanged.
notify pgrst, 'reload schema';
commit;
