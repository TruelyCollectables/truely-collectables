alter table if exists public.seller_payout_requests
  add column if not exists final_processor_fee_amount numeric(12, 2) not null default 0,
  add column if not exists final_net_amount numeric(12, 2) not null default 0,
  add column if not exists provider_payout_reference text,
  add column if not exists provider_payout_status text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'seller_payout_requests_final_amounts_check'
  ) then
    alter table public.seller_payout_requests
      add constraint seller_payout_requests_final_amounts_check
      check (
        final_processor_fee_amount >= 0
        and final_net_amount >= 0
      );
  end if;
end $$;

create index if not exists seller_payout_requests_provider_reference_idx
  on public.seller_payout_requests(store_id, provider_payout_reference)
  where provider_payout_reference is not null;
