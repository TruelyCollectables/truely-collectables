begin;

alter table public.order_buyer_protections
  alter column fee_amount set default 0,
  alter column shipping_reimbursable set default true;

alter table public.order_buyer_protections
  drop constraint if exists order_buyer_protections_fee_amount_check,
  drop constraint if exists order_buyer_protections_covered_item_amount_check,
  drop constraint if exists order_buyer_protections_shipping_reimbursable_check;

alter table public.order_buyer_protections
  add constraint order_buyer_protections_fee_amount_check check (
    fee_amount > 0 and fee_amount <= 2.50
  ) not valid,
  add constraint order_buyer_protections_covered_item_amount_check check (
    covered_item_amount > 0 and covered_item_amount <= 25
  ) not valid;

alter table public.order_buyer_protections
  validate constraint order_buyer_protections_fee_amount_check,
  validate constraint order_buyer_protections_covered_item_amount_check;

alter table public.buyer_protection_claims
  drop constraint if exists buyer_protection_claims_reason_check,
  drop constraint if exists buyer_protection_claims_reimbursement_amount_check;

alter table public.buyer_protection_claims
  add constraint buyer_protection_claims_reason_check check (
    reason in ('not_received', 'damaged')
  ) not valid,
  add constraint buyer_protection_claims_reimbursement_amount_check check (
    reimbursement_amount >= 0 and reimbursement_amount <= 25
  ) not valid;

alter table public.buyer_protection_claims
  validate constraint buyer_protection_claims_reason_check,
  validate constraint buyer_protection_claims_reimbursement_amount_check;

alter table public.offers
  drop constraint if exists offers_buyer_protection_fee_check,
  drop constraint if exists offers_buyer_protection_covered_amount_check;

alter table public.offers
  add constraint offers_buyer_protection_fee_check check (
    buyer_protection_fee >= 0 and buyer_protection_fee <= 2.50
  ) not valid,
  add constraint offers_buyer_protection_covered_amount_check check (
    buyer_protection_covered_amount >= 0
    and buyer_protection_covered_amount <= 25
  ) not valid;

alter table public.offers
  validate constraint offers_buyer_protection_fee_check,
  validate constraint offers_buyer_protection_covered_amount_check;

comment on column public.order_buyer_protections.fee_amount is
  'Dynamic Shipment Protection fee calculated as 10 percent of item subtotal plus shipping.';
comment on column public.order_buyer_protections.covered_item_amount is
  'Protected order amount retained under the legacy column name; includes item subtotal plus shipping for Shipment Protection v2.';
comment on column public.order_buyer_protections.shipping_reimbursable is
  'True for Shipment Protection v2 records; legacy Buyer Protection records may remain false.';

commit;
