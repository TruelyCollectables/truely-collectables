begin;

create table if not exists public.seller_marketplace_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  connection_id uuid references public.seller_marketplace_connections(id) on delete set null,
  provider text not null,
  status text not null default 'processing',
  cursor_offset integer not null default 0,
  scanned_count integer not null default 0,
  matched_count integer not null default 0,
  quantity_reduced_count integer not null default 0,
  sold_count integer not null default 0,
  review_count integer not null default 0,
  failed_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_marketplace_reconciliation_runs_provider_check
    check (provider in ('ebay')),
  constraint seller_marketplace_reconciliation_runs_status_check
    check (status in ('processing', 'completed', 'completed_with_errors', 'failed'))
);

create index if not exists seller_marketplace_reconciliation_runs_account_idx
  on public.seller_marketplace_reconciliation_runs(
    account_id,
    store_id,
    provider,
    created_at desc
  );

create table if not exists public.seller_marketplace_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references public.seller_marketplace_reconciliation_runs(id) on delete cascade,
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  connection_id uuid references public.seller_marketplace_connections(id) on delete set null,
  provider text not null,
  legacy_product_id bigint,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  sku text,
  provider_listing_id text,
  decision text not null,
  reason_codes text[] not null default '{}'::text[],
  local_quantity_before integer,
  remote_quantity integer,
  local_quantity_after integer,
  local_price numeric(12, 2),
  remote_price numeric(12, 2),
  offer_status text,
  listing_status text,
  sold_quantity integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint seller_marketplace_reconciliation_events_provider_check
    check (provider in ('ebay')),
  constraint seller_marketplace_reconciliation_events_decision_check
    check (decision in ('unchanged', 'quantity_reduced', 'sold', 'needs_review', 'failed')),
  unique (run_id, legacy_product_id)
);

create index if not exists seller_marketplace_reconciliation_events_account_idx
  on public.seller_marketplace_reconciliation_events(
    account_id,
    store_id,
    provider,
    created_at desc
  );

create index if not exists seller_marketplace_reconciliation_events_review_idx
  on public.seller_marketplace_reconciliation_events(
    account_id,
    store_id,
    decision,
    created_at desc
  )
  where decision in ('needs_review', 'failed');

alter table public.seller_marketplace_reconciliation_runs enable row level security;
alter table public.seller_marketplace_reconciliation_events enable row level security;

revoke all privileges on table public.seller_marketplace_reconciliation_runs
  from anon, authenticated;
revoke all privileges on table public.seller_marketplace_reconciliation_events
  from anon, authenticated;
revoke all privileges on table public.seller_marketplace_reconciliation_runs
  from service_role;
revoke all privileges on table public.seller_marketplace_reconciliation_events
  from service_role;

grant select, insert, update on table public.seller_marketplace_reconciliation_runs
  to service_role;
grant select, insert on table public.seller_marketplace_reconciliation_events
  to service_role;

create or replace function public.tcos_apply_seller_ebay_quantity_ceiling(
  p_store_id uuid,
  p_account_id uuid,
  p_legacy_product_id bigint,
  p_remote_quantity integer,
  p_reconciliation_metadata jsonb default '{}'::jsonb
)
returns table (
  legacy_product_id bigint,
  inventory_item_id uuid,
  previous_quantity integer,
  new_quantity integer,
  inventory_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_inventory public.inventory_items%rowtype;
  v_previous_quantity integer;
  v_new_quantity integer;
  v_inventory_status text;
begin
  if p_remote_quantity is null or p_remote_quantity < 0 then
    raise exception 'invalid_remote_quantity'
      using errcode = '22023';
  end if;

  select *
    into v_product
    from public.products
    where id = p_legacy_product_id
      and store_id = p_store_id
      and seller_account_id = p_account_id
    for update;

  if not found then
    raise exception 'seller_inventory_product_not_found'
      using errcode = 'P0002';
  end if;

  v_previous_quantity := greatest(coalesce(v_product.quantity, 0), 0);
  v_new_quantity := least(v_previous_quantity, p_remote_quantity);

  update public.products
    set last_seen_at = now()
    where id = v_product.id
      and store_id = p_store_id
      and seller_account_id = p_account_id;

  select *
    into v_inventory
    from public.inventory_items
    where store_id = p_store_id
      and seller_account_id = p_account_id
      and legacy_product_id = p_legacy_product_id
    order by updated_at desc
    limit 1
    for update;

  if found then
    v_new_quantity := least(
      v_new_quantity,
      greatest(coalesce(v_inventory.quantity, 0), 0)
    );
    v_inventory_status := case
      when v_new_quantity = 0 then 'sold'
      else coalesce(v_inventory.status, 'draft')
    end;

    update public.inventory_items
      set quantity = v_new_quantity,
        status = v_inventory_status,
        metadata = coalesce(v_inventory.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'ebay_reconciliation',
            coalesce(p_reconciliation_metadata, '{}'::jsonb)
              || jsonb_build_object(
                'applied_at', now(),
                'quantity_before', v_previous_quantity,
                'quantity_after', v_new_quantity
              )
          ),
        updated_at = now()
      where id = v_inventory.id
        and store_id = p_store_id
        and seller_account_id = p_account_id;
  else
    v_inventory_status := case when v_new_quantity = 0 then 'sold' else 'draft' end;
  end if;

  update public.products
    set quantity = v_new_quantity,
      last_seen_at = now()
    where id = v_product.id
      and store_id = p_store_id
      and seller_account_id = p_account_id;

  return query
    select
      v_product.id::bigint,
      case when v_inventory.id is not null then v_inventory.id else null::uuid end,
      v_previous_quantity,
      v_new_quantity,
      v_inventory_status;
end;
$$;

revoke all on function public.tcos_apply_seller_ebay_quantity_ceiling(
  uuid,
  uuid,
  bigint,
  integer,
  jsonb
) from public, anon, authenticated;

grant execute on function public.tcos_apply_seller_ebay_quantity_ceiling(
  uuid,
  uuid,
  bigint,
  integer,
  jsonb
) to service_role;

commit;
