-- Retire used or in-flight coupons without erasing linked order/redemption history.
-- Archived coupons remain inactive and invisible in the Kingmaker list.
alter table public.store_promotions
  add column if not exists archived_at timestamptz;

create index if not exists store_promotions_active_management_idx
  on public.store_promotions (store_id, created_at desc)
  where archived_at is null;
