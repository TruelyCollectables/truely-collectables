begin;

-- PostgreSQL runs triggers for the same event in alphabetical order. The guard
-- triggers must modify NEW.quantity before the later reset_* triggers decide
-- whether a legitimate restock occurred.

drop trigger if exists truely_protect_pending_ebay_product_quantity
  on public.products;
drop trigger if exists aaa_truely_protect_pending_ebay_product_quantity
  on public.products;
create trigger aaa_truely_protect_pending_ebay_product_quantity
before update of quantity on public.products
for each row
execute function public.truely_protect_pending_ebay_product_quantity();

drop trigger if exists truely_protect_pending_ebay_inventory_quantity
  on public.inventory_items;
drop trigger if exists aaa_truely_protect_pending_ebay_inventory_quantity
  on public.inventory_items;
create trigger aaa_truely_protect_pending_ebay_inventory_quantity
before update of quantity, status on public.inventory_items
for each row
execute function public.truely_protect_pending_ebay_inventory_quantity();

drop trigger if exists truely_protect_ebay_order_product_quantity
  on public.products;
drop trigger if exists aaa_truely_protect_ebay_order_product_quantity
  on public.products;
create trigger aaa_truely_protect_ebay_order_product_quantity
before update of quantity on public.products
for each row
execute function public.truely_protect_ebay_order_product_quantity();

drop trigger if exists truely_protect_ebay_order_inventory_quantity
  on public.inventory_items;
drop trigger if exists aaa_truely_protect_ebay_order_inventory_quantity
  on public.inventory_items;
create trigger aaa_truely_protect_ebay_order_inventory_quantity
before update of quantity, status on public.inventory_items
for each row
execute function public.truely_protect_ebay_order_inventory_quantity();

comment on trigger aaa_truely_protect_pending_ebay_product_quantity
  on public.products is
  'Runs before reset_product_sold_presentation_on_restock so stale inbound stock cannot erase SOLD evidence.';
comment on trigger aaa_truely_protect_ebay_order_product_quantity
  on public.products is
  'Runs before reset_product_sold_presentation_on_restock so paid eBay sale guards win over stale inbound stock.';

commit;
