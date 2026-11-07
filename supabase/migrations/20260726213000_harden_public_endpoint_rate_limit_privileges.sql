do $$
begin
  if to_regclass('public.public_endpoint_rate_limit_events') is null then
    raise exception 'public.public_endpoint_rate_limit_events is required before privilege hardening';
  end if;
end
$$;

alter table public.public_endpoint_rate_limit_events enable row level security;

revoke all privileges on table public.public_endpoint_rate_limit_events
  from public, anon, authenticated;

grant select, insert on table public.public_endpoint_rate_limit_events
  to service_role;

comment on table public.public_endpoint_rate_limit_events is
  'Server-only audit and rate-limit events for public money endpoints. Rows may contain IP and identity evidence and are never exposed to anon or authenticated clients.';
