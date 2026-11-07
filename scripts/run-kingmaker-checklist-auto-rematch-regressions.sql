\set ON_ERROR_STOP on

begin;

create temp table rematch_fixture_ids (
  release_id uuid,
  source_file_id uuid,
  version_id uuid,
  set_id uuid,
  card_id uuid,
  identity_id uuid,
  guide_id uuid,
  import_run_id uuid,
  entry_id uuid
) on commit drop;

do $$
declare
  manufacturer_id uuid;
  sport_id uuid;
  release_id uuid := gen_random_uuid();
  source_file_id uuid := gen_random_uuid();
  version_id uuid := gen_random_uuid();
  set_id uuid := gen_random_uuid();
  card_id uuid := gen_random_uuid();
  identity_id uuid := gen_random_uuid();
  guide_id uuid := gen_random_uuid();
  import_run_id uuid := gen_random_uuid();
  entry_id uuid := gen_random_uuid();
begin
  select id into manufacturer_id
  from public.checklist_manufacturers
  where slug = 'topps';

  select id into sport_id
  from public.checklist_sports
  where slug = 'baseball';

  if manufacturer_id is null or sport_id is null then
    raise exception 'Checklist taxonomy fixture prerequisites are missing.';
  end if;

  insert into public.checklist_releases (
    id,
    manufacturer_id,
    sport_id,
    product_name,
    slug,
    release_year,
    release_status,
    checklist_status,
    import_status
  ) values (
    release_id,
    manufacturer_id,
    sport_id,
    'Topps Chrome Regression',
    'topps-chrome-regression-' || replace(release_id::text, '-', ''),
    '2026',
    'released',
    'detected',
    'importing'
  );

  insert into public.checklist_source_files (
    id,
    release_id,
    source_file_type,
    source_url,
    original_filename,
    storage_bucket,
    storage_object_path,
    mime_type,
    size_bytes,
    sha256,
    importer_version,
    import_status,
    validation_status
  ) values (
    source_file_id,
    release_id,
    'checklist',
    'https://example.invalid/topps-chrome-regression.csv',
    'topps-chrome-regression.csv',
    'tcos-checklist-source-files',
    'regression/' || source_file_id || '.csv',
    'text/csv',
    128,
    repeat('1', 64),
    'regression-1',
    'importing',
    'pending'
  );

  insert into public.checklist_versions (
    id,
    release_id,
    source_file_id,
    version_number,
    parser_version,
    status,
    source_row_count,
    normalized_card_count,
    normalized_identity_count,
    is_active
  ) values (
    version_id,
    release_id,
    source_file_id,
    1,
    'regression-1',
    'importing',
    1,
    1,
    1,
    false
  );

  insert into public.checklist_sets (
    id,
    release_id,
    version_id,
    name,
    normalized_name,
    set_type
  ) values (
    set_id,
    release_id,
    version_id,
    'Base',
    'base',
    'base'
  );

  insert into public.checklist_cards (
    id,
    release_id,
    version_id,
    set_id,
    card_number,
    normalized_card_number,
    autograph_status,
    memorabilia_status
  ) values (
    card_id,
    release_id,
    version_id,
    set_id,
    '1',
    '1',
    'non-auto',
    'non-memorabilia'
  );

  insert into public.checklist_card_identities (
    id,
    release_id,
    version_id,
    set_id,
    card_id,
    canonical_key,
    fingerprint_sha256,
    autograph_status,
    memorabilia_status
  ) values (
    identity_id,
    release_id,
    version_id,
    set_id,
    card_id,
    'baseball:2026:topps:regression-player:topps-chrome-regression-base:1:raw',
    repeat('2', 64),
    'non-auto',
    'non-memorabilia'
  );

  insert into public.tcos_kingmaker_price_guides (
    id,
    title,
    sport,
    issue_code,
    edition_date,
    original_filename,
    source_sha256,
    page_count,
    price_guide_start_page,
    price_guide_end_page,
    parser_version,
    extraction_status,
    redistribution_allowed
  ) values (
    guide_id,
    'Synthetic Beckett Baseball Regression Guide',
    'Baseball',
    'regression-2026-08',
    '2026-08-01',
    'synthetic-beckett-regression.pdf',
    repeat('3', 64),
    1,
    1,
    1,
    'regression-1',
    'validation_required',
    false
  );

  insert into public.tcos_kingmaker_price_import_runs (
    id,
    guide_id,
    run_key,
    parser_version,
    status,
    pages_seen,
    entries_seen
  ) values (
    import_run_id,
    guide_id,
    'regression:' || guide_id,
    'regression-1',
    'validation_required',
    1,
    1
  );

  insert into public.tcos_kingmaker_price_entries (
    id,
    guide_id,
    import_run_id,
    page_number,
    row_order,
    source_row_key,
    entry_kind,
    release_year,
    manufacturer,
    product,
    set_name,
    card_number,
    player_name,
    condition_basis,
    value_low,
    value_high,
    currency,
    raw_text,
    parse_confidence,
    validation_status,
    validation_reasons,
    identity_match_status,
    entity_key,
    metadata
  ) values (
    entry_id,
    guide_id,
    import_run_id,
    1,
    1,
    repeat('4', 64),
    'card',
    '2026',
    'Topps',
    'Topps Chrome Regression',
    'Base',
    '1',
    'Regression Player',
    'raw',
    10.00,
    20.00,
    'USD',
    '1 Regression Player 10.00 20.00',
    0.95000,
    'review',
    '["ocr_value_verification_required"]'::jsonb,
    'unmatched',
    'baseball:2026:topps:regression-player:topps-chrome-regression-base:1:raw',
    '{"sourceEngine":"tesseract"}'::jsonb
  );

  insert into public.tcos_kingmaker_price_review_queue (
    guide_id,
    entry_id,
    page_number,
    issue_type,
    severity,
    status,
    reason
  ) values (
    guide_id,
    entry_id,
    1,
    'identity_unmatched',
    'medium',
    'open',
    'No exact active Checklist Registry identity matched this Beckett row.'
  );

  insert into rematch_fixture_ids values (
    release_id,
    source_file_id,
    version_id,
    set_id,
    card_id,
    identity_id,
    guide_id,
    import_run_id,
    entry_id
  );
