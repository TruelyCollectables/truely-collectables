-- Allow the verified 2026-08-11 CollX migration to create draft-only inventory
-- without weakening the existing CollX/eBay publishing boundary.
create or replace function public.enforce_collx_inventory_boundary()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  linked_product_id bigint;
  linked_product_sku text;
  linked_ebay_item_id text;
begin
  if not public.inventory_metadata_mentions_collx(new.metadata) then
    return new;
  end if;

  select p.id, p.sku, nullif(btrim(p.ebay_item_id), '')
    into linked_product_id, linked_product_sku, linked_ebay_item_id
  from public.products p
  where p.store_id = new.store_id
    and (
      p.id = new.legacy_product_id
      or (new.legacy_product_id is null and new.sku is not null and p.sku = new.sku)
    )
  order by (p.id = new.legacy_product_id) desc
  limit 1;

  if linked_ebay_item_id is null then
    if linked_product_id is not null
       and linked_product_sku = new.sku
       and new.sku like 'COLLX-%'
       and new.status = 'draft'
       and coalesce(new.metadata ->> 'source', '') = 'collx_full_migration_20260811'
       and coalesce(new.metadata ->> 'migrated_not_for_sale', '') = 'true'
    then
      return new;
    end if;

    raise exception using
      errcode = '23514',
      message = 'COLLX_ONLY_INVENTORY_BLOCKED',
      detail = 'CollX-only inventory cannot be imported or published until a direct CollX inventory-and-sales connector is verified.';
  end if;

  return new;
end;
$function$;
