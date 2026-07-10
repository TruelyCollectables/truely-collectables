begin;

alter table public.seller_payout_accounts enable row level security;
alter table public.seller_payout_ledger_entries enable row level security;
alter table public.platform_fee_ledger_entries enable row level security;
alter table public.seller_payout_requests enable row level security;
alter table public.seller_payout_request_entries enable row level security;
alter table public.seller_payout_admin_events enable row level security;

revoke all privileges on table public.seller_payout_accounts
  from anon, authenticated, service_role;
revoke all privileges on table public.seller_payout_ledger_entries
  from anon, authenticated, service_role;
revoke all privileges on table public.platform_fee_ledger_entries
  from anon, authenticated, service_role;
revoke all privileges on table public.seller_payout_requests
  from anon, authenticated, service_role;
revoke all privileges on table public.seller_payout_request_entries
  from anon, authenticated, service_role;
revoke all privileges on table public.seller_payout_admin_events
  from anon, authenticated, service_role;

grant select, insert, update on table public.seller_payout_accounts
  to service_role;
grant select, insert, update on table public.seller_payout_ledger_entries
  to service_role;
grant select, insert, update on table public.platform_fee_ledger_entries
  to service_role;
grant select, insert, update on table public.seller_payout_requests
  to service_role;
grant select, insert on table public.seller_payout_request_entries
  to service_role;
grant select, insert on table public.seller_payout_admin_events
  to service_role;

commit;
