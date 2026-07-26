begin;

-- Composite parent identities required by store-scoped foreign keys.
create unique index if not exists inventory_items_id_store_id_unique_idx
  on public.inventory_items (id, store_id);

create unique index if not exists orders_id_store_id_unique_idx
  on public.orders (id, store_id);

create unique index if not exists products_id_store_id_unique_idx
  on public.products (id, store_id);

-- One canonical inventory row per store and legacy product.
create unique index if not exists inventory_items_store_legacy_product_unique_idx
  on public.inventory_items (store_id, legacy_product_id)
  where legacy_product_id is not null;

-- Exactly-once order and order-item identities.
create unique index if not exists orders_store_stripe_session_uidx
  on public.orders (store_id, stripe_session_id)
  where stripe_session_id is not null
    and btrim(stripe_session_id) <> '';

-- Remove the audit-era duplicate while retaining the canonical index above.
drop index if exists public.orders_store_stripe_session_unique_idx;

create unique index if not exists order_items_store_order_product_unique_idx
  on public.order_items (store_id, order_id, product_id);

-- Reservation state/timestamp integrity.
alter table public.checkout_inventory_reservations
  drop constraint if exists checkout_inventory_reservations_state_timestamps_check;

alter table public.checkout_inventory_reservations
  add constraint checkout_inventory_reservations_state_timestamps_check
  check (
    (
      status = 'consumed'
      and consumed_at is not null
      and stripe_session_id is not null
    )
    or (
      status <> 'consumed'
      and consumed_at is null
    )
  ) not valid;

alter table public.checkout_inventory_reservations
  validate constraint checkout_inventory_reservations_state_timestamps_check;

alter table public.checkout_inventory_reservations
  drop constraint if exists checkout_inventory_reservations_release_timestamp_check;

alter table public.checkout_inventory_reservations
  add constraint checkout_inventory_reservations_release_timestamp_check
  check (
    (
      status = 'released'
      and released_at is not null
    )
    or (
      status <> 'released'
      and released_at is null
    )
  ) not valid;

alter table public.checkout_inventory_reservations
  validate constraint checkout_inventory_reservations_release_timestamp_check;

-- Order value integrity.
alter table public.order_items
  drop constraint if exists order_items_quantity_positive_check;

alter table public.order_items
  add constraint order_items_quantity_positive_check
  check (quantity > 0) not valid;

alter table public.order_items
  validate constraint order_items_quantity_positive_check;

alter table public.order_items
  drop constraint if exists order_items_price_nonnegative_check;

alter table public.order_items
  add constraint order_items_price_nonnegative_check
  check (price >= 0::numeric) not valid;

alter table public.order_items
  validate constraint order_items_price_nonnegative_check;

alter table public.orders
  drop constraint if exists orders_item_count_nonnegative_check;

alter table public.orders
  add constraint orders_item_count_nonnegative_check
  check (item_count >= 0) not valid;

alter table public.orders
  validate constraint orders_item_count_nonnegative_check;

alter table public.orders
  drop constraint if exists orders_subtotal_nonnegative_check;

alter table public.orders
  add constraint orders_subtotal_nonnegative_check
  check (subtotal >= 0::numeric) not valid;

alter table public.orders
  validate constraint orders_subtotal_nonnegative_check;

alter table public.orders
  drop constraint if exists orders_shipping_amount_nonnegative_check;

alter table public.orders
  add constraint orders_shipping_amount_nonnegative_check
  check (shipping_amount >= 0::numeric) not valid;

alter table public.orders
  validate constraint orders_shipping_amount_nonnegative_check;

alter table public.orders
  drop constraint if exists orders_total_nonnegative_check;

alter table public.orders
  add constraint orders_total_nonnegative_check
  check (total >= 0::numeric) not valid;

alter table public.orders
  validate constraint orders_total_nonnegative_check;

-- Store-scoped relational integrity.
alter table public.order_items
  drop constraint if exists order_items_order_store_fkey;

alter table public.order_items
  add constraint order_items_order_store_fkey
  foreign key (order_id, store_id)
  references public.orders (id, store_id)
  on delete cascade
  not valid;

alter table public.order_items
  validate constraint order_items_order_store_fkey;

alter table public.order_items
  drop constraint if exists order_items_product_store_fkey;

alter table public.order_items
  add constraint order_items_product_store_fkey
  foreign key (product_id, store_id)
  references public.products (id, store_id)
  not valid;

alter table public.order_items
  validate constraint order_items_product_store_fkey;

alter table public.order_inventory_consumptions
  drop constraint if exists order_inventory_consumptions_order_store_fkey;

alter table public.order_inventory_consumptions
  add constraint order_inventory_consumptions_order_store_fkey
  foreign key (order_id, store_id)
  references public.orders (id, store_id)
  on delete cascade
  not valid;

alter table public.order_inventory_consumptions
  validate constraint order_inventory_consumptions_order_store_fkey;

alter table public.order_inventory_consumptions
  drop constraint if exists order_inventory_consumptions_inventory_store_fkey;

alter table public.order_inventory_consumptions
  add constraint order_inventory_consumptions_inventory_store_fkey
  foreign key (inventory_item_id, store_id)
  references public.inventory_items (id, store_id)
  on delete restrict
  not valid;

alter table public.order_inventory_consumptions
  validate constraint order_inventory_consumptions_inventory_store_fkey;

alter table public.order_inventory_consumptions
  drop constraint if exists order_inventory_consumptions_product_store_fkey;

alter table public.order_inventory_consumptions
  add constraint order_inventory_consumptions_product_store_fkey
  foreign key (legacy_product_id, store_id)
  references public.products (id, store_id)
  on delete restrict
  not valid;

alter table public.order_inventory_consumptions
  validate constraint order_inventory_consumptions_product_store_fkey;

commit;
