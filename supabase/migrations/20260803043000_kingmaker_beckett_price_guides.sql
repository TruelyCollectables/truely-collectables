-- Project KINGMAKER: private Beckett price-guide ingestion and dated reference observations.
-- Source documents and OCR remain service-role-only. Nothing in this migration grants public access.

begin;

create extension if not exists pgcrypto;

create or replace function public.tcos_kingmaker_price_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.tcos_kingmaker_price_normalize(value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select trim(both '-' from regexp_replace(
    regexp_replace(lower(coalesce(value, '')), '&', ' and ', 'g'),
    '[^a-z0-9/]+', '-', 'g'
  ));
$$;

create table if not exists public.tcos_kingmaker_price_guides (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'beckett' check (source = 'beckett'),
  title text not null,
  sport text not null,
  issue_code text,
  edition_date date not null,
  original_filename text not null,
  source_sha256 text not null unique check (source_sha256 ~ '^[a-f0-9]{64}$'),
  page_count integer not null check (page_count > 0),
  price_guide_start_page integer not null check (price_guide_start_page > 0),
  price_guide_end_page integer not null check (price_guide_end_page >= price_guide_start_page),
  parser_version text not null,
  extraction_status text not null default 'uploaded' check (
    extraction_status in ('uploaded','extracting','validation_required','ready','partial','failed')
  ),
  redistribution_allowed boolean not null default false,
  source_storage_bucket text,
  source_storage_object_path text,
  bundle_storage_bucket text,
  bundle_storage_object_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (price_guide_end_page <= page_count),
  check ((source_storage_bucket is null) = (source_storage_object_path is null)),
  check ((bundle_storage_bucket is null) = (bundle_storage_object_path is null))
);

create index if not exists tcos_kingmaker_price_guides_sport_edition_idx
  on public.tcos_kingmaker_price_guides (sport, edition_date desc);

create table if not exists public.tcos_kingmaker_price_import_runs (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.tcos_kingmaker_price_guides(id) on delete restrict,
  run_key text not null unique,
  parser_version text not null,
  status text not null default 'running' check (
    status in ('running','validation_required','succeeded','partial','failed')
  ),
  pages_seen integer not null default 0 check (pages_seen >= 0),
  pages_accepted integer not null default 0 check (pages_accepted >= 0),
  entries_seen integer not null default 0 check (entries_seen >= 0),
  entries_accepted integer not null default 0 check (entries_accepted >= 0),
  entries_review integer not null default 0 check (entries_review >= 0),
  entries_rejected integer not null default 0 check (entries_rejected >= 0),
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tcos_kingmaker_price_import_runs_guide_idx
  on public.tcos_kingmaker_price_import_runs (guide_id, started_at desc);

create table if not exists public.tcos_kingmaker_price_pages (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.tcos_kingmaker_price_guides(id) on delete restrict,
  import_run_id uuid not null references public.tcos_kingmaker_price_import_runs(id) on delete restrict,
  page_number integer not null check (page_number > 0),
  printed_page_number text,
  section_name text,
  image_sha256 text check (image_sha256 is null or image_sha256 ~ '^[a-f0-9]{64}$'),
  ocr_engine text not null,
  ocr_confidence numeric(6,5) check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 1)),
  ocr_text text,
  layout jsonb not null default '{}'::jsonb,
  status text not null default 'parsed' check (
    status in ('parsed','validation_required','accepted','rejected')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guide_id, page_number)
);

create index if not exists tcos_kingmaker_price_pages_review_idx
  on public.tcos_kingmaker_price_pages (guide_id, status, page_number);

