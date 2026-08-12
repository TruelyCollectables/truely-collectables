begin;

-- Shipment Protection v3 applies to new consents only. Historical v1/v2 rows
-- retain their original stored terms so previously purchased protection is not
-- retroactively reduced.
alter table public.order_buyer_protections
  alter column shipping_reimbursable set default false;

alter table public.order_buyer_protections
  drop constraint if exists order_buyer_protections_current_policy_amount_check,
  drop constraint if exists order_buyer_protections_current_policy_shipping_check;

alter table public.order_buyer_protections
  add constraint order_buyer_protections_current_policy_amount_check check (
    policy_version <> 'truely-shipment-protection-v3-2026-08-11'
    or (
      fee_amount > 0
      and fee_amount <= 2.00
      and covered_item_amount > 0
      and covered_item_amount <= 20.00
    )
  ) not valid,
  add constraint order_buyer_protections_current_policy_shipping_check check (
    policy_version <> 'truely-shipment-protection-v3-2026-08-11'
    or shipping_reimbursable = false
  ) not valid;

alter table public.order_buyer_protections
  validate constraint order_buyer_protections_current_policy_amount_check,
  validate constraint order_buyer_protections_current_policy_shipping_check;

alter table public.offers
  drop constraint if exists offers_current_buyer_protection_amount_check;

alter table public.offers
  add constraint offers_current_buyer_protection_amount_check check (
    buyer_protection_policy_version <> 'truely-shipment-protection-v3-2026-08-11'
    or (
      buyer_protection_fee >= 0
      and buyer_protection_fee <= 2.00
      and buyer_protection_covered_amount >= 0
      and buyer_protection_covered_amount <= 20.00
    )
  ) not valid;

alter table public.offers
  validate constraint offers_current_buyer_protection_amount_check;

comment on column public.order_buyer_protections.fee_amount is
  'Shipment Protection fee. For v3, 10 percent of protected item subtotal only, maximum $2.00.';
comment on column public.order_buyer_protections.covered_item_amount is
  'Protected amount under the policy version stored on the row. For v3, item subtotal only with a $20.00 maximum payout.';
comment on column public.order_buyer_protections.shipping_reimbursable is
  'False by default. Shipment Protection v3 does not reimburse shipping; historical rows retain their original stored terms.';

commit;
