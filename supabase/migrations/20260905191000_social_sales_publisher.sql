create table if not exists public.store_social_connections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null check (provider in ('facebook','instagram','threads','pinterest','tiktok','x')),
  connection_status text not null default 'disconnected' check (connection_status in ('connected','disconnected','needs_configuration','error')),
  provider_account_id text,
  provider_account_label text,
  oauth_scope text[] not null default '{}'::text[],
  token_storage_key text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  provider_metadata jsonb not null default '{}'::jsonb,
  last_error text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, provider)
);

create table if not exists public.store_social_connection_tokens (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.store_social_connections(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null check (provider in ('facebook','instagram','threads','pinterest','tiktok','x')),
  encrypted_access_token text,
  encrypted_refresh_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, provider),
  unique (connection_id)
);

create table if not exists public.store_social_posts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  campaign_id uuid not null references public.store_sales_campaigns(id) on delete cascade,
  provider text not null check (provider in ('facebook','instagram','threads','pinterest','tiktok','x')),
  status text not null default 'draft' check (status in ('draft','scheduled','publishing','published','failed')),
  title text,
  text_content text not null default '',
  hashtags text[] not null default '{}'::text[],
  link_url text,
  image_url text,
  image_storage_path text,
  generator text not null default 'template',
  scheduled_for timestamptz,
  provider_post_id text,
  provider_post_url text,
  last_error text,
  generated_at timestamptz not null default now(),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, campaign_id, provider)
);

create table if not exists public.store_social_publish_attempts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  post_id uuid not null references public.store_social_posts(id) on delete cascade,
  campaign_id uuid not null references public.store_sales_campaigns(id) on delete cascade,
  provider text not null,
  outcome text not null check (outcome in ('published','failed','skipped')),
  provider_post_id text,
  provider_post_url text,
  error_message text,
  response_metadata jsonb not null default '{}'::jsonb,
  attempted_at timestamptz not null default now()
);

create index if not exists store_social_posts_due_idx on public.store_social_posts (status, scheduled_for) where status = 'scheduled';
create index if not exists store_social_posts_campaign_idx on public.store_social_posts (store_id, campaign_id, created_at desc);
create index if not exists store_social_publish_attempts_campaign_idx on public.store_social_publish_attempts (store_id, campaign_id, attempted_at desc);

alter table public.store_social_connections enable row level security;
alter table public.store_social_connection_tokens enable row level security;
alter table public.store_social_posts enable row level security;
alter table public.store_social_publish_attempts enable row level security;

revoke all on table public.store_social_connections from anon, authenticated;
revoke all on table public.store_social_connection_tokens from anon, authenticated;
revoke all on table public.store_social_posts from anon, authenticated;
revoke all on table public.store_social_publish_attempts from anon, authenticated;
grant select, insert, update, delete on table public.store_social_connections to service_role;
grant select, insert, update, delete on table public.store_social_connection_tokens to service_role;
grant select, insert, update, delete on table public.store_social_posts to service_role;
grant select, insert, update, delete on table public.store_social_publish_attempts to service_role;

comment on table public.store_social_connections is 'Server-only OAuth connection metadata for store social publishing.';
comment on table public.store_social_connection_tokens is 'Encrypted server-only OAuth tokens for social providers.';
comment on table public.store_social_posts is 'Platform-specific generated/scheduled/published sale promotion posts.';
comment on table public.store_social_publish_attempts is 'Immutable social publishing attempt history.';
