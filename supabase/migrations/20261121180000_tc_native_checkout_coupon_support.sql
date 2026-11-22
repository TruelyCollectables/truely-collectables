-- Coupon discounts and free-shipping are applied directly to Stripe Checkout
-- line-item prices by TCOS, so a separate Stripe promotion code is optional.
-- Preserve existing Stripe-backed codes and their historical references.
alter table public.store_promotions
  alter column stripe_coupon_id drop not null,
  alter column stripe_promotion_code_id drop not null;

create unique index if not exists store_promotions_unique_store_code_casefold
  on public.store_promotions (store_id, upper(code));
