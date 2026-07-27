begin;

-- Keep inventory reserved while a Stripe Checkout Session is attached.
-- checkout.session.expired releases abandoned sessions; a completed session
-- stays protected until the signed completion webhook consumes the reservation.

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
    and reservation.expires_at <= now()
    and reservation.stripe_session_id is null;

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
      and (
        reservation.expires_at > now()
        or reservation.stripe_session_id is not null
      )
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
