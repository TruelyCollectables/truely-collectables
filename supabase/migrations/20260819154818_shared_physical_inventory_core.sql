create table if not exists public.inventory_shared_stock (
  card_uuid uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  quantity integer not null check (quantity >= 0),
  match_method text not null default 'manual_confirmed',
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_shared_stock_store_idx
  on public.inventory_shared_stock(store_id, card_uuid);
create index if not exists products_store_card_uuid_idx
  on public.products(store_id, card_uuid)
  where card_uuid is not null;
create index if not exists inventory_items_store_card_uuid_idx
  on public.inventory_items(store_id, card_uuid)
  where card_uuid is not null;

alter table public.inventory_shared_stock enable row level security;

create or replace function public.enforce_collx_inventory_boundary()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- CollX is inventory provenance only. CollX-origin inventory is allowed to
  -- remain active even when it has never been listed on eBay. Sales authority
  -- is the Truely Collectables storefront and eBay order history.
  return new;
end;
$function$;

create or replace function public.truely_project_shared_stock_product_quantity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_quantity integer;
begin
  if new.card_uuid is null then
    return new;
  end if;

  select stock.quantity
    into v_quantity
    from public.inventory_shared_stock stock
   where stock.store_id = new.store_id
     and stock.card_uuid = new.card_uuid;

  if found then
    new.quantity := case
      when new.archived_at is null then v_quantity
      else 0
    end;
  end if;

  return new;
end;
$function$;

create or replace function public.truely_project_shared_stock_inventory_quantity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_quantity integer;
begin
  if new.card_uuid is null then
    return new;
  end if;

  select stock.quantity
    into v_quantity
    from public.inventory_shared_stock stock
   where stock.store_id = new.store_id
     and stock.card_uuid = new.card_uuid;

  if found then
    new.quantity := v_quantity;
    new.status := case when v_quantity > 0 then 'active' else 'sold' end;
  end if;

  return new;
end;
$function$;

drop trigger if exists zzz_truely_project_shared_stock_product_quantity on public.products;
create trigger zzz_truely_project_shared_stock_product_quantity
before insert or update of quantity, card_uuid, archived_at on public.products
for each row execute function public.truely_project_shared_stock_product_quantity();

drop trigger if exists zzz_truely_project_shared_stock_inventory_quantity on public.inventory_items;
create trigger zzz_truely_project_shared_stock_inventory_quantity
before insert or update of quantity, status, card_uuid on public.inventory_items
for each row execute function public.truely_project_shared_stock_inventory_quantity();

create or replace function public.truely_link_shared_inventory(
  p_store_id uuid,
  p_legacy_product_ids bigint[],
  p_quantity integer,
  p_match_method text default 'manual_confirmed',
  p_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_card_uuid uuid := gen_random_uuid();
  v_requested_count integer;
  v_found_count integer;
  v_existing_groups integer;
begin
  if p_store_id is null or p_legacy_product_ids is null then
    raise exception 'shared_inventory_link_invalid';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'shared_inventory_quantity_invalid';
  end if;

  select count(distinct value)::integer
    into v_requested_count
    from unnest(p_legacy_product_ids) value;
  if v_requested_count < 2 then
    raise exception 'shared_inventory_requires_two_products';
  end if;

  select count(distinct product.id)::integer,
         count(distinct product.card_uuid) filter (where product.card_uuid is not null)::integer
    into v_found_count, v_existing_groups
    from public.products product
   where product.store_id = p_store_id
     and product.id = any(p_legacy_product_ids);

  if v_found_count <> v_requested_count then
    raise exception 'shared_inventory_product_not_found';
  end if;
  if v_existing_groups > 0 then
    raise exception 'shared_inventory_product_already_linked';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_store_id::text || ':shared-link:' || array_to_string(p_legacy_product_ids, ','),
      0
    )
  );

  insert into public.inventory_shared_stock(card_uuid, store_id, quantity, match_method, evidence)
  values (
    v_card_uuid,
    p_store_id,
    p_quantity,
    coalesce(nullif(btrim(p_match_method), ''), 'manual_confirmed'),
    coalesce(p_evidence, '{}'::jsonb)
  );

  update public.products
     set card_uuid = v_card_uuid,
         quantity = p_quantity
   where store_id = p_store_id
     and id = any(p_legacy_product_ids);

  update public.inventory_items
     set card_uuid = v_card_uuid,
         quantity = p_quantity,
         status = case when p_quantity > 0 then 'active' else 'sold' end,
         updated_at = now()
   where store_id = p_store_id
     and legacy_product_id = any(p_legacy_product_ids);

  return v_card_uuid;
