begin;

grant usage on schema public to service_role;
grant delete on table public.platform_fee_ledger_entries to service_role;

notify pgrst, 'reload schema';

commit;
