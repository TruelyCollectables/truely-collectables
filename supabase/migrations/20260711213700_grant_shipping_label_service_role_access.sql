begin;

grant usage on schema public to service_role;

revoke all privileges on table public.order_shipping_labels
  from public, anon, authenticated;
revoke all privileges on table public.order_shipping_tracking_events
  from public, anon, authenticated;
revoke all privileges on table public.order_shipping_coverage_claims
  from public, anon, authenticated;

grant select, insert, update on table public.order_shipping_labels
  to service_role;
grant select, insert, update on table public.order_shipping_tracking_events
  to service_role;
grant select, insert, update on table public.order_shipping_coverage_claims
  to service_role;

notify pgrst, 'reload schema';

commit;