end;
$function$;

create or replace function public.truely_decrement_shared_or_legacy_inventory(
  p_store_id uuid,
  p_legacy_product_id bigint,
  p_quantity integer
)
returns table(
  inventory_item_id uuid,
  previous_quantity integer,
  new_quantity integer,
  shared_card_uuid uuid
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_product public.products%rowtype;
  v_inventory public.inventory_items%rowtype;
  v_stock public.inventory_shared_stock%rowtype;
  v_card_uuid uuid;
  v_previous integer;
  v_new integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_sale_quantity' using errcode = '22023';
  end if;

  select * into v_product
    from public.products
   where store_id = p_store_id and id = p_legacy_product_id
   for update;
  if not found then
    raise exception 'inventory_product_not_found:%', p_legacy_product_id using errcode = 'P0002';
  end if;

  select * into v_inventory
    from public.inventory_items inventory
   where inventory.store_id = p_store_id
     and (
       inventory.legacy_product_id = p_legacy_product_id
       or (v_product.sku is not null and inventory.sku = v_product.sku)
     )
   order by case when inventory.legacy_product_id = p_legacy_product_id then 0 else 1 end,
            inventory.updated_at desc nulls last,
            inventory.id desc
   limit 1
   for update;
  if not found then
    raise exception 'inventory_product_not_found:%', p_legacy_product_id using errcode = 'P0002';
  end if;

  v_card_uuid := coalesce(v_product.card_uuid, v_inventory.card_uuid);

  if v_card_uuid is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(p_store_id::text || ':card:' || v_card_uuid::text, 0)
    );

    select * into v_stock
      from public.inventory_shared_stock stock
     where stock.store_id = p_store_id
       and stock.card_uuid = v_card_uuid
     for update;

    if found then
      v_previous := v_stock.quantity;
      if v_previous < p_quantity then
        raise exception 'insufficient_inventory:%', p_legacy_product_id using errcode = 'P0001';
      end if;
      v_new := v_previous - p_quantity;

      update public.inventory_shared_stock
         set quantity = v_new,
             updated_at = now()
       where store_id = p_store_id
         and card_uuid = v_card_uuid;

      update public.inventory_items
         set quantity = v_new,
             status = case when v_new > 0 then 'active' else 'sold' end,
             updated_at = now()
       where store_id = p_store_id
         and card_uuid = v_card_uuid;

      update public.products
         set quantity = v_new
       where store_id = p_store_id
         and card_uuid = v_card_uuid;

      inventory_item_id := v_inventory.id;
      previous_quantity := v_previous;
      new_quantity := v_new;
      shared_card_uuid := v_card_uuid;
      return next;
      return;
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_store_id::text || ':product:' || p_legacy_product_id::text, 0)
  );
  v_previous := least(coalesce(v_product.quantity, 0), coalesce(v_inventory.quantity, 0));
  if v_previous < p_quantity then
    raise exception 'insufficient_inventory:%', p_legacy_product_id using errcode = 'P0001';
  end if;
  v_new := v_previous - p_quantity;

  update public.products
     set quantity = v_new
   where store_id = p_store_id and id = p_legacy_product_id;

  update public.inventory_items
     set quantity = v_new,
         status = case when v_new > 0 then 'active' else 'sold' end,
         updated_at = now()
   where store_id = p_store_id and id = v_inventory.id;

  inventory_item_id := v_inventory.id;
  previous_quantity := v_previous;
  new_quantity := v_new;
  shared_card_uuid := null;
  return next;
end;
$function$;
