begin;

do $regression$
declare
  manufacturer_id uuid;
  sport_id uuid;
  pending_release_id uuid;
  set_gap_release_id uuid;
  identity_gap_release_id uuid;
  set_gap_file_id uuid;
  identity_gap_file_id uuid;
  set_gap_version_id uuid;
  identity_gap_version_id uuid;
  guide_id uuid;
  import_run_id uuid;
  target_entry_id uuid;
  refresh_result jsonb;
  report jsonb;
  function_definition text;
begin
  insert into public.checklist_manufacturers (name, slug)
  values ('Snapshot Manufacturer', 'snapshot-manufacturer')
  returning id into manufacturer_id;

  insert into public.checklist_sports (name, slug)
  values ('Snapshot Sport', 'snapshot-sport')
  returning id into sport_id;

  insert into public.checklist_releases (
    manufacturer_id, sport_id, product_name, slug, release_year,
    checklist_status, import_status
  ) values (
    manufacturer_id, sport_id, 'Pending Product', 'pending-product', '2026',
    'pending', 'not_started'
  ) returning id into pending_release_id;

  insert into public.checklist_releases (
    manufacturer_id, sport_id, product_name, slug, release_year,
    checklist_status, import_status
  ) values (
    manufacturer_id, sport_id, 'Set Gap Product', 'set-gap-product', '2026',
    'live', 'successful'
  ) returning id into set_gap_release_id;

  insert into public.checklist_releases (
    manufacturer_id, sport_id, product_name, slug, release_year,
    checklist_status, import_status
  ) values (
    manufacturer_id, sport_id, 'Identity Gap Product', 'identity-gap-product', '2026',
    'live', 'successful'
  ) returning id into identity_gap_release_id;

  insert into public.checklist_source_files (
    release_id, source_file_type, source_url, original_filename,
    storage_object_path, mime_type, size_bytes, sha256, importer_version,
    import_status, validation_status
  ) values (
    set_gap_release_id, 'checklist', 'https://example.invalid/set-gap',
    'set-gap.csv', 'snapshot-regression/set-gap.csv', 'text/csv', 1,
    repeat('c', 64), 'snapshot-regression-v1', 'successful', 'passed'
  ) returning id into set_gap_file_id;

  insert into public.checklist_source_files (
    release_id, source_file_type, source_url, original_filename,
    storage_object_path, mime_type, size_bytes, sha256, importer_version,
    import_status, validation_status
  ) values (
    identity_gap_release_id, 'checklist', 'https://example.invalid/identity-gap',
    'identity-gap.csv', 'snapshot-regression/identity-gap.csv', 'text/csv', 1,
    repeat('d', 64), 'snapshot-regression-v1', 'successful', 'passed'
  ) returning id into identity_gap_file_id;

  insert into public.checklist_versions (
    release_id, source_file_id, version_number, parser_version, status,
    normalized_card_count, normalized_identity_count, is_active,
    imported_at, validated_at, activated_at
  ) values (
    set_gap_release_id, set_gap_file_id, 1, 'snapshot-regression-v1', 'live',
    10, 10, true, now(), now(), now()
  ) returning id into set_gap_version_id;

  insert into public.checklist_versions (
    release_id, source_file_id, version_number, parser_version, status,
    normalized_card_count, normalized_identity_count, is_active,
    imported_at, validated_at, activated_at
  ) values (
    identity_gap_release_id, identity_gap_file_id, 1,
    'snapshot-regression-v1', 'live', 20, 20, true, now(), now(), now()
  ) returning id into identity_gap_version_id;

  insert into public.checklist_sets (
    release_id, version_id, name, normalized_name, set_type
  ) values
    (set_gap_release_id, set_gap_version_id, 'Base', 'base', 'base'),
    (identity_gap_release_id, identity_gap_version_id, 'Base', 'base', 'base');

  insert into public.tcos_kingmaker_price_guides (
    title, sport, edition_date, original_filename, source_sha256, page_count,
    price_guide_start_page, price_guide_end_page, parser_version,
    extraction_status
  ) values (
    'Private Snapshot Reference', 'Snapshot Sport', '2026-08-01',
    'private-snapshot.pdf', repeat('5', 64), 1, 1, 1,
    'snapshot-regression-v1', 'ready'
  ) returning id into guide_id;

  insert into public.tcos_kingmaker_price_import_runs (
    guide_id, run_key, parser_version, status, pages_seen, pages_accepted,
    entries_seen, entries_review, completed_at
  ) values (
    guide_id, 'snapshot-coverage-run', 'snapshot-regression-v1',
    'succeeded', 1, 1, 14, 14, now()
  ) returning id into import_run_id;

  with coverage_groups as (
    select * from (values
      ('Missing Product'::text, 'Base'::text, 'missing'::text, 5, 0),
      ('Pending Product', 'Base', 'pending', 4, 10),
      ('Set Gap Product', 'Missing Insert', 'set-gap', 3, 20),
      ('Identity Gap Product', 'Base', 'identity-gap', 2, 30)
    ) as groups(product, set_name, key_prefix, row_count, row_offset)
  )
  insert into public.tcos_kingmaker_price_entries (
    guide_id, import_run_id, page_number, row_order, source_row_key,
    entry_kind, release_year, manufacturer, product, set_name, card_number,
    player_name, value_low, value_high, raw_text, parse_confidence,
    validation_status, identity_match_status
  )
  select
    guide_id,
    import_run_id,
    1,
    groups.row_offset + series,
    concat(groups.key_prefix, '-', series),
    'card',
    '2026',
    'Snapshot Manufacturer',
    groups.product,
    groups.set_name,
    concat(upper(left(groups.key_prefix, 1)), series),
    concat('Snapshot Player ', groups.row_offset + series),
    1,
    2,
    'private row',
    0.94,
    'review',
    case
      when groups.key_prefix = 'identity-gap' and series = 2 then 'ambiguous'
      else 'unmatched'
    end
  from coverage_groups groups
  cross join lateral generate_series(1, groups.row_count) series;

  select id
  into target_entry_id
  from public.tcos_kingmaker_price_entries
  where guide_id = guide_id
    and source_row_key = 'identity-gap-2'
  limit 1;

  select public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(true)
  into refresh_result;

  if refresh_result ->> 'status' <> 'succeeded'
     or not (refresh_result ->> 'refreshed')::boolean
     or (refresh_result ->> 'totalGroups')::integer <> 4
     or (refresh_result ->> 'unresolvedRows')::integer <> 14 then
    raise exception 'Initial snapshot refresh failed: %', refresh_result;
  end if;

  select public.tcos_kingmaker_private_pricing_coverage_report(
    100, 0, null, null, null
  ) into report;

  if report ->> 'boundary' <> 'aggregate_private_reference_only'
     or (report #>> '{snapshot,dirty}')::boolean
     or report #>> '{snapshot,status}' <> 'succeeded'
     or (report #>> '{summary,totalGroups}')::integer <> 4
     or (report #>> '{summary,unresolvedRows}')::integer <> 14
     or (report #>> '{summary,missingReleaseRows}')::integer <> 5
     or (report #>> '{summary,checklistPendingRows}')::integer <> 4
     or (report #>> '{summary,setGapRows}')::integer <> 3
     or (report #>> '{summary,identityGapRows}')::integer <> 2
     or report #>> '{rows,0,gapType}' <> 'missing_release'
     or (report #>> '{rows,0,potentialUnlock}')::integer <> 5 then
    raise exception 'Snapshot report is incorrect: %', report;
  end if;

  if report::text ilike '%raw_text%'
     or report::text ilike '%original_filename%'
     or report::text ilike '%value_low%'
     or report::text ilike '%value_high%'
     or report::text ilike '%source_sha256%'
     or report::text ilike '%storage_object_path%' then
    raise exception 'Snapshot report disclosed prohibited fields: %', report;
  end if;

  select public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(false)
  into refresh_result;
  if refresh_result ->> 'status' <> 'idle'
     or (refresh_result ->> 'refreshed')::boolean then
    raise exception 'Clean snapshot did not return idle: %', refresh_result;
  end if;

  update public.tcos_kingmaker_price_entries
  set identity_match_status = 'exact'
  where id = target_entry_id;

  if not (
    select dirty
    from public.tcos_kingmaker_private_pricing_coverage_state
    where singleton_id = 1
  ) then
    raise exception 'Entry update did not invalidate the coverage snapshot.';
  end if;

  select public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(false)
  into refresh_result;
  if refresh_result ->> 'status' <> 'succeeded'
     or (refresh_result ->> 'unresolvedRows')::integer <> 13 then
    raise exception 'Dirty snapshot did not refresh correctly: %', refresh_result;
  end if;

  select public.tcos_kingmaker_private_pricing_coverage_report(
    100, 0, 'identity_gap', 'Snapshot Sport', 'Identity Gap Product'
  ) into report;
  if (report #>> '{summary,totalGroups}')::integer <> 1
     or (report #>> '{summary,unresolvedRows}')::integer <> 1
     or report #>> '{rows,0,gapType}' <> 'identity_gap' then
    raise exception 'Snapshot filtering failed: %', report;
  end if;

  if has_function_privilege(
    'anon',
    'public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(boolean)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(boolean)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)',
    'execute'
  ) then
    raise exception 'Public roles can execute a private coverage function.';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(boolean)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)',
    'execute'
  ) then
    raise exception 'Service role cannot execute private coverage functions.';
  end if;

  select pg_get_functiondef(
    'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)'::regprocedure
  ) into function_definition;
  if function_definition ilike '%tcos_kingmaker_price_entries%'
     or function_definition ilike '%checklist_releases%'
     or function_definition ilike '%raw_text%'
     or function_definition ilike '%value_low%'
     or function_definition ilike '%value_high%' then
    raise exception 'Interactive report still scans private source tables.';
  end if;

  if exists (select 1 from public.tcos_kingmaker_observations)
     or exists (
       select 1
       from public.tcos_kingmaker_price_entries
       where low_observation_id is not null
          or high_observation_id is not null
     ) then
    raise exception 'Snapshot reporting created or linked pricing observations.';
  end if;
end;
$regression$;

rollback;
