begin;

alter table public.offers
  add column if not exists listing_price_at_offer numeric(12,2),
  add column if not exists minimum_shipping_method_at_offer text,
  add column if not exists minimum_shipping_amount_at_offer numeric(12,2),
  add column if not exists shipping_profile_at_offer text;

update public.offers offer_row
set listing_price_at_offer = round(product_row.price::numeric, 2)
from public.products product_row
where offer_row.product_id = product_row.id
  and offer_row.store_id = product_row.store_id
  and offer_row.listing_price_at_offer is null;

alter table public.offers
  drop constraint if exists offers_listing_price_at_offer_nonnegative_check,
  drop constraint if exists offers_minimum_shipping_amount_at_offer_nonnegative_check,
  drop constraint if exists offers_minimum_shipping_method_at_offer_check;

alter table public.offers
  add constraint offers_listing_price_at_offer_nonnegative_check
    check (listing_price_at_offer is null or listing_price_at_offer >= 0) not valid,
  add constraint offers_minimum_shipping_amount_at_offer_nonnegative_check
    check (
      minimum_shipping_amount_at_offer is null
      or minimum_shipping_amount_at_offer >= 0
    ) not valid,
  add constraint offers_minimum_shipping_method_at_offer_check
    check (
      minimum_shipping_method_at_offer is null
      or minimum_shipping_method_at_offer in (
        'STANDARD_ENVELOPE',
        'GROUND_ADVANTAGE',
        'PRIORITY_MAIL'
      )
    ) not valid;

alter table public.offers
  validate constraint offers_listing_price_at_offer_nonnegative_check;

alter table public.offers
  validate constraint offers_minimum_shipping_amount_at_offer_nonnegative_check;

alter table public.offers
  validate constraint offers_minimum_shipping_method_at_offer_check;

commit;
