begin;
CREATE OR REPLACE FUNCTION public.tcos_claim_checkout_attempt(p_store_id uuid, p_checkout_attempt_id uuid, p_account_id uuid, p_request_fingerprint text, p_stripe_idempotency_key text, p_identity_metadata jsonb)
 RETURNS TABLE(checkout_attempt_row_id uuid, request_status text, fingerprint_matches boolean, claimed boolean, attempt_count integer, stripe_session_id text, tos_acceptance_event_id uuid, tos_accepted_at timestamp with time zone, identity_metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_attempt public.checkout_attempts%rowtype;
  v_claimed boolean := false;
  v_fingerprint_matches boolean := false;
  v_now timestamptz := now();
begin
  select *
    into v_attempt
    from public.checkout_attempts
   where store_id = p_store_id
     and checkout_attempt_id = p_checkout_attempt_id
   for update;

  if not found then
    insert into public.checkout_attempts (
      store_id,
      checkout_attempt_id,
      account_id,
      request_fingerprint,
      stripe_idempotency_key,
      request_status,
      attempt_count,
      identity_metadata,
      lease_expires_at,
      last_attempt_at
    ) values (
      p_store_id,
      p_checkout_attempt_id,
      p_account_id,
      p_request_fingerprint,
      p_stripe_idempotency_key,
      'processing',
      1,
      coalesce(p_identity_metadata, '{}'::jsonb),
      v_now + interval '2 minutes',
      v_now
    )
    on conflict do nothing
    returning * into v_attempt;

    if found then
      v_claimed := true;
      v_fingerprint_matches := true;
    else
      select *
        into v_attempt
        from public.checkout_attempts
       where store_id = p_store_id
         and checkout_attempt_id = p_checkout_attempt_id
       for update;
    end if;
  end if;

  if not v_claimed then
    v_fingerprint_matches :=
      v_attempt.request_fingerprint = p_request_fingerprint
      and v_attempt.stripe_idempotency_key = p_stripe_idempotency_key;

    v_claimed :=
      v_fingerprint_matches
      and (
        v_attempt.request_status = 'failed'
        or (
          v_attempt.request_status = 'processing'
          and coalesce(v_attempt.lease_expires_at, v_attempt.updated_at) <= v_now
        )
      );

    update public.checkout_attempts as ca
       set attempt_count = ca.attempt_count + 1,
           last_attempt_at = v_now,
           request_status = case when v_claimed then 'processing' else ca.request_status end,
           lease_expires_at = case
             when v_claimed then v_now + interval '2 minutes'
             else ca.lease_expires_at
           end,
           last_error = case when v_claimed then null else ca.last_error end,
           updated_at = v_now
     where ca.id = v_attempt.id
     returning ca.* into v_attempt;
  end if;

  return query
  select
    v_attempt.id,
    v_attempt.request_status,
    v_fingerprint_matches,
    v_claimed,
    v_attempt.attempt_count,
    v_attempt.stripe_session_id,
    v_attempt.tos_acceptance_event_id,
    v_attempt.tos_accepted_at,
    v_attempt.identity_metadata;
end;
$function$;
revoke all on function public.tcos_claim_checkout_attempt(uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.tcos_claim_checkout_attempt(uuid, uuid, uuid, text, text, jsonb)
  to service_role;
CREATE OR REPLACE FUNCTION public.tcos_claim_stripe_webhook_event(p_store_id uuid, p_stripe_event_id text, p_event_type text, p_object_id text, p_dedupe_key text, p_stripe_account_id text, p_api_version text, p_livemode boolean, p_payload_sha256 text, p_endpoint_path text)
 RETURNS TABLE(webhook_event_id uuid, event_status text, claimed boolean, attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_event public.stripe_webhook_events%rowtype;
  v_claimed boolean := false;
  v_now timestamptz := now();
begin
  if p_stripe_event_id is null or btrim(p_stripe_event_id) = '' then
    raise exception 'Stripe event id is required' using errcode = '22023';
  end if;

  select *
    into v_event
    from public.stripe_webhook_events
   where store_id = p_store_id
     and (
       stripe_event_id = p_stripe_event_id
       or (p_dedupe_key is not null and dedupe_key = p_dedupe_key)
     )
   for update;

  if not found then
    insert into public.stripe_webhook_events (
      store_id,
      stripe_event_id,
      event_type,
      object_id,
      dedupe_key,
      stripe_account_id,
      api_version,
      livemode,
      payload_sha256,
      endpoint_path,
      event_status,
      attempt_count,
      lease_expires_at,
      metadata
    ) values (
      p_store_id,
      left(p_stripe_event_id, 255),
      left(coalesce(p_event_type, 'unknown'), 255),
      left(p_object_id, 255),
      left(p_dedupe_key, 600),
      left(p_stripe_account_id, 255),
      left(p_api_version, 120),
      coalesce(p_livemode, false),
      p_payload_sha256,
      left(coalesce(p_endpoint_path, 'unknown'), 500),
      'processing',
      1,
      v_now + interval '5 minutes',
      jsonb_build_object('first_endpoint_path', p_endpoint_path)
    )
    on conflict do nothing
    returning * into v_event;

    if found then
      v_claimed := true;
    else
      select *
        into v_event
        from public.stripe_webhook_events
       where store_id = p_store_id
         and (
           stripe_event_id = p_stripe_event_id
           or (p_dedupe_key is not null and dedupe_key = p_dedupe_key)
         )
       for update;
    end if;
  end if;

  if not v_claimed then
    v_claimed :=
      v_event.event_status = 'failed'
      or (
        v_event.event_status = 'processing'
        and coalesce(v_event.lease_expires_at, v_event.updated_at) <= v_now
      );

    update public.stripe_webhook_events as swe
       set attempt_count = swe.attempt_count + 1,
           last_received_at = v_now,
           endpoint_path = left(coalesce(p_endpoint_path, swe.endpoint_path), 500),
           event_status = case when v_claimed then 'processing' else swe.event_status end,
           lease_expires_at = case
             when v_claimed then v_now + interval '5 minutes'
             else swe.lease_expires_at
           end,
           last_error = case when v_claimed then null else swe.last_error end,
           metadata = case
             when swe.stripe_event_id <> p_stripe_event_id
             then swe.metadata || jsonb_build_object(
               'latest_duplicate_stripe_event_id', p_stripe_event_id
             )
             else swe.metadata
           end,
           updated_at = v_now
     where swe.id = v_event.id
     returning swe.* into v_event;
  end if;

  return query
  select v_event.id, v_event.event_status, v_claimed, v_event.attempt_count;
end;
$function$;
revoke all on function public.tcos_claim_stripe_webhook_event(uuid, text, text, text, text, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.tcos_claim_stripe_webhook_event(uuid, text, text, text, text, text, text, boolean, text, text)
  to service_role;
CREATE OR REPLACE FUNCTION public.tcos_cleanup_checkout_e2e(p_store_id uuid, p_test_run_id uuid, p_product_id bigint, p_checkout_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$

declare
  v_order_ids bigint[];
  v_orders_deleted integer := 0;
  v_products_deleted integer := 0;
  v_is_test_product boolean := false;

begin
  select
    coalesce(
      array_agg(order_row.id),
      '{}'::bigint[]
    )
  into v_order_ids
  from public.orders order_row
  where order_row.store_id = p_store_id
    and order_row.is_test = true
    and order_row.test_run_id = p_test_run_id;

  delete from public.order_review_case_packets row_to_delete
  where row_to_delete.store_id = p_store_id
    and row_to_delete.order_id =
        any(v_order_ids);

  delete from public.order_review_case_events row_to_delete
  where row_to_delete.store_id = p_store_id
    and row_to_delete.order_id =
        any(v_order_ids);

  delete from public.order_review_cases row_to_delete
  where row_to_delete.store_id = p_store_id
    and row_to_delete.order_id =
        any(v_order_ids);

  delete from public.financial_adjustment_ledger_entries row_to_delete
  where row_to_delete.store_id = p_store_id
    and row_to_delete.order_id =
        any(v_order_ids);

  delete from public.stripe_post_payment_objects row_to_delete
  where row_to_delete.store_id = p_store_id
    and row_to_delete.order_id =
        any(v_order_ids);

  delete from public.transaction_evidence_reports row_to_delete
  where row_to_delete.store_id = p_store_id
    and row_to_delete.order_id =
        any(v_order_ids);

  delete from public.orders order_row
  where order_row.store_id = p_store_id
    and order_row.is_test = true
    and order_row.test_run_id = p_test_run_id;

  get diagnostics
    v_orders_deleted = row_count;

  select exists (
    select 1
    from public.products product
    where product.store_id = p_store_id
      and product.id = p_product_id
      and product.ebay_item_id is null
      and product.title like '[TCOS TEST]%'
  )
  into v_is_test_product;

  if v_is_test_product then
    delete from public.inventory_items inventory
    where inventory.store_id = p_store_id
      and inventory.legacy_product_id =
          p_product_id;

    delete from public.products product
    where product.store_id = p_store_id
      and product.id = p_product_id
      and product.ebay_item_id is null
      and product.title like '[TCOS TEST]%';

    get diagnostics
      v_products_deleted = row_count;
  end if;

  delete from public.checkout_attempts attempt
  where attempt.store_id = p_store_id
    and attempt.checkout_attempt_id =
        p_checkout_attempt_id;

  delete from public.tos_acceptance_events acceptance
  where acceptance.store_id = p_store_id
    and acceptance.context_type = 'checkout'
    and acceptance.context_id =
        p_checkout_attempt_id::text;

  return jsonb_build_object(
    'orders_deleted',
    v_orders_deleted,

    'products_deleted',
    v_products_deleted,

    'test_product_confirmed',
    v_is_test_product
  );
end;

$function$;
revoke all on function public.tcos_cleanup_checkout_e2e(uuid, uuid, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.tcos_cleanup_checkout_e2e(uuid, uuid, bigint, uuid)
  to service_role;
CREATE OR REPLACE FUNCTION public.tcos_consume_checkout_reservation_after_sale(p_store_id uuid, p_checkout_attempt_id uuid, p_legacy_product_id bigint, p_quantity integer, p_stripe_session_id text)
 RETURNS TABLE(inventory_item_id uuid, previous_quantity integer, new_quantity integer, already_consumed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$

declare
  v_reservation
    public.checkout_inventory_reservations%rowtype;

  v_inventory
    public.inventory_items%rowtype;

  v_previous integer;
  v_new integer;

begin
  if p_store_id is null
     or p_checkout_attempt_id is null
     or p_legacy_product_id is null then
    raise exception
      'reservation_consume_not_found:%',
      p_legacy_product_id;
  end if;

  if p_quantity is null
     or p_quantity <= 0 then
    raise exception
      'reservation_consume_quantity_invalid';
  end if;

  if p_stripe_session_id is null
     or btrim(p_stripe_session_id) = '' then
    raise exception
      'reservation_consume_session_missing';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_store_id::text
      || ':'
      || p_legacy_product_id::text,
      0
    )
  );

  select reservation.*
  into v_reservation
  from public.checkout_inventory_reservations reservation
  where reservation.store_id = p_store_id
    and reservation.checkout_attempt_id =
        p_checkout_attempt_id
    and reservation.legacy_product_id =
        p_legacy_product_id
  for update;

  if not found then
    raise exception
      'reservation_consume_not_found:%',
      p_legacy_product_id;
  end if;

  if v_reservation.stripe_session_id
       is distinct from
     p_stripe_session_id then
    raise exception
      'reservation_consume_session_mismatch:%',
      p_legacy_product_id;
  end if;

  if v_reservation.quantity <> p_quantity then
    raise exception
      'reservation_consume_quantity_mismatch:%',
      p_legacy_product_id;
  end if;

  select inventory.*
  into v_inventory
  from public.inventory_items inventory
  where inventory.id =
        v_reservation.inventory_item_id
    and inventory.store_id =
        p_store_id
    and inventory.legacy_product_id =
        p_legacy_product_id
  for update;

  if not found then
    raise exception
      'inventory_product_not_found:%',
      p_legacy_product_id;
  end if;

  if v_reservation.status = 'consumed' then
    inventory_item_id :=
      v_inventory.id;

    previous_quantity :=
      coalesce(v_inventory.quantity, 0);

    new_quantity :=
      coalesce(v_inventory.quantity, 0);

    already_consumed := true;

    return next;
    return;
  end if;

  -- A delayed paid webhook may arrive after the reservation
  -- expiration time. A matching Stripe session remains the
  -- ownership proof.
  if v_reservation.status not in (
    'active',
    'expired'
  ) then
    raise exception
      'reservation_consume_not_active:%',
      p_legacy_product_id;
  end if;

  v_previous :=
    coalesce(v_inventory.quantity, 0);

  if v_previous < p_quantity then
    raise exception
      'insufficient_inventory:%',
      p_legacy_product_id;
  end if;

  v_new :=
    v_previous - p_quantity;

  update public.inventory_items inventory
  set
    quantity = v_new,

    status = case
      when v_new > 0 then 'active'
      else 'sold'
    end,

    updated_at = now()
  where inventory.id = v_inventory.id
    and inventory.store_id = p_store_id;

  update public.products product
  set quantity = v_new
  where product.id = p_legacy_product_id
    and product.store_id = p_store_id;

  if not found then
    raise exception
      'inventory_legacy_product_not_found:%',
      p_legacy_product_id;
  end if;

  update public.checkout_inventory_reservations reservation
  set
    status = 'consumed',
    consumed_at = now(),
    released_at = null,
    updated_at = now()
  where reservation.id = v_reservation.id;

  inventory_item_id :=
    v_inventory.id;

  previous_quantity :=
    v_previous;

  new_quantity :=
    v_new;

  already_consumed := false;

  return next;
end;

$function$;
revoke all on function public.tcos_consume_checkout_reservation_after_sale(uuid, uuid, bigint, integer, text)
  from public, anon, authenticated;
grant execute on function public.tcos_consume_checkout_reservation_after_sale(uuid, uuid, bigint, integer, text)
  to service_role;
CREATE OR REPLACE FUNCTION public.tcos_decrement_order_inventory_once(p_store_id uuid, p_order_id bigint, p_legacy_product_id bigint, p_quantity integer)
 RETURNS TABLE(inventory_item_id uuid, previous_quantity integer, new_quantity integer, already_consumed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$

declare
  v_existing
    public.order_inventory_consumptions%rowtype;

  v_inventory
    public.inventory_items%rowtype;

  v_previous integer;
  v_new integer;
  v_other_reserved integer;

begin
  if p_store_id is null
     or p_order_id is null
     or p_legacy_product_id is null then
    raise exception
      'order_inventory_order_not_found';
  end if;

  if p_quantity is null
     or p_quantity <= 0 then
    raise exception
      'order_inventory_quantity_invalid';
  end if;

  perform 1
  from public.orders order_row
  where order_row.id = p_order_id
    and order_row.store_id = p_store_id;

  if not found then
    raise exception
      'order_inventory_order_not_found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_store_id::text
      || ':'
      || p_legacy_product_id::text,
      0
    )
  );

  select consumption.*
  into v_existing
  from public.order_inventory_consumptions consumption
  where consumption.store_id = p_store_id
    and consumption.order_id = p_order_id
    and consumption.legacy_product_id =
        p_legacy_product_id;

  if found then
    if v_existing.quantity <> p_quantity then
      raise exception
        'order_inventory_quantity_mismatch:%',
        p_legacy_product_id;
    end if;

    inventory_item_id :=
      v_existing.inventory_item_id;

    previous_quantity :=
      v_existing.previous_quantity;

    new_quantity :=
      v_existing.new_quantity;

    already_consumed := true;

    return next;
    return;
  end if;

  select inventory.*
  into v_inventory
  from public.inventory_items inventory
  where inventory.store_id = p_store_id
    and inventory.legacy_product_id =
        p_legacy_product_id
  for update;

  if not found then
    raise exception
      'inventory_product_not_found:%',
      p_legacy_product_id;
  end if;

  select
    coalesce(
      sum(reservation.quantity),
      0
    )::integer
  into v_other_reserved
  from public.checkout_inventory_reservations reservation
  where reservation.store_id = p_store_id
    and reservation.legacy_product_id =
        p_legacy_product_id
    and reservation.status = 'active'
    and reservation.expires_at > now();

  v_previous :=
    coalesce(v_inventory.quantity, 0);

  if v_previous
       - v_other_reserved
       < p_quantity then
    raise exception
      'insufficient_inventory:%',
      p_legacy_product_id;
  end if;

  v_new :=
    v_previous - p_quantity;

  update public.inventory_items inventory
  set
    quantity = v_new,

    status = case
      when v_new > 0 then 'active'
      else 'sold'
    end,

    updated_at = now()
  where inventory.id = v_inventory.id
    and inventory.store_id = p_store_id;

  update public.products product
  set quantity = v_new
  where product.id = p_legacy_product_id
    and product.store_id = p_store_id;

  if not found then
    raise exception
      'inventory_legacy_product_not_found:%',
      p_legacy_product_id;
  end if;

  insert into public.order_inventory_consumptions (
    store_id,
    order_id,
    legacy_product_id,
    inventory_item_id,
    quantity,
    previous_quantity,
    new_quantity
  )
  values (
    p_store_id,
    p_order_id,
    p_legacy_product_id,
    v_inventory.id,
    p_quantity,
    v_previous,
    v_new
  );

  inventory_item_id :=
    v_inventory.id;

  previous_quantity :=
    v_previous;

  new_quantity :=
    v_new;

  already_consumed := false;

  return next;
end;

$function$;
revoke all on function public.tcos_decrement_order_inventory_once(uuid, bigint, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.tcos_decrement_order_inventory_once(uuid, bigint, bigint, integer)
  to service_role;
CREATE OR REPLACE FUNCTION public.tcos_reserve_checkout_inventory(p_store_id uuid, p_checkout_attempt_id uuid, p_items jsonb, p_ttl_minutes integer DEFAULT 32)
 RETURNS TABLE(reservation_id uuid, legacy_product_id bigint, inventory_item_id uuid, reserved_quantity integer, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$

declare
  v_item jsonb;
  v_product_id bigint;
  v_requested integer;

  v_inventory public.inventory_items%rowtype;
  v_reservation public.checkout_inventory_reservations%rowtype;

  v_has_reservation boolean;
  v_other_reserved integer;

  v_expires_at timestamptz :=
    now()
    +
    make_interval(
      mins =>
        least(
          greatest(
            coalesce(p_ttl_minutes, 32),
            32
          ),
          60
        )
    );

begin
  if p_store_id is null
     or p_checkout_attempt_id is null then
    raise exception 'reservation_cart_invalid';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'reservation_cart_empty';
  end if;

  -- Expire stale reservations, but preserve their Stripe
  -- session IDs so a delayed paid webhook can still prove
  -- which checkout owned the reservation.
  update public.checkout_inventory_reservations reservation
  set
    status = 'expired',
    updated_at = now()
  where reservation.store_id = p_store_id
    and reservation.status = 'active'
    and reservation.expires_at <= now();

  for v_item in
    select item.value
    from jsonb_array_elements(p_items) item
  loop
    begin
      v_product_id :=
        nullif(v_item ->> 'id', '')::bigint;

      v_requested :=
        nullif(v_item ->> 'quantity', '')::integer;
    exception
      when invalid_text_representation
        or numeric_value_out_of_range then
        raise exception 'reservation_cart_invalid';
    end;

    if v_product_id is null
       or v_requested is null
       or v_requested <= 0 then
      raise exception 'reservation_cart_invalid';
    end if;

    -- Serialize all reservation and consumption changes for
    -- this store/product.
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_store_id::text
        || ':'
        || v_product_id::text,
        0
      )
    );

    v_has_reservation := false;

    select reservation.*
    into v_reservation
    from public.checkout_inventory_reservations reservation
    where reservation.store_id = p_store_id
      and reservation.checkout_attempt_id =
          p_checkout_attempt_id
      and reservation.legacy_product_id =
          v_product_id
    for update;

    v_has_reservation := found;

    if v_has_reservation then
      if v_reservation.status = 'consumed' then
        raise exception
          'reservation_cart_consumed:%',
          v_product_id;
      end if;

      -- Never replace an open reservation that has already
      -- been attached to a Stripe Checkout Session.
      if v_reservation.status = 'active'
         and v_reservation.stripe_session_id is not null then
        raise exception
          'reservation_cart_session_attached:%',
          v_product_id;
      end if;

      -- An expired reservation with a Stripe session may
      -- still receive a delayed successful-payment webhook.
      if v_reservation.status = 'expired'
         and v_reservation.stripe_session_id is not null then
        raise exception
          'reservation_cart_expired_session_attached:%',
          v_product_id;
      end if;
    end if;

    select inventory.*
    into v_inventory
    from public.inventory_items inventory
    where inventory.store_id = p_store_id
      and inventory.legacy_product_id =
          v_product_id
    for update;

    if not found then
      raise exception
        'inventory_product_not_found:%',
        v_product_id;
    end if;

    if v_inventory.status <> 'active' then
      raise exception
        'inventory_not_active:%',
        v_product_id;
    end if;

    select
      coalesce(
        sum(reservation.quantity),
        0
      )::integer
    into v_other_reserved
    from public.checkout_inventory_reservations reservation
    where reservation.store_id = p_store_id
      and reservation.legacy_product_id =
          v_product_id
      and reservation.status = 'active'
      and reservation.expires_at > now()
      and reservation.checkout_attempt_id <>
          p_checkout_attempt_id;

    if coalesce(v_inventory.quantity, 0)
       - v_other_reserved
       < v_requested then
      raise exception
        'insufficient_inventory:%',
        v_product_id;
    end if;

    if v_has_reservation then
      update public.checkout_inventory_reservations reservation
      set
        inventory_item_id = v_inventory.id,
        quantity = v_requested,
        status = 'active',
        stripe_session_id = null,
        expires_at = v_expires_at,
        consumed_at = null,
        released_at = null,
        updated_at = now()
      where reservation.id = v_reservation.id
      returning reservation.*
      into v_reservation;
    else
      insert into public.checkout_inventory_reservations (
        store_id,
        checkout_attempt_id,
        legacy_product_id,
        inventory_item_id,
        quantity,
        status,
        expires_at,
        updated_at
      )
      values (
        p_store_id,
        p_checkout_attempt_id,
        v_product_id,
        v_inventory.id,
        v_requested,
        'active',
        v_expires_at,
        now()
      )
      returning *
      into v_reservation;
    end if;

    reservation_id :=
      v_reservation.id;

    legacy_product_id :=
      v_reservation.legacy_product_id;

    inventory_item_id :=
      v_reservation.inventory_item_id;

    reserved_quantity :=
      v_reservation.quantity;

    expires_at :=
      v_reservation.expires_at;

    return next;
  end loop;
end;

$function$;
revoke all on function public.tcos_reserve_checkout_inventory(uuid, uuid, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.tcos_reserve_checkout_inventory(uuid, uuid, jsonb, integer)
  to service_role;
notify pgrst, 'reload schema';

commit;
