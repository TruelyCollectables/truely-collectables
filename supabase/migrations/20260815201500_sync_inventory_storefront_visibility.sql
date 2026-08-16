-- The public Truely Collectables catalog currently reads legacy products and
-- uses products.archived_at as its explicit storefront exclusion gate. A draft
-- inventory row must hide the product even when sellable quantity is retained
-- for eBay. Moving inventory back to active does NOT clear archived_at here:
-- only the explicit set_site_active admin action may unarchive a product. This
-- prevents unrelated inventory status changes from resurrecting an intentionally
-- archived legacy product.

create or replace function public.tcos_sync_inventory_storefront_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.legacy_product_id is null then
    return new;
  end if;

  if new.status = 'draft' then
    update public.products
       set archived_at = coalesce(archived_at, now())
     where id = new.legacy_product_id
       and store_id = new.store_id;
  end if;

  return new;
end;
$$;

drop trigger if exists tcos_inventory_storefront_visibility on public.inventory_items;

create trigger tcos_inventory_storefront_visibility
after insert or update of status, legacy_product_id
on public.inventory_items
for each row
execute function public.tcos_sync_inventory_storefront_visibility();

-- Repair existing draft rows that may currently have positive quantity and a
-- null archived_at, which makes them eligible for the legacy public catalog.
update public.products as product
   set archived_at = coalesce(product.archived_at, now())
  from public.inventory_items as inventory
 where inventory.store_id = product.store_id
   and inventory.legacy_product_id = product.id
   and inventory.status = 'draft'
   and product.archived_at is null;
