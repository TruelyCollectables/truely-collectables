begin;

-- Keep the post-sale eBay journal durable even if an administrator later
-- removes the local inventory row. A pending remote quantity correction must
-- not disappear through an ON DELETE CASCADE.
alter table public.ebay_quantity_sync_outbox
  drop constraint if exists ebay_quantity_sync_outbox_inventory_item_id_fkey;

alter table public.ebay_quantity_sync_outbox
  alter column inventory_item_id drop not null;

alter table public.ebay_quantity_sync_outbox
  add constraint ebay_quantity_sync_outbox_inventory_item_id_fkey
  foreign key (inventory_item_id)
  references public.inventory_items(id)
  on delete set null;

-- The accepted-offer inventory consumer is SECURITY DEFINER. Pin its lookup
-- path to trusted schemas before this migration set is allowed into Production.
alter function public.tcos_decrement_order_inventory_once(
  uuid,
  bigint,
  bigint,
  integer
) set search_path = pg_catalog, public, pg_temp;

commit;
