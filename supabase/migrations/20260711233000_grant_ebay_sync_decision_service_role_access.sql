begin;

grant usage on schema public to service_role;

grant select, insert, update on table public.ebay_sync_decision_events
  to service_role;

grant select on public.tcos_ebay_snapshot_import_decision_summary
  to service_role;

grant select on public.tcos_ebay_missing_sync_decision_summary
  to service_role;

notify pgrst, 'reload schema';

commit;
