create table if not exists public.account_social_connections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  requester_account_id uuid not null references public.account_profiles(id) on delete cascade,
  target_account_id uuid not null references public.account_profiles(id) on delete cascade,
  connection_type text not null,
  status text not null default 'active',
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_social_connections_no_self_check
    check (requester_account_id <> target_account_id),
  constraint account_social_connections_type_check
    check (connection_type in ('follow', 'friend')),
  constraint account_social_connections_status_check
    check (status in ('active', 'pending', 'accepted', 'declined', 'blocked')),
  constraint account_social_connections_unique
    unique(store_id, requester_account_id, target_account_id, connection_type)
);

create index if not exists account_social_connections_requester_idx
  on public.account_social_connections(store_id, requester_account_id, connection_type, status, updated_at desc);

create index if not exists account_social_connections_target_idx
  on public.account_social_connections(store_id, target_account_id, connection_type, status, updated_at desc);

create table if not exists public.account_brag_posts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  order_id bigint references public.orders(id) on delete set null,
  collection_item_id uuid references public.account_collection_items(id) on delete set null,
  product_id bigint,
  title text not null,
  body text,
  image_url text,
  share_slug text,
  share_url text,
  visibility text not null default 'friends',
  reaction_count integer not null default 0,
  comment_count integer not null default 0,
  click_count integer not null default 0,
  last_click_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_brag_posts_visibility_check
    check (visibility in ('private', 'friends', 'followers', 'community', 'public'))
);

create index if not exists account_brag_posts_account_idx
  on public.account_brag_posts(store_id, account_id, created_at desc);

create index if not exists account_brag_posts_visibility_idx
  on public.account_brag_posts(store_id, visibility, created_at desc);

create index if not exists account_brag_posts_order_idx
  on public.account_brag_posts(store_id, order_id)
  where order_id is not null;

create unique index if not exists account_brag_posts_share_slug_idx
  on public.account_brag_posts(share_slug)
  where share_slug is not null;

create table if not exists public.account_brag_post_clicks (
  id uuid primary key default gen_random_uuid(),
  brag_post_id uuid not null references public.account_brag_posts(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  share_slug text,
  referrer text,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists account_brag_post_clicks_post_created_idx
  on public.account_brag_post_clicks(brag_post_id, created_at desc);

create index if not exists account_brag_post_clicks_store_created_idx
  on public.account_brag_post_clicks(store_id, created_at desc);

create table if not exists public.account_brag_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  sent_to text,
  post_count integer not null default 0,
  click_count integer not null default 0,
  report_json jsonb not null default '{}'::jsonb,
  emailed_at timestamptz,
  email_error text,
  created_at timestamptz not null default now()
);

create index if not exists account_brag_weekly_reports_store_period_idx
  on public.account_brag_weekly_reports(store_id, period_start desc, period_end desc);
