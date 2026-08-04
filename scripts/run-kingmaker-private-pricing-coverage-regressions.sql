begin;

do $regression$
declare
  manufacturer_id uuid;
  baseball_id uuid;
  football_id uuid;
  hockey_id uuid;
  basketball_id uuid;
  pending_release_id uuid;
  set_gap_release_id uuid;
  identity_gap_release_id uuid;
  set_gap_file_id uuid;
  identity_gap_file_id uuid;
  set_gap_version_id uuid;
  identity_gap_version_id uuid;
  guide_id uuid;
  import_run_id uuid;
  payload jsonb;
  filtered_payload jsonb;
  function_definition text;
  observation_count bigint;
begin
  insert into public.checklist_manufacturers (name, slug)
  values ('Example Manufacturer', 'example-manufacturer')
  returning id into manufacturer_id;

  insert into public.checklist_sports (name, slug)
  values ('Baseball', 'baseball')
  returning id into baseball_id;
  insert into public.checklist_sports (name, slug)
  values ('Football', 'football')
  returning id into football_id;
  insert into public.checklist_sports (name, slug)
  values ('Hockey', 'hockey')
  returning id into hockey_id;
  insert into public.checklist_sports (name, slug)
  values ('Basketball', 'basketball')
  returning id into basketball_id;

  insert into public.checklist_releases (
    manufacturer_id,
    sport_id,
    product_name,
    slug,
    release_year,
    checklist_status,
    import_status
  ) values (
    manufacturer_id,
    football_id,
    'Beta Product',
    'beta-product',
    '2026',
    'pending',
    'not_started'
  ) returning id into pending_release_id;

  insert into public.checklist_releases (
    manufacturer_id,
    sport_id,
    product_name,
    slug,
    release_year,
    checklist_status,
    import_status
  ) values (
    manufacturer_id,
    hockey_id,
    'Gamma Product',
    'gamma-product',
    '2026',
    'live',
    'successful'
  ) returning id into set_gap_release_id;

  insert into public.checklist_releases (
    manufacturer_id,
    sport_id,
    product_name,
    slug,
    release_year,
    checklist_status,
    import_status
  ) values (
    manufacturer_id,
    basketball_id,
    'Delta Product',
    'delta-product',
    '2026',
    'live',
    'successful'
  ) returning id into identity_gap_release_id;

  insert into public.checklist_source_files (
    release_id,
    source_file_type,
    source_url,
    original_filename,
    storage_object_path,
    mime_type,
    size_bytes,
    sha256,
    importer_version,
    import_status,
    validation_status
  ) values (
    set_gap_release_id,
    'checklist',
    'https://example.invalid/gamma',
    'gamma.csv',
    'coverage-regression/gamma.csv',
    'text/csv',
    1,
    repeat('a', 64),
    'coverage-regression-v1',
    'successful',
    'passed'
  ) returning id into set_gap_file_id;

  insert into public.checklist_source_files (
    release_id,
    source_file_type,
    source_url,
    original_filename,
    storage_object_path,
    mime_type,
    size_bytes,
    sha256,
    importer_version,
    import_status,
    validation_status
  ) values (
    identity_gap_release_id,
    'checklist',
    'https://example.invalid/delta',
    'delta.csv',
    'coverage-regression/delta.csv',
    'text/csv',
    1,
    repeat('b', 64),
    'coverage-regression-v1',
    'successful',
    'passed'
  ) returning id into identity_gap_file_id;

  insert into public.checklist_versions (
    release_id,
    source_file_id,
    version_number,
    parser_version,
    status,
    normalized_card_count,
    normalized_identity_count,
    is_active,
    imported_at,
    validated_at,
    activated_at
  ) values (
    set_gap_release_id,
    set_gap_file_id,
    1,
    'coverage-regression-v1',
    'live',
    10,
    10,
    true,
    now(),
    now(),
    now()
  ) returning id into set_gap_version_id;

  insert into public.checklist_versions (
    release_id,
    source_file_id,
    version_number,
    parser_version,
    status,
    normalized_card_count,
    normalized_identity_count,
    is_active,
    imported_at,
    validated_at,
    activated_at
  ) values (
    identity_gap_release_id,
    identity_gap_file_id,
    1,
    'coverage-regression-v1',
    'live',
    20,
    20,
    true,
    now(),
    now(),
    now()
  ) returning id into identity_gap_version_id;

  insert into public.checklist_sets (
    release_id,
    version_id,
    name,
    normalized_name,
    set_type
  ) values (
    set_gap_release_id,
    set_gap_version_id,
    'Base',
    'base',
    'base'
  );

  insert into public.checklist_sets (
    release_id,
    version_id,
    name,
    normalized_name,
    set_type
  ) values (
    identity_gap_release_id,
    identity_gap_version_id,
    'Base',
    'base',
    'base'
  );

  insert into public.tcos_kingmaker_price_guides (
    title,
    sport,
    edition_date,
    original_filename,
    source_sha256,
    page_count,
    price_guide_start_page,
    price_guide_end_page,
    parser_version,
    extraction_status
  ) values (
    'Private Baseball Reference',
    'Baseball',
    '2026-08-01',
    'private-baseball.pdf',
    repeat('1', 64),
    1,
    1,
    1,
    'coverage-regression-v1',
    'ready'
  ) returning id into guide_id;

  insert into public.tcos_kingmaker_price_import_runs (
    guide_id,
    run_key,
    parser_version,
    status,
    pages_seen,
    pages_accepted,
    entries_seen,
    entries_review,
    completed_at
  ) values (
    guide_id,
    'coverage-baseball',
    'coverage-regression-v1',
    'succeeded',
    1,
    1,
    3,
    3,
    now()
  ) returning id into import_run_id;

  insert into public.tcos_kingmaker_price_entries (
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
    value_low,
    value_high,
    raw_text,
    parse_confidence,
    validation_status,
    identity_match_status
  )
  select
    guide_id,
    import_run_id,
    1,
    series,
    'alpha-' || series,
    'card',
    '2026',
    'Example Manufacturer',
    'Alpha Product',
    'Base',
    'A' || series,
    'Alpha Player ' || series,
    1,
    2,
    'private row',
    0.91,
    'review',
    'unmatched'
  from generate_series(1, 3) series;

  insert into public.tcos_kingmaker_price_guides (
    title,
    sport,
    edition_date,
    original_filename,
    source_sha256,
    page_count,
    price_guide_start_page,
    price_guide_end_page,
    parser_version,
    extraction_status
  ) values (
    'Private Football Reference',
    'Football',
    '2026-08-01',
    'private-football.pdf',
    repeat('2', 64),
    1,
    1,
    1,
    'coverage-regression-v1',
    'ready'
  ) returning id into guide_id;

  insert into public.tcos_kingmaker_price_import_runs (
    guide_id,
    run_key,
    parser_version,
    status,
    pages_seen,
    pages_accepted,
    entries_seen,
    entries_review,
    completed_at
  ) values (
    guide_id,
    'coverage-football',
    'coverage-regression-v1',
    'succeeded',
    1,
    1,
    2,
    2,
    now()
  ) returning id into import_run_id;

  insert into public.tcos_kingmaker_price_entries (
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
    value_low,
    value_high,
    raw_text,
    parse_confidence,
    validation_status,
    identity_match_status
  )
  select
    guide_id,
    import_run_id,
    1,
    series,
    'beta-' || series,
    'card',
    '2026',
    'Example Manufacturer',
    'Beta Product',
    'Base',
    'B' || series,
    'Beta Player ' || series,
    1,
    2,
    'private row',
    0.92,
    'review',
    'unmatched'
  from generate_series(1, 2) series;

  insert into public.tcos_kingmaker_price_guides (
    title,
    sport,
    edition_date,
    original_filename,
    source_sha256,
    page_count,
    price_guide_start_page,
    price_guide_end_page,
    parser_version,
    extraction_status
  ) values (
    'Private Hockey Reference',
    'Hockey',
    '2026-08-01',
    'private-hockey.pdf',
    repeat('3', 64),
    1,
    1,
    1,
    'coverage-regression-v1',
    'ready'
  ) returning id into guide_id;

  insert into public.tcos_kingmaker_price_import_runs (
    guide_id,
    run_key,
    parser_version,
    status,
    pages_seen,
    pages_accepted,
    entries_seen,
    entries_review,
    completed_at
  ) values (
    guide_id,
    'coverage-hockey',
    'coverage-regression-v1',
    'succeeded',
    1,
    1,
    4,
    4,
    now()
  ) returning id into import_run_id;

  insert into public.tcos_kingmaker_price_entries (
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
    value_low,
    value_high,
    raw_text,
    parse_confidence,
    validation_status,
    identity_match_status
  )
  select
    guide_id,
    import_run_id,
    1,
    series,
    'gamma-' || series,
    'card',
    '2026',
    'Example Manufacturer',
    'Gamma Product',
    'Missing Insert',
    'G' || series,
    'Gamma Player ' || series,
    1,
    2,
    'private row',
    0.93,
    'review',
    'unmatched'
  from generate_series(1, 4) series;

  insert into public.tcos_kingmaker_price_guides (
    title,
    sport,
    edition_date,
    original_filename,
    source_sha256,
    page_count,
    price_guide_start_page,
    price_guide_end_page,
    parser_version,
    extraction_status
  ) values (
    'Private Basketball Reference',
    'Basketball',
    '2026-08-01',
    'private-basketball.pdf',
    repeat('4', 64),
    1,
    1,
    1,
    'coverage-regression-v1',
    'ready'
  ) returning id into guide_id;

  insert into public.tcos_kingmaker_price_import_runs (
    guide_id,
    run_key,
    parser_version,
    status,
    pages_seen,
    pages_accepted,
    entries_seen,
    entries_review,
    completed_at
  ) values (
    guide_id,
    'coverage-basketball',
    'coverage-regression-v1',
    'succeeded',
    1,
    1,
    5,
    5,
    now()
  ) returning id into import_run_id;

  insert into public.tcos_kingmaker_price_entries (
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
    value_low,
    value_high,
    raw_text,
    parse_confidence,
    validation_status,
    identity_match_status
  )
  select
    guide_id,
    import_run_id,
    1,
    series,
    'delta-' || series,
    'card',
    '2026',
    'Example Manufacturer',
    'Delta Product',
    'Base',
    'D' || series,
    'Delta Player ' || series,
    1,
    2,
    'private row',
    0.94,
    'review',
    case when series = 5 then 'ambiguous' else 'unmatched' end
  from generate_series(1, 5) series;

  select public.tcos_kingmaker_private_pricing_coverage_report(
    100,
    0,
    null,
    null,
    null
  ) into payload;

  if (payload ->> 'boundary') <> 'aggregate_private_reference_only' then
    raise exception 'Coverage boundary is missing or incorrect: %', payload;
  end if;
  if (payload #>> '{summary,totalGroups}')::integer <> 4 then
    raise exception 'Expected four coverage groups: %', payload;
  end if;
  if (payload #>> '{summary,unresolvedRows}')::integer <> 14 then
    raise exception 'Expected fourteen unresolved rows: %', payload;
  end if;
  if (payload #>> '{summary,missingReleaseRows}')::integer <> 3
     or (payload #>> '{summary,checklistPendingRows}')::integer <> 2
     or (payload #>> '{summary,setGapRows}')::integer <> 4
     or (payload #>> '{summary,identityGapRows}')::integer <> 5 then
    raise exception 'Coverage classifications are incorrect: %', payload;
  end if;
  if (payload #>> '{summary,largestUnlock}')::integer <> 5 then
    raise exception 'Largest unlock is incorrect: %', payload;
  end if;
  if (payload #>> '{rows,0,gapType}') <> 'identity_gap'
     or (payload #>> '{rows,0,potentialUnlock}')::integer <> 5 then
    raise exception 'Coverage ranking is incorrect: %', payload;
  end if;
  if (payload::text ilike '%raw_text%'
     or payload::text ilike '%original_filename%'
     or payload::text ilike '%value_low%'
     or payload::text ilike '%value_high%'
     or payload::text ilike '%source_sha256%'
     or payload::text ilike '%sourceDisclosure%'
     or payload::text ilike '%beckett%' then
    raise exception 'Coverage payload disclosed prohibited private fields or attribution: %', payload;
  end if;

  select public.tcos_kingmaker_private_pricing_coverage_report(
    100,
    0,
    'missing_release',
    null,
    null
  ) into filtered_payload;
  if (filtered_payload #>> '{summary,totalGroups}')::integer <> 1
     or (filtered_payload #>> '{summary,unresolvedRows}')::integer <> 3
     or (filtered_payload #>> '{rows,0,gapType}') <> 'missing_release' then
    raise exception 'Gap-type filter failed: %', filtered_payload;
  end if;

  select public.tcos_kingmaker_private_pricing_coverage_report(
    100,
    0,
    null,
    'Hockey',
    'Gamma Product'
  ) into filtered_payload;
  if (filtered_payload #>> '{summary,totalGroups}')::integer <> 1
     or (filtered_payload #>> '{rows,0,gapType}') <> 'set_gap'
     or (filtered_payload #>> '{rows,0,potentialUnlock}')::integer <> 4 then
    raise exception 'Sport/search filtering failed: %', filtered_payload;
  end if;

  select public.tcos_kingmaker_private_pricing_coverage_report(
    2,
    0,
    null,
    null,
    null
  ) into filtered_payload;
  if (filtered_payload #>> '{pagination,returned}')::integer <> 2
     or not (filtered_payload #>> '{pagination,hasMore}')::boolean then
    raise exception 'Coverage pagination failed: %', filtered_payload;
  end if;

  if has_function_privilege(
    'anon',
    'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)',
    'execute'
  ) then
    raise exception 'Public roles can execute the private coverage report.';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)',
    'execute'
  ) then
    raise exception 'Service role cannot execute the private coverage report.';
  end if;

  select pg_get_functiondef(
    'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)'::regprocedure
  ) into function_definition;
  if function_definition ilike '%beckett%'
     or function_definition ilike '%raw_text%'
     or function_definition ilike '%value_low%'
     or function_definition ilike '%value_high%' then
    raise exception 'Coverage function contains prohibited disclosure markers.';
  end if;

  select count(*)
  into observation_count
  from public.tcos_kingmaker_observations;
  if observation_count <> 0 then
    raise exception 'Coverage reporting created pricing observations.';
  end if;
  if exists (
    select 1
    from public.tcos_kingmaker_price_entries
    where low_observation_id is not null
       or high_observation_id is not null
  ) then
    raise exception 'Coverage reporting promoted private pricing rows.';
  end if;
end;
$regression$;

rollback;
