-- TCOS Market Intel™ licensed-card identity discovery queue
-- Safe to run more than once after the core Market Intel schema exists.

create extension if not exists pgcrypto;

create table if not exists public.tcos_mi_identity_candidates (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.tcos_mi_subjects(id) on delete cascade,
  marketplace_id uuid not null references public.tcos_mi_marketplaces(id) on delete cascade,
  external_listing_id text,
  direct_url text not null,
  original_title text not null,
  description text,
  image_urls jsonb not null default '[]'::jsonb,
  asking_price numeric(12,2) not null default 0 check (asking_price >= 0),
  shipping_price numeric(12,2) not null default 0 check (shipping_price >= 0),
  delivered_price numeric(12,2) generated always as (asking_price + shipping_price) stored,
  quantity integer not null default 1 check (quantity > 0),
  unit_delivered_cost numeric(12,2) generated always as ((asking_price + shipping_price) / greatest(quantity, 1)) stored,
  detected_year text,
  detected_manufacturer text,
  detected_brand text,
  detected_product_line text,
  detected_set_name text,
  detected_card_number text,
  detected_parallel_name text,
  detected_insert_name text,
  detected_variation_name text,
  serial_numbered_to integer check (serial_numbered_to is null or serial_numbered_to > 0),
  autograph boolean not null default false,
  memorabilia boolean not null default false,
  rookie_designation boolean not null default false,
  condition_type text not null default 'raw' check (condition_type in ('raw','graded')),
  grading_company text,
  grade text,
  licensed_scope text,
  non_base_reasons jsonb not null default '[]'::jsonb,
  parse_confidence numeric(5,2) not null default 0 check (parse_confidence >= 0 and parse_confidence <= 100),
  status text not null default 'pending' check (status in ('pending','approved','rejected','duplicate','expired')),
  approved_identity_id uuid references public.tcos_mi_collectible_identities(id) on delete set null,
  approved_listing_id uuid references public.tcos_mi_listings(id) on delete set null,
  rejection_reason text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tcos_mi_identity_candidates_marketplace_external_unique
  on public.tcos_mi_identity_candidates(marketplace_id, external_listing_id)
  where external_listing_id is not null;

create unique index if not exists tcos_mi_identity_candidates_direct_url_unique
  on public.tcos_mi_identity_candidates(direct_url);

create index if not exists tcos_mi_identity_candidates_status_score_idx
  on public.tcos_mi_identity_candidates(status, parse_confidence desc, unit_delivered_cost asc);

create index if not exists tcos_mi_identity_candidates_subject_seen_idx
  on public.tcos_mi_identity_candidates(subject_id, last_seen_at desc);

create or replace function public.tcos_mi_touch_identity_candidate_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tcos_mi_identity_candidates_touch on public.tcos_mi_identity_candidates;
create trigger tcos_mi_identity_candidates_touch
before update on public.tcos_mi_identity_candidates
for each row execute function public.tcos_mi_touch_identity_candidate_updated_at();

alter table public.tcos_mi_identity_candidates enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.tcos_mi_identity_candidates to service_role;
