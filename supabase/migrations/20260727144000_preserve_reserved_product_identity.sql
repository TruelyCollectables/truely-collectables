begin;

-- A payable Stripe Checkout Session owns its exact product and inventory
-- identity until completion or expiration. Deleting either row while a
-- reservation exists would turn a paid webhook into an unfulfillable orphan.
alter table public.checkout_inventory_reservations
  drop constraint if exists checkout_inventory_reservations_inventory_item_id_fkey;

alter table public.checkout_inventory_reservations
  add constraint checkout_inventory_reservations_inventory_item_id_fkey
  foreign key (inventory_item_id)
  references public.inventory_items(id)
  on delete restrict;

alter table public.checkout_inventory_reservations
  drop constraint if exists checkout_inventory_reservations_product_store_fkey;

alter table public.checkout_inventory_reservations
  add constraint checkout_inventory_reservations_product_store_fkey
  foreign key (legacy_product_id, store_id)
  references public.products(id, store_id)
  on delete restrict
  not valid;

alter table public.checkout_inventory_reservations
  validate constraint checkout_inventory_reservations_product_store_fkey;

commit;
