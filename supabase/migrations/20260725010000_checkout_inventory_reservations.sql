begin;

create table if not exists public.checkout_inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  checkout_attempt_id uuid not null,
  legacy_product_id bigint not null,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active', 'consumed', 'released', 'expired')),
  stripe_session_id text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, checkout_attempt_id, legacy_product_id)
);

create index if not exists checkout_inventory_reservations_active_item_idx
  on public.checkout_inventory_reservations (store_id, legacy_product_id, expires_at)
  where status = 'active';

create index if not exists checkout_inventory_reservations_session_idx
  on public.checkout_inventory_reservations (stripe_session_id)
  where stripe_session_id is not null;

alter table public.checkout_inventory_reservations enable row level security;
revoke all on public.checkout_inventory_reservations from anon, authenticated;

drop function if exists public.tcos_reserve_checkout_inventory(uuid, uuid, jsonb, integer);
create function public.tcos_reserve_checkout_inventory(
  p_store_id uuid,
  p_checkout_attempt_id uuid,
  p_items jsonb,
  p_ttl_minutes integer default 30
)
returns table (
  reservation_id uuid,
  legacy_product_id bigint,
  inventory_item_id uuid,
  reserved_quantity integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_product_id bigint;
  v_requested integer;
  v_inventory public.inventory_items%rowtype;
  v_other_reserved integer;
  v_expires_at timestamptz := now() + make_interval(mins => least(greatest(coalesce(p_ttl_minutes, 30), 30), 60));
  v_reservation public.checkout_inventory_reservations%rowtype;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'reservation_cart_empty';
  end if;

  update public.checkout_inventory_reservations
     set status = 'expired',
         updated_at = now()
   where store_id = p_store_id
     and status = 'active'
     and expires_at <= now();

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item ->> 'id', '')::bigint;
    v_requested := nullif(v_item ->> 'quantity', '')::integer;

    if v_product_id is null or v_requested is null or v_requested <= 0 then
      raise exception 'reservation_cart_invalid';
    end if;

    select *
      into v_inventory
      from public.inventory_items
     where store_id = p_store_id
       and legacy_product_id = v_product_id
     for update;

    if not found then
      raise exception 'inventory_product_not_found:%', v_product_id;
    end if;

    if v_inventory.status <> 'active' then
      raise exception 'inventory_not_active:%', v_product_id;
    end if;

    select coalesce(sum(quantity), 0)::integer
      into v_other_reserved
      from public.checkout_inventory_reservations
     where store_id = p_store_id
       and legacy_product_id = v_product_id
       and status = 'active'
       and expires_at > now()
       and checkout_attempt_id <> p_checkout_attempt_id;

    if coalesce(v_inventory.quantity, 0) - v_other_reserved < v_requested then
      raise exception 'insufficient_inventory:%', v_product_id;
    end if;

    insert into public.checkout_inventory_reservations (
      store_id,
      checkout_attempt_id,
      legacy_product_id,
      inventory_item_id,
      quantity,
      status,
      expires_at,
      updated_at
    ) values (
      p_store_id,
      p_checkout_attempt_id,
      v_product_id,
      v_inventory.id,
      v_requested,
      'active',
      v_expires_at,
      now()
    )
    on conflict (store_id, checkout_attempt_id, legacy_product_id)
    do update set
      inventory_item_id = excluded.inventory_item_id,
      quantity = excluded.quantity,
      status = 'active',
      stripe_session_id = null,
      expires_at = excluded.expires_at,
      consumed_at = null,
      released_at = null,
      updated_at = now()
    returning * into v_reservation;

    reservation_id := v_reservation.id;
    legacy_product_id := v_reservation.legacy_product_id;
    inventory_item_id := v_reservation.inventory_item_id;
    reserved_quantity := v_reservation.quantity;
    expires_at := v_reservation.expires_at;
    return next;
  end loop;
end;
$$;

revoke all on function public.tcos_reserve_checkout_inventory(uuid, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.tcos_reserve_checkout_inventory(uuid, uuid, jsonb, integer) to service_role;

commit;
