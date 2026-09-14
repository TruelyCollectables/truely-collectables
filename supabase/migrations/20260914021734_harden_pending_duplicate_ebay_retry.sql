alter table public.ebay_quantity_sync_outbox
  add column if not exists desired_price numeric;

alter table public.ebay_quantity_sync_outbox
  drop constraint if exists ebay_quantity_sync_outbox_source_type_check;

alter table public.ebay_quantity_sync_outbox
  add constraint ebay_quantity_sync_outbox_source_type_check
  check (source_type in (
    'checkout_reservation',
    'order_inventory_consumption',
    'manual_sale',
    'duplicate_merge'
  ));

alter table public.ebay_quantity_sync_outbox
  drop constraint if exists ebay_quantity_sync_outbox_desired_price_check;

alter table public.ebay_quantity_sync_outbox
  add constraint ebay_quantity_sync_outbox_desired_price_check
  check (desired_price is null or desired_price > 0);

create or replace function public.tcos_merge_pending_duplicate_inventory(
  p_store_id uuid,
  p_draft_inventory_item_id uuid,
  p_existing_inventory_item_id uuid,
  p_existing_product_id bigint,
  p_expected_draft_updated_at timestamptz,
  p_expected_existing_updated_at timestamptz,
  p_action text,
  p_requested_price numeric default null,
  p_match_key text default null,
  p_decided_by text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_draft public.inventory_items%rowtype;
  v_existing public.inventory_items%rowtype;
  v_draft_product public.products%rowtype;
  v_existing_product public.products%rowtype;
  v_added_quantity integer;
  v_previous_quantity integer;
  v_merged_quantity integer;
  v_final_price numeric;
begin
  if p_action not in ('merge_keep_price', 'merge_change_price') then
    raise exception 'TCOS_DUPLICATE_INVALID_ACTION';
  end if;

  select * into v_draft
  from public.inventory_items
  where id = p_draft_inventory_item_id
    and store_id = p_store_id
  for update;

  if not found or v_draft.status <> 'draft' or coalesce(v_draft.quantity, 0) <= 0 then
    raise exception 'TCOS_DUPLICATE_DRAFT_CHANGED';
  end if;
  if v_draft.updated_at is distinct from p_expected_draft_updated_at then
    raise exception 'TCOS_DUPLICATE_DRAFT_STALE';
  end if;

  select * into v_existing
  from public.inventory_items
  where id = p_existing_inventory_item_id
    and store_id = p_store_id
    and legacy_product_id = p_existing_product_id
  for update;

  if not found or v_existing.status <> 'active' or coalesce(v_existing.quantity, 0) <= 0 then
    raise exception 'TCOS_DUPLICATE_KEEPER_CHANGED';
  end if;
  if v_existing.updated_at is distinct from p_expected_existing_updated_at then
    raise exception 'TCOS_DUPLICATE_KEEPER_STALE';
  end if;

  if nullif(trim(v_draft.metadata #>> '{collectible_asset,exact_serial_number}'), '') is not null
     or nullif(trim(v_draft.metadata #>> '{collectible_asset,grading_cert_number}'), '') is not null
     or nullif(trim(v_draft.metadata #>> '{instacomp,ai,gradingCertNumber}'), '') is not null
     or nullif(trim(v_draft.metadata #>> '{instacomp,ai,certificationNumber}'), '') is not null
     or nullif(trim(v_existing.metadata #>> '{collectible_asset,exact_serial_number}'), '') is not null
     or nullif(trim(v_existing.metadata #>> '{collectible_asset,grading_cert_number}'), '') is not null
     or nullif(trim(v_existing.metadata #>> '{instacomp,ai,gradingCertNumber}'), '') is not null
     or nullif(trim(v_existing.metadata #>> '{instacomp,ai,certificationNumber}'), '') is not null then
    raise exception 'TCOS_DUPLICATE_UNIQUE_PHYSICAL_COPY';
  end if;

  if v_draft.legacy_product_id is null then
    raise exception 'TCOS_DUPLICATE_DRAFT_PRODUCT_MISSING';
  end if;

  select * into v_existing_product
  from public.products
  where id = p_existing_product_id
    and store_id = p_store_id
  for update;

  if not found
     or v_existing_product.archived_at is not null
     or coalesce(v_existing_product.quantity, 0) <= 0 then
    raise exception 'TCOS_DUPLICATE_KEEPER_PRODUCT_CHANGED';
  end if;

  select * into v_draft_product
  from public.products
  where id = v_draft.legacy_product_id
    and store_id = p_store_id
  for update;

  if not found or v_draft_product.archived_at is not null then
    raise exception 'TCOS_DUPLICATE_DRAFT_PRODUCT_CHANGED';
  end if;
  if v_existing_product.quantity <> v_existing.quantity then
    raise exception 'TCOS_DUPLICATE_KEEPER_QUANTITY_DRIFT';
  end if;

  if v_draft_product.quantity <> v_draft.quantity then
    raise exception 'TCOS_DUPLICATE_DRAFT_QUANTITY_DRIFT';
  end if;

  v_added_quantity := v_draft.quantity;
  v_previous_quantity := v_existing.quantity;
  v_merged_quantity := v_previous_quantity + v_added_quantity;
  v_final_price := case
    when p_action = 'merge_change_price' then p_requested_price
    else coalesce(v_existing.price, v_existing_product.price)
  end;

  if v_final_price is null or v_final_price <= 0 then
    raise exception 'TCOS_DUPLICATE_INVALID_PRICE';
  end if;

  update public.products
  set quantity = v_merged_quantity,
      price = v_final_price,
      listing_status = 'live',
      last_seen_at = v_now
  where id = v_existing_product.id and store_id = p_store_id;
  update public.inventory_items
  set quantity = v_merged_quantity,
      price = v_final_price,
      status = 'active',
      archived_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'duplicate_scan_merge', jsonb_build_object(
          'mergedAt', v_now,
          'sourceInventoryItemId', v_draft.id,
          'sourceLegacyProductId', v_draft.legacy_product_id,
          'previousQuantity', v_previous_quantity,
          'addedQuantity', v_added_quantity,
          'mergedQuantity', v_merged_quantity,
          'previousPrice', coalesce(v_existing.price, v_existing_product.price),
          'finalPrice', v_final_price,
          'action', p_action,
          'decidedBy', p_decided_by,
          'matchKey', p_match_key
        )
      ),
      updated_at = v_now
  where id = v_existing.id and store_id = p_store_id;
  update public.products
  set quantity = 0,
      listing_status = 'archived',
      archived_at = v_now,
      last_seen_at = v_now
  where id = v_draft_product.id and store_id = p_store_id;

  if nullif(btrim(coalesce(v_existing_product.ebay_item_id, '')), '') is not null then
    insert into public.ebay_quantity_sync_outbox as existing (
      store_id, source_type, source_id, legacy_product_id, inventory_item_id,
      sku, ebay_item_id, desired_quantity, desired_price, status,
      next_attempt_at, last_error, updated_at
    ) values (
      p_store_id, 'duplicate_merge', v_draft.id, v_existing_product.id, v_existing.id,
      nullif(btrim(coalesce(v_existing_product.sku, '')), ''),
      nullif(btrim(coalesce(v_existing_product.ebay_item_id, '')), ''),
      v_merged_quantity, v_final_price, 'pending',
      v_now, null, v_now
    )
    on conflict (store_id, source_type, source_id, legacy_product_id)
    do update set
      inventory_item_id = excluded.inventory_item_id,
      sku = excluded.sku,
      ebay_item_id = excluded.ebay_item_id,
      desired_quantity = excluded.desired_quantity,
      desired_price = excluded.desired_price,
      status = 'pending',
      next_attempt_at = excluded.next_attempt_at,
      last_error = null,
      synced_at = null,
      updated_at = excluded.updated_at;
  end if;

  update public.inventory_items
  set quantity = 0,
      status = 'archived',
      archived_at = v_now,
      metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{instacomp}',
        coalesce(metadata->'instacomp', '{}'::jsonb) || jsonb_build_object(
          'duplicateInventoryDecision', jsonb_build_object(
            'mode', p_action,
            'matchKey', p_match_key,
            'existingLegacyProductId', p_existing_product_id,
            'existingInventoryItemId', v_existing.id,
            'mergedQuantity', v_merged_quantity,
            'finalPrice', v_final_price,
            'decidedAt', v_now,
            'decidedBy', p_decided_by
          )
        ),
        true
      ),
      updated_at = v_now
  where id = v_draft.id and store_id = p_store_id;
  return jsonb_build_object(
    'draftInventoryItemId', v_draft.id,
    'existingInventoryItemId', v_existing.id,
    'existingLegacyProductId', p_existing_product_id,
    'previousQuantity', v_previous_quantity,
    'addedQuantity', v_added_quantity,
    'mergedQuantity', v_merged_quantity,
    'finalPrice', v_final_price,
    'action', p_action,
    'matchKey', p_match_key,
    'mergedAt', v_now
  );
end;
$$;

revoke all on function public.tcos_merge_pending_duplicate_inventory(
  uuid, uuid, uuid, bigint, timestamptz, timestamptz, text, numeric, text, text
) from public, anon, authenticated;

grant execute on function public.tcos_merge_pending_duplicate_inventory(
  uuid, uuid, uuid, bigint, timestamptz, timestamptz, text, numeric, text, text
) to service_role;
