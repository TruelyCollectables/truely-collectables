begin;

grant usage on schema public to service_role;

grant select on table public.orders to service_role;
grant update (stripe_charge_id) on table public.orders to service_role;

commit;
