-- Launch 2.0 issue #253: CollX-only inventory is excluded until a direct connector is verified.
-- A future direct connector may remove this guard only after exact-card mapping,
-- quantity/listing-state sync, actual sale price/date/reference ingestion,
-- eBay-linked duplicate prevention, immediate cross-channel stock protection,
-- InstaComp sale-evidence preservation, and race/retry/duplicate/reconciliation tests pass.
create or replace function public.inventory_metadata_mentions_collx(p_metadata jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  source_text text;
begin
  source_text := lower(concat_ws(' ',
    p_metadata ->> 'source_marketplace',
    p_metadata ->> 'sourceMarketplace',
    p_metadata ->> 'marketplace',
    p_metadata ->> 'marketplaces',
    p_metadata ->> 'source_marketplaces',
    p_metadata ->> 'sourceMarketplaces',
    p_metadata ->> 'listing_marketplace',
    p_metadata ->> 'listingMarketplace',
    p_metadata ->> 'inventory_source',
    p_metadata ->> 'inventorySource',
    p_metadata ->> 'source',
    p_metadata ->> 'origin'
  ));
  return source_text ~ '(^|[^a-z0-9])collx([^a-z0-9]|$)';
end;
$$;

create or replace view public.collx_only_inventory_boundary_violations
with (security_invoker = true)
as
select
  i.id as inventory_item_id,
  i.store_id,
  i.legacy_product_id,
  i.sku,
  p.ebay_item_id
from public.inventory_items i
left join public.products p
  on p.store_id = i.store_id
 and (
   p.id = i.legacy_product_id
   or (i.legacy_product_id is null and i.sku is not null and p.sku = i.sku)
 )
where public.inventory_metadata_mentions_collx(i.metadata)
  and nullif(btrim(coalesce(p.ebay_item_id, '')), '') is null;

create or replace function public.enforce_collx_inventory_boundary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_ebay_item_id text;
begin
  if not public.inventory_metadata_mentions_collx(new.metadata) then
    return new;
  end if;

  select nullif(btrim(p.ebay_item_id), '')
    into linked_ebay_item_id
  from public.products p
  where p.store_id = new.store_id
    and (
      p.id = new.legacy_product_id
      or (new.legacy_product_id is null and new.sku is not null and p.sku = new.sku)
    )
  order by (p.id = new.legacy_product_id) desc
  limit 1;

  if linked_ebay_item_id is null then
    raise exception using
      errcode = '23514',
      message = 'COLLX_ONLY_INVENTORY_BLOCKED',
      detail = 'CollX-only inventory cannot be imported or published until a direct CollX inventory-and-sales connector is verified.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_collx_inventory_boundary on public.inventory_items;
create trigger enforce_collx_inventory_boundary
before insert or update of store_id, legacy_product_id, sku, metadata
on public.inventory_items
for each row execute function public.enforce_collx_inventory_boundary();

revoke all on function public.enforce_collx_inventory_boundary() from public, anon, authenticated;
grant execute on function public.enforce_collx_inventory_boundary() to service_role;
