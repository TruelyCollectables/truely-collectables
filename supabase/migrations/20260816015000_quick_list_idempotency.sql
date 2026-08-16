-- Quick List v3 derives a stable SKU from the browser's per-card request ID.
-- The partial unique index makes concurrent/replayed creates fail closed at the
-- database boundary instead of allowing duplicate card products.
create unique index if not exists products_quick_list_store_sku_uidx
  on public.products (store_id, sku)
  where sku like 'QL-%';

-- The legacy products table is still consumed by storefront paths. Hide every
-- Quick List product at the database boundary from the instant it is inserted,
-- even if the following inventory-item bridge write is interrupted. The normal
-- explicit set_site_active action can later clear archived_at because this
-- trigger only fires when the QL SKU itself is inserted or changed.
create or replace function public.tcos_force_quick_list_product_draft()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sku like 'QL-%' then
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists tcos_force_quick_list_product_draft on public.products;

create trigger tcos_force_quick_list_product_draft
before insert or update of sku
on public.products
for each row
execute function public.tcos_force_quick_list_product_draft();
