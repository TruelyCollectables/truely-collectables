begin;

alter table public.orders
  add column if not exists customer_phone text,
  add column if not exists tax_amount numeric(12,2) not null default 0,
  add column if not exists fulfilled_at timestamptz;

alter table public.orders
  drop constraint if exists orders_tax_amount_nonnegative;
alter table public.orders
  add constraint orders_tax_amount_nonnegative
  check (tax_amount >= 0);

alter table public.order_notification_deliveries
  drop constraint if exists order_notification_deliveries_notification_type_check;
alter table public.order_notification_deliveries
  add constraint order_notification_deliveries_notification_type_check
  check (
    notification_type in (
      'payment_confirmation',
      'fulfillment_confirmation',
      'shipment_confirmation',
      'tracking_updated'
    )
  );

commit;
