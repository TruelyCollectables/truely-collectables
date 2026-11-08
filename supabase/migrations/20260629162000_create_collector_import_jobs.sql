create table if not exists public.account_collection_import_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  import_type text not null default 'csv',
  source_marketplace text,
  status text not null default 'processing',
  file_name text,
  row_count integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint account_collection_import_jobs_type_check
    check (import_type in ('csv', 'catalog_json', 'provider')),
  constraint account_collection_import_jobs_status_check
    check (status in ('processing', 'completed', 'completed_with_errors', 'failed'))
);

create index if not exists account_collection_import_jobs_account_idx
  on public.account_collection_import_jobs(account_id, store_id, created_at desc);

create index if not exists account_collection_import_jobs_source_idx
  on public.account_collection_import_jobs(store_id, lower(source_marketplace), created_at desc)
  where source_marketplace is not null;
