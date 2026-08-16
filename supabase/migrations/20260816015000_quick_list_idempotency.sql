-- Quick List v2 derives a stable SKU from the browser's per-card request ID.
-- The partial unique index makes concurrent/replayed creates fail closed at the
-- database boundary instead of allowing duplicate card products.
create unique index if not exists products_quick_list_store_sku_uidx
  on public.products (store_id, sku)
  where sku like 'QL-%';
