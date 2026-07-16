create table if not exists public.tcos_card_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  identity_fingerprint text not null unique,
  title text not null,
  year text,
  brand text,
  set_name text,
  card_number text,
  player text,
  parallel text,
  variation text,
  serial_run text,
  serial_number text,
  team text,
  sport text,
  is_rookie boolean not null default false,
  is_auto boolean not null default false,
  is_relic boolean not null default false,
  trust_status text not null default 'learning',
  confirmed_count integer not null default 0,
  trust_threshold integer not null default 3,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  trusted_at timestamptz,
  latest_scan_job_id uuid
    references public.instacomp_scan_jobs(id) on delete set null,
  latest_scan_item_id uuid
    references public.instacomp_scan_items(id) on delete set null,
  latest_scan_id text,
  front_image_sha256 text,
  back_image_sha256 text,
  front_storage_path text,
  back_storage_path text,
  ai_result jsonb not null default '{}'::jsonb,
  operator_corrections jsonb not null default '{}'::jsonb,
  catalog_evidence jsonb not null default '{}'::jsonb,
  consensus jsonb not null default '{}'::jsonb,
  market_snapshot jsonb not null default '{}'::jsonb,
  source_coverage jsonb not null default '[]'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tcos_card_knowledge_entries_fingerprint_check
    check (
      identity_fingerprint = btrim(identity_fingerprint)
      and char_length(identity_fingerprint) between 3 and 1000
    ),
  constraint tcos_card_knowledge_entries_title_check
    check (char_length(btrim(title)) between 1 and 500),
  constraint tcos_card_knowledge_entries_trust_status_check
    check (trust_status in ('learning', 'tcos_trusted', 'needs_review')),
  constraint tcos_card_knowledge_entries_count_check
    check (confirmed_count >= 0 and trust_threshold = 3),
  constraint tcos_card_knowledge_entries_ai_object_check
    check (jsonb_typeof(ai_result) = 'object'),
  constraint tcos_card_knowledge_entries_corrections_object_check
    check (jsonb_typeof(operator_corrections) = 'object'),
  constraint tcos_card_knowledge_entries_catalog_object_check
    check (jsonb_typeof(catalog_evidence) = 'object'),
  constraint tcos_card_knowledge_entries_consensus_object_check
    check (jsonb_typeof(consensus) = 'object'),
  constraint tcos_card_knowledge_entries_market_object_check
    check (jsonb_typeof(market_snapshot) = 'object'),
  constraint tcos_card_knowledge_entries_source_coverage_array_check
    check (jsonb_typeof(source_coverage) = 'array'),
  constraint tcos_card_knowledge_entries_payload_object_check
    check (jsonb_typeof(result_payload) = 'object')
);

create table if not exists public.tcos_card_knowledge_observations (
  id uuid primary key default gen_random_uuid(),
  knowledge_entry_id uuid not null
    references public.tcos_card_knowledge_entries(id) on delete cascade,
  source_scan_job_id uuid
    references public.instacomp_scan_jobs(id) on delete set null,
  source_scan_item_id uuid unique
    references public.instacomp_scan_items(id) on delete set null,
  source_scan_id text,
  confirmation_status text not null default 'operator_confirmed',
  title text not null,
  front_image_sha256 text,
  back_image_sha256 text,
  ai_result jsonb not null default '{}'::jsonb,
  operator_corrections jsonb not null default '{}'::jsonb,
  catalog_evidence jsonb not null default '{}'::jsonb,
  consensus jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint tcos_card_knowledge_observations_status_check
    check (
      confirmation_status in (
        'operator_confirmed',
        'scanner_observed',
        'operator_rejected',
        'needs_more_info'
      )
    ),
  constraint tcos_card_knowledge_observations_title_check
    check (char_length(btrim(title)) between 1 and 500),
  constraint tcos_card_knowledge_observations_ai_object_check
    check (jsonb_typeof(ai_result) = 'object'),
  constraint tcos_card_knowledge_observations_corrections_object_check
    check (jsonb_typeof(operator_corrections) = 'object'),
  constraint tcos_card_knowledge_observations_catalog_object_check
    check (jsonb_typeof(catalog_evidence) = 'object'),
  constraint tcos_card_knowledge_observations_consensus_object_check
    check (jsonb_typeof(consensus) = 'object'),
  constraint tcos_card_knowledge_observations_payload_object_check
    check (jsonb_typeof(result_payload) = 'object')
);

alter table public.instacomp_scan_items
  add column if not exists knowledge_entry_id uuid
    references public.tcos_card_knowledge_entries(id) on delete set null,
  add column if not exists knowledge_saved_at timestamptz;

create index if not exists tcos_card_knowledge_entries_trust_idx
  on public.tcos_card_knowledge_entries(trust_status, confirmed_count, updated_at desc);

create index if not exists tcos_card_knowledge_entries_lookup_idx
  on public.tcos_card_knowledge_entries(
    year,
    brand,
    set_name,
    card_number,
    player,
    parallel
  );

create index if not exists tcos_card_knowledge_observations_entry_idx
  on public.tcos_card_knowledge_observations(knowledge_entry_id, confirmation_status);

create index if not exists instacomp_scan_items_knowledge_entry_idx
  on public.instacomp_scan_items(knowledge_entry_id)
  where knowledge_entry_id is not null;

drop trigger if exists tcos_card_knowledge_entries_touch_updated_at
  on public.tcos_card_knowledge_entries;
create trigger tcos_card_knowledge_entries_touch_updated_at
before update on public.tcos_card_knowledge_entries
for each row
execute function public.tcos_touch_instacomp_scan_updated_at();

alter table public.tcos_card_knowledge_entries enable row level security;
alter table public.tcos_card_knowledge_observations enable row level security;

revoke all privileges on table public.tcos_card_knowledge_entries
  from anon, authenticated, service_role;
revoke all privileges on table public.tcos_card_knowledge_observations
  from anon, authenticated, service_role;

grant select, insert, update, delete on table public.tcos_card_knowledge_entries
  to service_role;
grant select, insert, update, delete on table public.tcos_card_knowledge_observations
  to service_role;
