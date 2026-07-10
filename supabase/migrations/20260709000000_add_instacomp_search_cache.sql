create table if not exists public.instacomp_search_cache (
  id uuid primary key default gen_random_uuid(),
  query_hash text not null unique,
  provider text not null,
  normalized_query text not null,
  result_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  hit_count integer not null default 0
);

create index if not exists idx_instacomp_search_cache_expires_at
  on public.instacomp_search_cache (expires_at);

create index if not exists idx_instacomp_search_cache_provider
  on public.instacomp_search_cache (provider, normalized_query);
