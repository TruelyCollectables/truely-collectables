-- TCOS Checklist Registry™ + Release Calendar™ core schema
-- Private, service-role-only foundation for release tracking, source versioning,
-- normalized checklist data, deterministic card identities, and validation.

create extension if not exists pgcrypto;

create or replace function public.tcos_checklist_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.tcos_checklist_reject_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'TCOS Checklist Registry history rows are append-only';
end;
$$;

create table if not exists public.checklist_manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  official_website_url text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_brands (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references public.checklist_manufacturers(id) on delete restrict,
  name text not null,
  slug text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (manufacturer_id, slug)
);

create table if not exists public.checklist_sports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_leagues (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.checklist_sports(id) on delete restrict,
  name text not null,
  slug text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sport_id, slug)
);

create table if not exists public.checklist_players (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  normalized_name text not null,
  birth_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name, birth_date)
);

create unique index if not exists checklist_players_name_without_birth_unique
  on public.checklist_players(normalized_name)
  where birth_date is null;

create table if not exists public.checklist_teams (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.checklist_sports(id) on delete restrict,
  league_id uuid references public.checklist_leagues(id) on delete set null,
  canonical_name text not null,
  normalized_name text not null,
  city text,
  abbreviation text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists checklist_teams_scope_name_unique
  on public.checklist_teams(sport_id, coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_name);

create table if not exists public.checklist_player_aliases (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.checklist_players(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text,
  created_at timestamptz not null default now(),
  unique (player_id, normalized_alias)
);

create index if not exists checklist_player_aliases_lookup_idx
  on public.checklist_player_aliases(normalized_alias);

create table if not exists public.checklist_team_aliases (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.checklist_teams(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text,
  created_at timestamptz not null default now(),
  unique (team_id, normalized_alias)
);

create index if not exists checklist_team_aliases_lookup_idx
  on public.checklist_team_aliases(normalized_alias);

create table if not exists public.checklist_releases (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references public.checklist_manufacturers(id) on delete restrict,
  brand_id uuid references public.checklist_brands(id) on delete set null,
  sport_id uuid not null references public.checklist_sports(id) on delete restrict,
  league_id uuid references public.checklist_leagues(id) on delete set null,
  product_name text not null,
  slug text not null,
  release_year text,
  season text,
  license_name text,
  product_configurations jsonb not null default '[]'::jsonb,
  announcement_date date,
  original_release_date date,
  current_release_date date,
  checklist_publication_date date,
  actual_release_date date,
  official_product_url text,
  official_checklist_url text,
  odds_file_url text,
  release_status text not null default 'announced'
    check (release_status in ('announced','release_date_tentative','release_date_confirmed','delayed','released','canceled')),
  checklist_status text not null default 'pending'
    check (checklist_status in ('pending','detected','live','revised','manual_import_required')),
  import_status text not null default 'not_started'
    check (import_status in ('not_started','queued','importing','validation_required','successful','partial','failed')),
  last_checked_at timestamptz,
  last_successful_check_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (release_year is not null or season is not null)
);

create unique index if not exists checklist_releases_identity_unique
  on public.checklist_releases(
    manufacturer_id,
    coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
    sport_id,
    coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid),
    slug,
    coalesce(release_year, ''),
    coalesce(season, '')
  );

create index if not exists checklist_releases_calendar_idx
  on public.checklist_releases(current_release_date, release_status);

create index if not exists checklist_releases_work_queue_idx
  on public.checklist_releases(checklist_status, import_status, current_release_date);

create table if not exists public.checklist_release_sources (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  source_type text not null
    check (source_type in ('announcement','product_page','release_calendar','checklist_page','checklist_file','odds_file','api','manual')),
  source_url text not null,
  authoritative boolean not null default true,
  access_status text not null default 'not_checked'
    check (access_status in ('not_checked','available','blocked','unavailable','login_gated','unsupported','error')),
  check_frequency_minutes integer check (check_frequency_minutes is null or check_frequency_minutes >= 15),
  last_checked_at timestamptz,
  last_successful_at timestamptz,
  last_http_status integer,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (release_id, source_type, source_url)
);

create table if not exists public.checklist_release_date_revisions (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  release_source_id uuid references public.checklist_release_sources(id) on delete set null,
  date_kind text not null
    check (date_kind in ('announcement_date','original_release_date','current_release_date','checklist_publication_date','actual_release_date')),
  previous_date date,
  new_date date,
  change_reason text,
  source_snapshot jsonb not null default '{}'::jsonb,
  changed_at timestamptz not null default now(),
  check (previous_date is distinct from new_date)
);

create index if not exists checklist_release_date_revisions_release_idx
  on public.checklist_release_date_revisions(release_id, changed_at desc);

create table if not exists public.checklist_release_status_events (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  release_source_id uuid references public.checklist_release_sources(id) on delete set null,
  status_domain text not null check (status_domain in ('release','checklist','import')),
  previous_status text,
  new_status text not null,
  reason text,
  source_snapshot jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (previous_status is distinct from new_status)
);

create index if not exists checklist_release_status_events_release_idx
  on public.checklist_release_status_events(release_id, occurred_at desc);

create table if not exists public.checklist_source_files (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  release_source_id uuid references public.checklist_release_sources(id) on delete set null,
  source_file_type text not null check (source_file_type in ('checklist','odds','product_configuration','other')),
  source_url text not null,
  original_filename text not null,
  storage_bucket text not null default 'tcos-checklist-source-files',
  storage_object_path text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  retrieved_at timestamptz not null default now(),
  manufacturer_version_label text,
  importer_version text,
  import_status text not null default 'queued'
    check (import_status in ('queued','importing','validation_required','successful','partial','failed')),
  validation_status text not null default 'not_started'
    check (validation_status in ('not_started','pending','passed','failed','manual_review')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (release_id, sha256),
  unique (storage_bucket, storage_object_path)
);

create index if not exists checklist_source_files_release_idx
  on public.checklist_source_files(release_id, retrieved_at desc);

create table if not exists public.checklist_versions (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  source_file_id uuid not null references public.checklist_source_files(id) on delete restrict,
  previous_version_id uuid references public.checklist_versions(id) on delete set null,
  version_number integer not null check (version_number > 0),
  manufacturer_version_label text,
  parser_version text not null,
  normalized_schema_version text not null default 'tcos.checklist.normalized.v1',
  status text not null default 'importing'
    check (status in ('importing','validation_required','live','revised','failed','superseded')),
  source_row_count integer not null default 0 check (source_row_count >= 0),
  normalized_card_count integer not null default 0 check (normalized_card_count >= 0),
  normalized_identity_count integer not null default 0 check (normalized_identity_count >= 0),
  imported_at timestamptz,
  validated_at timestamptz,
  activated_at timestamptz,
  is_active boolean not null default false,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (release_id, version_number),
  unique (source_file_id, parser_version, normalized_schema_version)
);

create unique index if not exists checklist_versions_one_active_per_release
  on public.checklist_versions(release_id)
  where is_active;

create table if not exists public.checklist_sets (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  version_id uuid not null references public.checklist_versions(id) on delete cascade,
  parent_set_id uuid references public.checklist_sets(id) on delete set null,
  name text not null,
  normalized_name text not null,
  set_type text not null default 'base'
    check (set_type in ('base','subset','insert','autograph','memorabilia','parallel_group','other')),
  card_number_prefix text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists checklist_sets_version_parent_name_unique
  on public.checklist_sets(
    version_id,
    coalesce(parent_set_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalized_name
  );

create table if not exists public.checklist_cards (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  version_id uuid not null references public.checklist_versions(id) on delete cascade,
  set_id uuid not null references public.checklist_sets(id) on delete cascade,
  card_number text not null,
  normalized_card_number text not null,
  rookie_designation boolean,
  first_bowman_designation boolean,
  autograph_status text not null default 'non-auto',
  memorabilia_status text not null default 'non-memorabilia',
  variation text,
  normalized_variation text,
  print_run integer check (print_run is null or print_run > 0),
  short_print_designation boolean,
  super_short_print_designation boolean,
  checklist_notes text,
  source_row_number integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists checklist_cards_version_set_number_variation_unique
  on public.checklist_cards(
    version_id,
    set_id,
    normalized_card_number,
    coalesce(normalized_variation, '')
  );

create index if not exists checklist_cards_lookup_idx
  on public.checklist_cards(release_id, normalized_card_number);

create table if not exists public.checklist_card_players (
  card_id uuid not null references public.checklist_cards(id) on delete cascade,
  player_id uuid not null references public.checklist_players(id) on delete restrict,
  display_order integer not null default 1 check (display_order > 0),
  role text not null default 'subject',
  primary key (card_id, player_id, role)
);

create table if not exists public.checklist_card_teams (
  card_id uuid not null references public.checklist_cards(id) on delete cascade,
  team_id uuid not null references public.checklist_teams(id) on delete restrict,
  display_order integer not null default 1 check (display_order > 0),
  role text not null default 'card_branding',
  primary key (card_id, team_id, role)
);

create table if not exists public.checklist_parallels (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  version_id uuid not null references public.checklist_versions(id) on delete cascade,
  set_id uuid references public.checklist_sets(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  serial_run integer check (serial_run is null or serial_run > 0),
  print_run integer check (print_run is null or print_run > 0),
  color text,
  pattern text,
  published_odds text,
  configuration_exclusivity text,
  is_base boolean not null default false,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists checklist_parallels_version_set_name_serial_unique
  on public.checklist_parallels(
    version_id,
    coalesce(set_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalized_name,
    coalesce(serial_run, 0)
  );

create table if not exists public.checklist_card_identities (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  version_id uuid not null references public.checklist_versions(id) on delete cascade,
  set_id uuid not null references public.checklist_sets(id) on delete cascade,
  card_id uuid not null references public.checklist_cards(id) on delete cascade,
  parallel_id uuid references public.checklist_parallels(id) on delete restrict,
  identity_schema text not null default 'tcos.checklist.identity.v1',
  canonical_key text not null,
  fingerprint_sha256 text not null check (fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  serial_number_tier text,
  autograph_status text not null default 'non-auto',
  memorabilia_status text not null default 'non-memorabilia',
  variation text,
  configuration_exclusivity text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_schema, fingerprint_sha256)
);

create index if not exists checklist_card_identities_card_idx
  on public.checklist_card_identities(card_id);

create index if not exists checklist_card_identities_release_idx
  on public.checklist_card_identities(release_id, set_id, parallel_id);

create table if not exists public.checklist_import_runs (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  source_file_id uuid not null references public.checklist_source_files(id) on delete restrict,
  checklist_version_id uuid references public.checklist_versions(id) on delete set null,
  importer_name text not null,
  importer_version text not null,
  status text not null default 'queued'
    check (status in ('queued','running','validation_required','successful','partial','failed')),
  source_row_count integer not null default 0 check (source_row_count >= 0),
  imported_row_count integer not null default 0 check (imported_row_count >= 0),
  skipped_row_count integer not null default 0 check (skipped_row_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checklist_import_runs_status_idx
  on public.checklist_import_runs(status, created_at desc);

create table if not exists public.checklist_import_errors (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.checklist_import_runs(id) on delete cascade,
  row_reference text,
  error_code text not null,
  error_message text not null,
  payload jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now()
);

create index if not exists checklist_import_errors_run_idx
  on public.checklist_import_errors(import_run_id, created_at);

create table if not exists public.checklist_validation_queue (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  checklist_version_id uuid references public.checklist_versions(id) on delete cascade,
  card_identity_id uuid references public.checklist_card_identities(id) on delete cascade,
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

create index if not exists checklist_validation_queue_work_idx
  on public.checklist_validation_queue(status, severity, created_at);

create table if not exists public.checklist_revision_diffs (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  previous_version_id uuid not null references public.checklist_versions(id) on delete restrict,
  new_version_id uuid not null references public.checklist_versions(id) on delete restrict,
  entity_type text not null check (entity_type in ('set','card','parallel','identity','release_metadata')),
  change_type text not null check (change_type in ('added','removed','changed')),
  identity_key text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now(),
  check (previous_version_id <> new_version_id)
);

create index if not exists checklist_revision_diffs_versions_idx
  on public.checklist_revision_diffs(previous_version_id, new_version_id, entity_type, change_type);

-- Updated-at triggers for mutable tables.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'checklist_manufacturers','checklist_brands','checklist_sports','checklist_leagues',
    'checklist_players','checklist_teams','checklist_releases','checklist_release_sources',
    'checklist_source_files','checklist_versions','checklist_sets','checklist_cards',
    'checklist_parallels','checklist_card_identities','checklist_import_runs','checklist_validation_queue'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_touch', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.tcos_checklist_touch_updated_at()',
      table_name || '_touch',
      table_name
    );
  end loop;
end;
$$;

-- Release history and version diffs are append-only audit records.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'checklist_release_date_revisions','checklist_release_status_events','checklist_revision_diffs'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_append_only', table_name);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.tcos_checklist_reject_history_mutation()',
      table_name || '_append_only',
      table_name
    );
  end loop;
end;
$$;

-- Initial extensible manufacturer taxonomy.
insert into public.checklist_manufacturers (name, slug)
values
  ('Topps','topps'),
  ('Bowman','bowman'),
  ('Fanatics','fanatics'),
  ('Panini','panini'),
  ('Upper Deck','upper-deck'),
  ('O-Pee-Chee','o-pee-chee'),
  ('Fleer','fleer'),
  ('SkyBox','skybox'),
  ('Leaf','leaf'),
  ('Parkside','parkside'),
  ('Onyx','onyx'),
  ('Wild Card','wild-card'),
  ('SAGE','sage'),
  ('Futera','futera')
on conflict (slug) do update set name = excluded.name, active = true;

-- Initial sport taxonomy. More sports can be added without schema changes.
insert into public.checklist_sports (name, slug)
values
  ('Baseball','baseball'),
  ('Basketball','basketball'),
  ('Football','football'),
  ('Hockey','hockey'),
  ('Soccer','soccer'),
  ('Women''s Soccer','womens-soccer'),
  ('College and NIL','college-nil'),
  ('UFC','ufc'),
  ('Boxing','boxing'),
  ('Wrestling','wrestling'),
  ('Golf','golf'),
  ('Racing','racing'),
  ('Tennis','tennis'),
  ('Lacrosse','lacrosse'),
  ('Multi-sport','multi-sport'),
  ('Other','other')
on conflict (slug) do update set name = excluded.name, active = true;

-- WNBA remains a distinct searchable league under Basketball.
insert into public.checklist_leagues (sport_id, name, slug)
select sport.id, league.name, league.slug
from public.checklist_sports sport
cross join (values
  ('WNBA','wnba'),
  ('NBA','nba')
) as league(name, slug)
where sport.slug = 'basketball'
on conflict (sport_id, slug) do update set name = excluded.name, active = true;

-- Keep the Registry private. Service-role access is explicit; no public policies are created.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'checklist_manufacturers','checklist_brands','checklist_sports','checklist_leagues',
    'checklist_players','checklist_teams','checklist_player_aliases','checklist_team_aliases',
    'checklist_releases','checklist_release_sources','checklist_release_date_revisions',
    'checklist_release_status_events','checklist_source_files','checklist_versions',
    'checklist_sets','checklist_cards','checklist_card_players','checklist_card_teams',
    'checklist_parallels','checklist_card_identities','checklist_import_runs',
    'checklist_import_errors','checklist_validation_queue','checklist_revision_diffs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end;
$$;

grant usage on schema public to service_role;