end;
$$;

do $$
declare
  fixture rematch_fixture_ids%rowtype;
  matched_status text;
  matched_identity uuid;
  value_status text;
  promoted_low uuid;
  promoted_high uuid;
  run_status text;
  run_candidates integer;
  run_exact integer;
  old_queue_status text;
  new_queue_count integer;
begin
  select * into fixture from rematch_fixture_ids limit 1;

  update public.checklist_versions
  set
    status = 'live',
    is_active = true,
    imported_at = now(),
    validated_at = now(),
    activated_at = now()
  where id = fixture.version_id;

  select
    identity_match_status,
    checklist_identity_id,
    validation_status,
    low_observation_id,
    high_observation_id
  into
    matched_status,
    matched_identity,
    value_status,
    promoted_low,
    promoted_high
  from public.tcos_kingmaker_price_entries
  where id = fixture.entry_id;

  if matched_status <> 'exact' then
    raise exception 'Expected automatic exact match, got %', matched_status;
  end if;
  if matched_identity <> fixture.identity_id then
    raise exception 'Automatic rematch selected the wrong Checklist Registry identity.';
  end if;
  if value_status <> 'review' then
    raise exception 'OCR value escaped review during automatic rematch.';
  end if;
  if promoted_low is not null or promoted_high is not null then
    raise exception 'Automatic rematch promoted a Beckett value.';
  end if;

  select status
  into old_queue_status
  from public.tcos_kingmaker_price_review_queue
  where entry_id = fixture.entry_id
    and issue_type = 'identity_unmatched'
  order by created_at
  limit 1;

  if old_queue_status <> 'resolved' then
    raise exception 'Old unmatched review item was not resolved.';
  end if;

  select count(*)
  into new_queue_count
  from public.tcos_kingmaker_price_review_queue
  where entry_id = fixture.entry_id
    and issue_type = 'value_verification_required'
    and status = 'open';

  if new_queue_count <> 1 then
    raise exception 'Expected one open value-verification item, found %', new_queue_count;
  end if;

  select status, candidate_entries, exact_after
  into run_status, run_candidates, run_exact
  from public.tcos_kingmaker_beckett_rematch_runs
  where release_id = fixture.release_id
  order by started_at desc
  limit 1;

  if run_status <> 'succeeded' then
    raise exception 'Automatic rematch run did not succeed.';
  end if;
  if run_candidates <> 1 or run_exact <> 1 then
    raise exception 'Unexpected rematch receipt: candidates %, exact %', run_candidates, run_exact;
  end if;
end;
$$;

rollback;

\echo 'KINGMAKER checklist auto-rematch regressions passed.'
