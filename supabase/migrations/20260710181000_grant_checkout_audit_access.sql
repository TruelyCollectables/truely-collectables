begin;

grant select, insert on table public.tos_acceptance_events
  to service_role;

grant select, insert on table public.public_endpoint_rate_limit_events
  to service_role;

commit;
