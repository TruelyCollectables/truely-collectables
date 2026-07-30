begin;

create or replace function public.capture_ebay_inactive_collectible_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inactive_at_text text;
  previous_inactive_at_text text;
  inactive_at_value timestamptz;
  listing_id text;
  source_label text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  inactive_at_text := coalesce(new.metadata, '{}'::jsonb)
    ->> 'ebay_not_active_at_last_full_sync';
  previous_inactive_at_text := coalesce(old.metadata, '{}'::jsonb)
    ->> 'ebay_not_active_at_last_full_sync';

  if inactive_at_text is null or btrim(inactive_at_text) = '' then
    return new;
  end if;

  if previous_inactive_at_text is not distinct from inactive_at_text then
    return new;
  end if;

  if new.status <> 'sold' or coalesce(new.quantity, 0) > 0 then
    return new;
  end if;

  begin
    inactive_at_value := inactive_at_text::timestamptz;
  exception when others then
    inactive_at_value := now();
  end;

  listing_id := coalesce(new.metadata, '{}'::jsonb) ->> 'ebay_listing_id';
  source_label := 'ebay_or_collx_via_ebay';

  perform public.record_collectible_sale(
    new.store_id,
    new.legacy_product_id,
    'ebay-inactive:' || new.id::text || ':' || inactive_at_value::text,
    source_label,
    listing_id,
    greatest(coalesce(old.quantity, 0) - coalesce(new.quantity, 0), 1),
    null,
    coalesce(new.currency, 'USD'),
    inactive_at_value,
    'unresolved',
    jsonb_build_object(
      'inventory_item_id', new.id,
      'legacy_product_id', new.legacy_product_id,
      'ebay_listing_id', listing_id,
      'ebay_not_active_at_last_full_sync', inactive_at_value,
      'evidence_source', 'authoritative_ebay_inactive_state',
      'source_chain', 'collx_or_ebay_to_ebay_to_truely_collectables'
    ),
    true
  );

  return new;
end;
$$;

drop trigger if exists capture_ebay_inactive_collectible_sale
  on public.inventory_items;
create trigger capture_ebay_inactive_collectible_sale
after update of status, quantity, metadata on public.inventory_items
for each row
execute function public.capture_ebay_inactive_collectible_sale();

revoke all on function public.capture_ebay_inactive_collectible_sale()
  from public, anon, authenticated;

commit;
