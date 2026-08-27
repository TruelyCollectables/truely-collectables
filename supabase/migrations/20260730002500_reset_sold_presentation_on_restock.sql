begin;

create or replace function public.reset_product_sold_presentation_on_restock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.quantity, 0) > 0 and (
    coalesce(old.quantity, 0) <= 0
    or old.sold_at is not null
    or old.archive_after is not null
    or old.archived_at is not null
  ) then
    new.sold_at := null;
    new.sold_price := null;
    new.sold_source := null;
    new.sold_reference := null;
    new.sold_price_status := 'unresolved';
    new.sold_evidence := '{}'::jsonb;
    new.archive_after := null;
    new.archived_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists reset_product_sold_presentation_on_restock
  on public.products;
create trigger reset_product_sold_presentation_on_restock
before update of quantity on public.products
for each row
execute function public.reset_product_sold_presentation_on_restock();

create or replace function public.reset_inventory_sold_presentation_on_restock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.quantity, 0) > 0
     and new.status in ('draft', 'active', 'reserved')
     and (
       coalesce(old.quantity, 0) <= 0
       or old.status in ('sold', 'archived')
       or old.sold_at is not null
       or old.archive_after is not null
       or old.archived_at is not null
     ) then
    new.sold_at := null;
    new.sold_price := null;
    new.sold_source := null;
    new.sold_reference := null;
    new.sold_price_status := 'unresolved';
    new.sold_evidence := '{}'::jsonb;
    new.archive_after := null;
    new.archived_at := null;
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      - 'ebay_not_active_at_last_full_sync';
  end if;

  return new;
end;
$$;

drop trigger if exists reset_inventory_sold_presentation_on_restock
  on public.inventory_items;
create trigger reset_inventory_sold_presentation_on_restock
before update of quantity, status on public.inventory_items
for each row
execute function public.reset_inventory_sold_presentation_on_restock();

create or replace function public.reset_collectible_asset_sold_presentation_on_restock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.quantity, 0) <= 0
     or new.status not in ('draft', 'active', 'reserved') then
    return new;
  end if;

  if coalesce(old.quantity, 0) > 0
     and old.status not in ('sold', 'archived') then
    return new;
  end if;

  update public.collectible_assets
     set sold_price = null,
         sold_at = null,
         sold_order_id = null,
         sold_source = null,
         sold_reference = null,
         sold_currency = 'USD',
         sold_price_status = 'unresolved',
         sold_price_evidence = '{}'::jsonb,
         archive_after = null,
         archived_at = null
   where store_id = new.store_id
     and (
       inventory_item_id = new.id
       or legacy_product_id = new.legacy_product_id
     );

  return new;
end;
$$;

drop trigger if exists reset_collectible_asset_sold_presentation_on_restock
  on public.inventory_items;
create trigger reset_collectible_asset_sold_presentation_on_restock
after update of quantity, status on public.inventory_items
for each row
execute function public.reset_collectible_asset_sold_presentation_on_restock();

revoke all on function public.reset_product_sold_presentation_on_restock()
  from public, anon, authenticated;
revoke all on function public.reset_inventory_sold_presentation_on_restock()
  from public, anon, authenticated;
revoke all on function public.reset_collectible_asset_sold_presentation_on_restock()
  from public, anon, authenticated;

comment on function public.reset_product_sold_presentation_on_restock() is
  'Clears only the current public SOLD/archive presentation when stock returns; immutable collectible_sales history remains untouched for InstaComp.';

commit;