create table if not exists public.tcos_kingmaker_price_entries (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.tcos_kingmaker_price_guides(id) on delete restrict,
  import_run_id uuid not null references public.tcos_kingmaker_price_import_runs(id) on delete restrict,
  page_number integer not null check (page_number > 0),
  row_order integer not null check (row_order >= 0),
  source_row_key text not null,
  entry_kind text not null check (
    entry_kind in ('card','complete_set','common','semistar','unlisted_star','wrapper','multiplier','other')
  ),
  release_year text,
  season text,
  manufacturer text,
  brand text,
  product text,
  set_name text,
  parallel_name text,
  card_number text,
  player_name text,
  team_name text,
  rookie_designation boolean,
  autograph_designation boolean,
  memorabilia_designation boolean,
  short_print_designation boolean,
  error_designation boolean,
  variation text,
  serial_run integer check (serial_run is null or serial_run > 0),
  condition_basis text,
  value_low numeric(14,2) check (value_low is null or value_low >= 0),
  value_high numeric(14,2) check (value_high is null or value_high >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  multiplier_low numeric(12,4) check (multiplier_low is null or multiplier_low >= 0),
  multiplier_high numeric(12,4) check (multiplier_high is null or multiplier_high >= 0),
  raw_text text not null,
  parse_confidence numeric(6,5) not null check (parse_confidence >= 0 and parse_confidence <= 1),
  validation_status text not null default 'review' check (
    validation_status in ('accepted','review','rejected')
  ),
  validation_reasons jsonb not null default '[]'::jsonb,
  checklist_identity_id uuid references public.checklist_card_identities(id) on delete set null,
  identity_match_status text not null default 'unmatched' check (
    identity_match_status in ('unmatched','exact','ambiguous','not_applicable','rejected')
  ),
  entity_key text,
  low_observation_id uuid references public.tcos_kingmaker_observations(id) on delete set null,
  high_observation_id uuid references public.tcos_kingmaker_observations(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guide_id, source_row_key),
  check (value_low is not null or value_high is not null or multiplier_low is not null or multiplier_high is not null),
  check (value_low is null or value_high is null or value_low <= value_high)
);

create index if not exists tcos_kingmaker_price_entries_lookup_idx
  on public.tcos_kingmaker_price_entries (
    release_year,
    manufacturer,
    product,
    set_name,
    card_number,
    player_name
  );
create index if not exists tcos_kingmaker_price_entries_review_idx
  on public.tcos_kingmaker_price_entries (validation_status, identity_match_status, parse_confidence);
create index if not exists tcos_kingmaker_price_entries_identity_idx
  on public.tcos_kingmaker_price_entries (checklist_identity_id)
  where checklist_identity_id is not null;

create table if not exists public.tcos_kingmaker_price_review_queue (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.tcos_kingmaker_price_guides(id) on delete restrict,
  entry_id uuid references public.tcos_kingmaker_price_entries(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  issue_type text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','in_review','resolved','dismissed')),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  assigned_to text,
  resolution_notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tcos_kingmaker_price_review_queue_work_idx
  on public.tcos_kingmaker_price_review_queue (status, severity, guide_id, page_number);

create or replace function public.tcos_match_kingmaker_price_entries(p_guide_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_count integer := 0;
  ambiguous_count integer := 0;
  accepted_count integer := 0;
  review_count integer := 0;
begin
  update public.tcos_kingmaker_price_entries entry
  set identity_match_status = 'not_applicable'
  where entry.guide_id = p_guide_id
    and entry.entry_kind <> 'card'
    and entry.identity_match_status = 'unmatched';

  with candidate_rows as (
    select
      entry.id as entry_id,
      array_agg(distinct identity.id order by identity.id) as identity_ids,
      min(identity.canonical_key) as canonical_key,
      count(distinct identity.id) as candidate_count
    from public.tcos_kingmaker_price_entries entry
    join public.checklist_releases release
      on public.tcos_kingmaker_price_normalize(entry.release_year) in (
        public.tcos_kingmaker_price_normalize(release.release_year),
        public.tcos_kingmaker_price_normalize(release.season)
      )
    join public.checklist_manufacturers manufacturer
      on manufacturer.id = release.manufacturer_id
     and public.tcos_kingmaker_price_normalize(entry.manufacturer) =
         public.tcos_kingmaker_price_normalize(manufacturer.name)
    join public.checklist_versions version
      on version.release_id = release.id
     and version.is_active
    join public.checklist_sets set_row
      on set_row.release_id = release.id
     and set_row.version_id = version.id
     and (
       public.tcos_kingmaker_price_normalize(entry.set_name) =
         public.tcos_kingmaker_price_normalize(set_row.name)
       or (
         public.tcos_kingmaker_price_normalize(entry.set_name) = 'base'
         and set_row.set_type = 'base'
       )
     )
    join public.checklist_cards card
      on card.release_id = release.id
     and card.version_id = version.id
     and card.set_id = set_row.id
     and public.tcos_kingmaker_price_normalize(entry.card_number) =
         public.tcos_kingmaker_price_normalize(card.card_number)
    join public.checklist_card_identities identity
      on identity.release_id = release.id
     and identity.version_id = version.id
     and identity.set_id = set_row.id
     and identity.card_id = card.id
    left join public.checklist_parallels parallel
      on parallel.id = identity.parallel_id
    where entry.guide_id = p_guide_id
      and entry.entry_kind = 'card'
      and entry.validation_status <> 'rejected'
      and entry.card_number is not null
      and entry.product is not null
      and public.tcos_kingmaker_price_normalize(release.product_name) in (
        public.tcos_kingmaker_price_normalize(entry.product),
        public.tcos_kingmaker_price_normalize(
          concat_ws(' ', entry.release_year, entry.product)
        )
      )
      and (
        (
          nullif(public.tcos_kingmaker_price_normalize(entry.parallel_name), '') is null
          and identity.parallel_id is null
        )
        or public.tcos_kingmaker_price_normalize(entry.parallel_name) =
           public.tcos_kingmaker_price_normalize(parallel.name)
      )
    group by entry.id
  ), matched_rows as (
    update public.tcos_kingmaker_price_entries entry
    set
      checklist_identity_id = candidates.identity_ids[1],
      identity_match_status = case
        when candidates.candidate_count = 1 then 'exact'
        else 'ambiguous'
      end,
      entity_key = case
        when candidates.candidate_count = 1 then candidates.canonical_key
        else entry.entity_key
      end,
      validation_status = case
        when candidates.candidate_count = 1
          and coalesce(entry.metadata ->> 'sourceEngine', '') = 'text'
          and entry.parse_confidence >= 0.98
        then 'accepted'
        else 'review'
      end,
      validation_reasons = case
        when candidates.candidate_count = 1
          and coalesce(entry.metadata ->> 'sourceEngine', '') = 'text'
          and entry.parse_confidence >= 0.98
        then '[]'::jsonb
        when candidates.candidate_count = 1
        then coalesce(entry.validation_reasons, '[]'::jsonb) ||
             jsonb_build_array('exact_identity_matched_value_verification_required')
        else coalesce(entry.validation_reasons, '[]'::jsonb) ||
             jsonb_build_array('multiple_registry_identities_matched')
      end
    from candidate_rows candidates
    where entry.id = candidates.entry_id
    returning entry.identity_match_status, entry.validation_status
  )
  select
    count(*) filter (where identity_match_status = 'exact'),
    count(*) filter (where identity_match_status = 'ambiguous'),
    count(*) filter (where validation_status = 'accepted'),
    count(*) filter (where validation_status = 'review')
  into matched_count, ambiguous_count, accepted_count, review_count
  from matched_rows;

  insert into public.tcos_kingmaker_price_review_queue (
    guide_id, entry_id, page_number, issue_type, severity, reason, evidence
  )
  select
    entry.guide_id,
    entry.id,
    entry.page_number,
    case
      when entry.identity_match_status = 'ambiguous' then 'identity_ambiguous'
      when entry.identity_match_status = 'unmatched' and entry.entry_kind = 'card' then 'identity_unmatched'
      when entry.identity_match_status = 'exact' and entry.validation_status = 'review' then 'value_verification_required'
      when entry.entry_kind <> 'card' then 'aggregate_reference_review'
      else 'parser_review'
    end,
    case
      when entry.identity_match_status = 'ambiguous' then 'high'
      when entry.identity_match_status = 'exact' and entry.validation_status = 'review' then 'high'
      else 'medium'
    end,
    case
      when entry.identity_match_status = 'ambiguous' then 'More than one active Checklist Registry identity matched this Beckett row.'
      when entry.identity_match_status = 'unmatched' and entry.entry_kind = 'card' then 'No exact active Checklist Registry identity matched this Beckett row.'
      when entry.identity_match_status = 'exact' and entry.validation_status = 'review' then 'Identity matched exactly, but OCR-derived values require visual verification before promotion.'
      when entry.entry_kind <> 'card' then 'Aggregate, wrapper, set, or multiplier rows require operator review before use.'
      else 'Parser marked this row for review.'
    end,
    jsonb_build_object(
      'source_row_key', entry.source_row_key,
      'raw_text', entry.raw_text,
      'validation_reasons', entry.validation_reasons,
      'identity_match_status', entry.identity_match_status,
      'parse_confidence', entry.parse_confidence
    )
  from public.tcos_kingmaker_price_entries entry
  where entry.guide_id = p_guide_id
    and entry.validation_status = 'review'
    and not exists (
      select 1
      from public.tcos_kingmaker_price_review_queue queue
      where queue.entry_id = entry.id
        and queue.status in ('open','in_review')
    );

  return jsonb_build_object(
    'guide_id', p_guide_id,
    'matched', matched_count,
    'ambiguous', ambiguous_count,
    'accepted', accepted_count,
    'review', review_count
  );
end;
$$;

create or replace function public.tcos_promote_kingmaker_price_entries(p_guide_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entry record;
  guide record;
  low_id uuid;
  high_id uuid;
  low_count integer := 0;
  high_count integer := 0;
  evidence_payload jsonb;
  canonical_payload jsonb;
begin
  select * into guide from public.tcos_kingmaker_price_guides where id = p_guide_id;
  if guide.id is null then
    raise exception 'Unknown KINGMAKER price guide %', p_guide_id;
  end if;

  for entry in
    select *
    from public.tcos_kingmaker_price_entries
    where guide_id = p_guide_id
      and validation_status = 'accepted'
      and entity_key is not null
      and (
        entry_kind <> 'card'
        or identity_match_status = 'exact'
      )
    order by page_number, row_order, id
  loop
    evidence_payload := jsonb_strip_nulls(jsonb_build_object(
      'source_kind', 'printed_price_guide',
      'publisher', 'Beckett',
      'guide_id', guide.id,
      'guide_title', guide.title,
      'issue_code', guide.issue_code,
      'edition_date', guide.edition_date,
      'page_number', entry.page_number,
      'source_row_key', entry.source_row_key,
      'entry_kind', entry.entry_kind,
      'release_year', entry.release_year,
      'manufacturer', entry.manufacturer,
      'product', entry.product,
      'set_name', entry.set_name,
      'parallel_name', entry.parallel_name,
      'card_number', entry.card_number,
      'player_name', entry.player_name,
      'condition_basis', entry.condition_basis,
      'checklist_identity_id', entry.checklist_identity_id,
      'parse_confidence', entry.parse_confidence
    ));

    if entry.value_low is not null and entry.low_observation_id is null then
      canonical_payload := jsonb_build_object(
        'source', 'beckett',
        'sourceRecordKey', entry.source_row_key || ':low',
        'entityKey', entry.entity_key,
        'observationType', 'book_value_low',
        'observedAt', (guide.edition_date::timestamptz at time zone 'UTC'),
        'expiresAt', null,
        'confidence', entry.parse_confidence,
        'amount', entry.value_low,
        'currency', entry.currency,
        'directUrl', null,
        'evidence', evidence_payload || jsonb_build_object('value_side', 'low')
      );
      insert into public.tcos_kingmaker_observations (
        source, source_record_key, entity_key, observation_type, observed_at,
        expires_at, confidence, amount, currency, direct_url, evidence, fingerprint
      ) values (
        'beckett', entry.source_row_key || ':low', entry.entity_key, 'book_value_low',
        guide.edition_date::timestamptz, null, entry.parse_confidence, entry.value_low,
        entry.currency, null, evidence_payload || jsonb_build_object('value_side', 'low'),
        encode(digest(canonical_payload::text, 'sha256'), 'hex')
      )
      on conflict (source, source_record_key, fingerprint) do update
        set received_at = excluded.received_at
      returning id into low_id;
      update public.tcos_kingmaker_price_entries set low_observation_id = low_id where id = entry.id;
      low_count := low_count + 1;
    end if;

    if entry.value_high is not null and entry.high_observation_id is null then
      canonical_payload := jsonb_build_object(
        'source', 'beckett',
        'sourceRecordKey', entry.source_row_key || ':high',
        'entityKey', entry.entity_key,
        'observationType', 'book_value_high',
        'observedAt', (guide.edition_date::timestamptz at time zone 'UTC'),
        'expiresAt', null,
        'confidence', entry.parse_confidence,
        'amount', entry.value_high,
        'currency', entry.currency,
        'directUrl', null,
        'evidence', evidence_payload || jsonb_build_object('value_side', 'high')
      );
      insert into public.tcos_kingmaker_observations (
        source, source_record_key, entity_key, observation_type, observed_at,
        expires_at, confidence, amount, currency, direct_url, evidence, fingerprint
      ) values (
        'beckett', entry.source_row_key || ':high', entry.entity_key, 'book_value_high',
        guide.edition_date::timestamptz, null, entry.parse_confidence, entry.value_high,
        entry.currency, null, evidence_payload || jsonb_build_object('value_side', 'high'),
        encode(digest(canonical_payload::text, 'sha256'), 'hex')
      )
      on conflict (source, source_record_key, fingerprint) do update
        set received_at = excluded.received_at
      returning id into high_id;
      update public.tcos_kingmaker_price_entries set high_observation_id = high_id where id = entry.id;
      high_count := high_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'guide_id', p_guide_id,
    'low_observations', low_count,
    'high_observations', high_count
  );
end;
$$;

-- All source data remains private. The dedicated bucket is intentionally non-public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tcos-kingmaker-price-guide-sources',
  'tcos-kingmaker-price-guide-sources',
  false,
  524288000,
  array['application/pdf','application/json','application/x-ndjson','application/zip']::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Mutable tables receive uniform updated_at behavior.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tcos_kingmaker_price_guides',
    'tcos_kingmaker_price_import_runs',
    'tcos_kingmaker_price_pages',
    'tcos_kingmaker_price_entries',
    'tcos_kingmaker_price_review_queue'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_touch', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.tcos_kingmaker_price_touch_updated_at()',
      table_name || '_touch',
      table_name
    );
  end loop;
end;
$$;

alter table public.tcos_kingmaker_price_guides enable row level security;
alter table public.tcos_kingmaker_price_import_runs enable row level security;
alter table public.tcos_kingmaker_price_pages enable row level security;
alter table public.tcos_kingmaker_price_entries enable row level security;
alter table public.tcos_kingmaker_price_review_queue enable row level security;

revoke all on public.tcos_kingmaker_price_guides from anon, authenticated;
revoke all on public.tcos_kingmaker_price_import_runs from anon, authenticated;
revoke all on public.tcos_kingmaker_price_pages from anon, authenticated;
revoke all on public.tcos_kingmaker_price_entries from anon, authenticated;
revoke all on public.tcos_kingmaker_price_review_queue from anon, authenticated;
revoke all on function public.tcos_match_kingmaker_price_entries(uuid) from public, anon, authenticated;
revoke all on function public.tcos_promote_kingmaker_price_entries(uuid) from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.tcos_kingmaker_price_guides to service_role;
grant select, insert, update, delete on public.tcos_kingmaker_price_import_runs to service_role;
grant select, insert, update, delete on public.tcos_kingmaker_price_pages to service_role;
grant select, insert, update, delete on public.tcos_kingmaker_price_entries to service_role;
grant select, insert, update, delete on public.tcos_kingmaker_price_review_queue to service_role;
grant execute on function public.tcos_match_kingmaker_price_entries(uuid) to service_role;
grant execute on function public.tcos_promote_kingmaker_price_entries(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
