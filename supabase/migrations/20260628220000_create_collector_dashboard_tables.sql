create table if not exists public.account_collection_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  linked_product_id bigint,
  inventory_item_id uuid,
  source_order_id bigint,
  source_order_item_id bigint,
  title text not null,
  category text,
  item_type text not null default 'collectable',
  image_url text,
  acquisition_source text,
  acquisition_price numeric,
  estimated_value numeric,
  value_confidence text,
  grade_company text,
  grade_value text,
  certification_number text,
  condition text,
  ownership_status text not null default 'owned',
  visibility text not null default 'private',
  is_favorite boolean not null default false,
  is_active boolean not null default true,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_collection_items_ownership_status_check
    check (ownership_status in ('owned', 'incoming', 'sold', 'traded', 'archived')),
  constraint account_collection_items_visibility_check
    check (visibility in ('private', 'community', 'public', 'admin_review'))
);

create index if not exists account_collection_items_account_idx
  on public.account_collection_items(account_id, store_id, is_active, created_at desc);

create index if not exists account_collection_items_category_idx
  on public.account_collection_items(store_id, lower(category), created_at desc);

create index if not exists account_collection_items_product_idx
  on public.account_collection_items(store_id, linked_product_id)
  where linked_product_id is not null;

create table if not exists public.account_wish_list_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  wish_type text not null default 'wish_list',
  title text not null,
  category text,
  item_type text not null default 'collectable',
  search_query text,
  player_name text,
  team_name text,
  brand text,
  set_name text,
  release_year text,
  card_number text,
  variant text,
  desired_condition text,
  desired_grade text,
  budget_min numeric,
  budget_max numeric,
  priority text not null default 'normal',
  status text not null default 'active',
  visibility text not null default 'private',
  expires_at timestamptz,
  auto_renew boolean not null default false,
  matched_product_id bigint,
  matched_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_wish_list_items_wish_type_check
    check (wish_type in ('wish_list', 'want_ad', 'set_need', 'trade_target')),
  constraint account_wish_list_items_priority_check
    check (priority in ('low', 'normal', 'high', 'grail')),
  constraint account_wish_list_items_status_check
    check (status in ('active', 'matched', 'fulfilled', 'expired', 'canceled', 'renewed')),
  constraint account_wish_list_items_visibility_check
    check (visibility in ('private', 'community', 'public', 'admin_review'))
);

create index if not exists account_wish_list_items_account_idx
  on public.account_wish_list_items(account_id, store_id, status, created_at desc);

create index if not exists account_wish_list_items_expiry_idx
  on public.account_wish_list_items(store_id, expires_at)
  where status = 'active' and expires_at is not null;

create index if not exists account_wish_list_items_search_idx
  on public.account_wish_list_items(store_id, lower(title), lower(category), status);

create table if not exists public.account_wish_list_matches (
  id uuid primary key default gen_random_uuid(),
  wish_list_item_id uuid not null references public.account_wish_list_items(id) on delete cascade,
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  product_id bigint,
  inventory_item_id uuid,
  match_source text not null default 'manual',
  match_score numeric,
  status text not null default 'candidate',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_wish_list_matches_status_check
    check (status in ('candidate', 'notified', 'dismissed', 'saved', 'purchased'))
);

create index if not exists account_wish_list_matches_item_idx
  on public.account_wish_list_matches(wish_list_item_id, created_at desc);

create index if not exists account_wish_list_matches_account_idx
  on public.account_wish_list_matches(account_id, store_id, status, created_at desc);
