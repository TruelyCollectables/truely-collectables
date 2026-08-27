begin;

alter table public.ebay_quantity_sync_outbox
  drop constraint if exists ebay_quantity_sync_outbox_source_type_check;

alter table public.ebay_quantity_sync_outbox
  add constraint ebay_quantity_sync_outbox_source_type_check
  check (source_type in (
    'checkout_reservation',
    'order_inventory_consumption',
    'manual_sale'
  ));

create or replace function public.truely_enqueue_ebay_quantity_sync_from_collectible_sale()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  inventory_row public.inventory_items%rowtype;
  product_row public.products%rowtype;
begin
  if new.source_marketplace = 'website' then
    return new;
  end if;

  select * into product_row
  from public.products
  where store_id = new.store_id and id = new.legacy_product_id;

  if not found or (
    nullif(btrim(coalesce(product_row.sku, '')), '') is null
    and nullif(btrim(coalesce(product_row.ebay_item_id, '')), '') is null
  ) then
    return new;
  end if;

  select * into inventory_row
  from public.inventory_items
  where store_id = new.store_id
    and (
      id = new.inventory_item_id
      or legacy_product_id = new.legacy_product_id
      or (product_row.sku is not null and sku = product_row.sku)
    )
  order by case when id = new.inventory_item_id then 0 else 1 end, created_at asc
  limit 1;

  if inventory_row.id is null then
    return new;
  end if;

  insert into public.ebay_quantity_sync_outbox as existing (
    store_id,
    source_type,
    source_id,
    order_id,
    legacy_product_id,
    inventory_item_id,
    sku,
    ebay_item_id,
    desired_quantity,
    status,
    next_attempt_at,
    updated_at
  ) values (
    new.store_id,
    'manual_sale',
    new.id,
    null,
    new.legacy_product_id,
    inventory_row.id,
    nullif(btrim(coalesce(product_row.sku, '')), ''),
    nullif(btrim(coalesce(product_row.ebay_item_id, '')), ''),
    0,
    'pending',
    now(),
    now()
  )
  on conflict (store_id, source_type, source_id)
  do update set
    desired_quantity = 0,
    status = case when existing.status = 'synced' and existing.desired_quantity = 0
      then existing.status else 'pending' end,
    next_attempt_at = now(),
    last_error = null,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists truely_enqueue_ebay_quantity_sync_from_collectible_sale
  on public.collectible_sales;
create trigger truely_enqueue_ebay_quantity_sync_from_collectible_sale
after insert on public.collectible_sales
for each row
execute function public.truely_enqueue_ebay_quantity_sync_from_collectible_sale();

revoke all on function public.truely_enqueue_ebay_quantity_sync_from_collectible_sale()
  from public, anon, authenticated;

commit;
