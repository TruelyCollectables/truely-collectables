begin;

create table if not exists public.ebay_quantity_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  source_type text not null check (source_type in ('checkout_reservation', 'order_inventory_consumption')),
  source_id uuid not null,
  order_id bigint references public.orders(id) on delete set null,
  legacy_product_id bigint not null,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  sku text,
  ebay_item_id text,
  desired_quantity integer not null check (desired_quantity >= 0),
  status text not null default 'pending' check (status in ('pending', 'synced', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, source_type, source_id)
);

create index if not exists ebay_quantity_sync_outbox_pending_idx
  on public.ebay_quantity_sync_outbox (store_id, next_attempt_at, created_at)
  where status = 'pending';

create index if not exists ebay_quantity_sync_outbox_product_idx
  on public.ebay_quantity_sync_outbox (store_id, legacy_product_id, status);

alter table public.ebay_quantity_sync_outbox enable row level security;
revoke all on public.ebay_quantity_sync_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.ebay_quantity_sync_outbox to service_role;

create or replace function public.truely_enqueue_ebay_quantity_sync_from_reservation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_quantity integer;
  v_sku text;
  v_ebay_item_id text;
  v_order_id bigint;
begin
  if new.status <> 'consumed' or old.status is not distinct from new.status then
    return new;
  end if;

  select
    greatest(coalesce(inventory.quantity, 0), 0),
    product.sku,
    product.ebay_item_id,
    order_row.id
  into
    v_quantity,
    v_sku,
    v_ebay_item_id,
    v_order_id
  from public.inventory_items inventory
  join public.products product
    on product.store_id = new.store_id
   and product.id = new.legacy_product_id
  left join public.orders order_row
    on order_row.store_id = new.store_id
   and order_row.stripe_session_id = new.stripe_session_id
  where inventory.store_id = new.store_id
    and inventory.id = new.inventory_item_id;

  if not found or (nullif(btrim(coalesce(v_sku, '')), '') is null and nullif(btrim(coalesce(v_ebay_item_id, '')), '') is null) then
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
    'checkout_reservation',
    new.id,
    v_order_id,
    new.legacy_product_id,
    new.inventory_item_id,
    nullif(btrim(coalesce(v_sku, '')), ''),
    nullif(btrim(coalesce(v_ebay_item_id, '')), ''),
    v_quantity,
    'pending',
    now(),
    now()
  )
  on conflict (store_id, source_type, source_id)
  do update set
    order_id = excluded.order_id,
    sku = excluded.sku,
    ebay_item_id = excluded.ebay_item_id,
    desired_quantity = least(existing.desired_quantity, excluded.desired_quantity),
    status = case
      when existing.status = 'synced'
       and existing.desired_quantity <= excluded.desired_quantity
      then existing.status
      else 'pending'
    end,
    next_attempt_at = now(),
    last_error = null,
    updated_at = now();

  return new;
end;
$$;

create or replace function public.truely_enqueue_ebay_quantity_sync_from_order_consumption()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_sku text;
  v_ebay_item_id text;
begin
  select product.sku, product.ebay_item_id
  into v_sku, v_ebay_item_id
  from public.products product
  where product.store_id = new.store_id
    and product.id = new.legacy_product_id;

  if not found or (nullif(btrim(coalesce(v_sku, '')), '') is null and nullif(btrim(coalesce(v_ebay_item_id, '')), '') is null) then
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
    'order_inventory_consumption',
    new.id,
    new.order_id,
    new.legacy_product_id,
    new.inventory_item_id,
    nullif(btrim(coalesce(v_sku, '')), ''),
    nullif(btrim(coalesce(v_ebay_item_id, '')), ''),
    greatest(coalesce(new.new_quantity, 0), 0),
    'pending',
    now(),
    now()
  )
  on conflict (store_id, source_type, source_id)
  do update set
    sku = excluded.sku,
    ebay_item_id = excluded.ebay_item_id,
    desired_quantity = least(existing.desired_quantity, excluded.desired_quantity),
    status = case
      when existing.status = 'synced'
       and existing.desired_quantity <= excluded.desired_quantity
      then existing.status
      else 'pending'
    end,
    next_attempt_at = now(),
    last_error = null,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists truely_enqueue_ebay_quantity_sync_from_reservation
  on public.checkout_inventory_reservations;
create trigger truely_enqueue_ebay_quantity_sync_from_reservation
after update of status on public.checkout_inventory_reservations
for each row
execute function public.truely_enqueue_ebay_quantity_sync_from_reservation();

drop trigger if exists truely_enqueue_ebay_quantity_sync_from_order_consumption
  on public.order_inventory_consumptions;
create trigger truely_enqueue_ebay_quantity_sync_from_order_consumption
after insert on public.order_inventory_consumptions
for each row
execute function public.truely_enqueue_ebay_quantity_sync_from_order_consumption();

create or replace function public.truely_protect_pending_ebay_product_quantity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_pending_quantity integer;
  v_inventory_quantity integer;
  v_safe_quantity integer;
begin
  select min(outbox.desired_quantity)
  into v_pending_quantity
  from public.ebay_quantity_sync_outbox outbox
  where outbox.store_id = new.store_id
    and outbox.legacy_product_id = new.id
    and outbox.status = 'pending';

  if v_pending_quantity is null then
    return new;
  end if;

  select inventory.quantity
  into v_inventory_quantity
  from public.inventory_items inventory
  where inventory.store_id = new.store_id
    and inventory.legacy_product_id = new.id
  order by inventory.updated_at desc nulls last, inventory.id desc
  limit 1;

  v_safe_quantity := least(
    v_pending_quantity,
    coalesce(v_inventory_quantity, old.quantity, new.quantity),
    coalesce(old.quantity, new.quantity)
  );

  if new.quantity > v_safe_quantity then
    new.quantity := greatest(v_safe_quantity, 0);
  end if;

  return new;
end;
$$;

create or replace function public.truely_protect_pending_ebay_inventory_quantity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_pending_quantity integer;
  v_safe_quantity integer;
begin
  select min(outbox.desired_quantity)
  into v_pending_quantity
  from public.ebay_quantity_sync_outbox outbox
  where outbox.store_id = new.store_id
    and outbox.legacy_product_id = new.legacy_product_id
    and outbox.status = 'pending';

  if v_pending_quantity is null then
    return new;
  end if;

  v_safe_quantity := least(
    v_pending_quantity,
    coalesce(old.quantity, new.quantity),
    new.quantity
  );

  if new.quantity > v_safe_quantity then
    new.quantity := greatest(v_safe_quantity, 0);
    new.status := case when new.quantity > 0 then 'active' else 'sold' end;
  end if;

  return new;
end;
$$;

drop trigger if exists truely_protect_pending_ebay_product_quantity
  on public.products;
create trigger truely_protect_pending_ebay_product_quantity
before update of quantity on public.products
for each row
execute function public.truely_protect_pending_ebay_product_quantity();

drop trigger if exists truely_protect_pending_ebay_inventory_quantity
  on public.inventory_items;
create trigger truely_protect_pending_ebay_inventory_quantity
before update of quantity, status on public.inventory_items
for each row
execute function public.truely_protect_pending_ebay_inventory_quantity();

revoke all on function public.truely_enqueue_ebay_quantity_sync_from_reservation() from public, anon, authenticated;
revoke all on function public.truely_enqueue_ebay_quantity_sync_from_order_consumption() from public, anon, authenticated;
revoke all on function public.truely_protect_pending_ebay_product_quantity() from public, anon, authenticated;
revoke all on function public.truely_protect_pending_ebay_inventory_quantity() from public, anon, authenticated;

commit;
