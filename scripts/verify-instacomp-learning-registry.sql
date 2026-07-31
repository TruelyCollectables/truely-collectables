\set ON_ERROR_STOP on
\set plan `cat .codex-run/checklist-registry-integration-plan.json`

create temp table integration_plan(plan jsonb not null);
insert into integration_plan(plan) values (:'plan'::jsonb);

do $$
declare
  v_entry record;
  v_observation_status text;
begin
  insert into public.instacomp_scans (
    id, image_filename, player, year, brand, set_name, card_number,
    parallel, confidence, search_query, suggested_price,
    raw_ai_result, raw_comp_results, created_at
  ) values (
    '10000000-0000-0000-0000-000000000001',
    'learning-1-front.jpg',
    'Test Player', '2026', 'Test Brand', 'Test Set', '101',
    'Base', 0.99, '2026 Test Brand Test Set Test Player 101', 20.00,
    jsonb_build_object(
      'player','Test Player','year','2026','brand','Test Brand',
      'setName','Test Set','cardNumber','101','parallel','Base',
      'serialNumber',null,'team','Test Team','sport','Basketball',
      'isRookie',true,'isAuto',false,'isRelic',false,'confidence',0.99
    ),
    jsonb_build_object(
      'soldStats',jsonb_build_object('suggestedPrice',20),
      'sourceCoverage','[]'::jsonb,
      'catalogEvidence',jsonb_build_object('status','review_required')
    ),
    now()
  );

  select trust_status, confirmed_count, observation_count, scanner_observed_count
  into v_entry
  from public.tcos_card_knowledge_entries
  where latest_scan_id = '10000000-0000-0000-0000-000000000001';

  if v_entry.trust_status <> 'learning'
     or v_entry.confirmed_count <> 0
     or v_entry.observation_count <> 1
     or v_entry.scanner_observed_count <> 1 then
    raise exception 'A first unconfirmed scan must remain learning: %', row_to_json(v_entry);
  end if;

  select confirmation_status into v_observation_status
  from public.tcos_card_knowledge_observations
  where observation_key = 'scan:10000000-0000-0000-0000-000000000001';

  if v_observation_status <> 'scanner_observed' then
    raise exception 'Expected scanner_observed, found %', v_observation_status;
  end if;
end;
$$;

do $$
declare
  v_result jsonb;
  v_entry_id uuid;
  v_ai jsonb;
begin
  v_result := public.tcos_instacomp_confirm_scan_knowledge(
    '10000000-0000-0000-0000-000000000001',
    jsonb_build_object('parallel','Silver Prizm'),
    'operator_confirmed'
  );
  v_entry_id := (v_result #>> '{entry,id}')::uuid;

  select ai_result into v_ai
  from public.tcos_card_knowledge_entries
  where id = v_entry_id;

  if v_ai->>'player' <> 'Test Player'
     or v_ai->>'setName' <> 'Test Set'
     or v_ai->>'parallel' <> 'Silver Prizm' then
    raise exception 'Partial operator correction erased base identity evidence: %', v_ai;
  end if;
end;
$$;

do $$
declare
  v_scan_number integer;
  v_scan_id uuid;
  v_result jsonb;
  v_entry jsonb;
begin
  for v_scan_number in 2..3 loop
    v_scan_id := format('10000000-0000-0000-0000-%012s', v_scan_number)::uuid;

    insert into public.instacomp_scans (
      id, image_filename, player, year, brand, set_name, card_number,
      parallel, confidence, search_query, suggested_price,
      raw_ai_result, raw_comp_results, created_at
    ) values (
      v_scan_id,
      format('learning-%s-front.jpg', v_scan_number),
      'Test Player', '2026', 'Test Brand', 'Test Set', '101',
      'Silver Prizm', 0.99, '2026 Test Brand Test Set Test Player 101 Silver Prizm', 20.00,
      jsonb_build_object(
        'player','Test Player','year','2026','brand','Test Brand',
        'setName','Test Set','cardNumber','101','parallel','Silver Prizm',
        'serialNumber',null,'team','Test Team','sport','Basketball',
        'isRookie',true,'isAuto',false,'isRelic',false,'confidence',0.99
      ),
      jsonb_build_object(
        'soldStats',jsonb_build_object('suggestedPrice',20),
        'sourceCoverage','[]'::jsonb,
        'catalogEvidence',jsonb_build_object('status','review_required')
      ),
      now()
    );

    v_result := public.tcos_instacomp_confirm_scan_knowledge(
      v_scan_id::text,
      '{}'::jsonb,
      'operator_confirmed'
    );
  end loop;

  select public.tcos_instacomp_refresh_knowledge_entry(knowledge_entry_id)
  into v_entry
  from public.tcos_card_knowledge_observations
  where observation_key = 'scan:10000000-0000-0000-0000-000000000003';

  if v_entry->>'trustStatus' <> 'tcos_trusted'
     or (v_entry->>'confirmedCount')::integer <> 3
     or (v_entry->>'observationCount')::integer <> 3 then
    raise exception 'Three operator confirmations did not promote trust: %', v_entry;
  end if;
end;
$$;

do $$
declare
  v_entry record;
begin
  insert into public.instacomp_scans (
    id, image_filename, player, year, brand, set_name, card_number,
    parallel, confidence, search_query, suggested_price,
    raw_ai_result, raw_comp_results, created_at
  ) values (
    '20000000-0000-0000-0000-000000000001',
    'catalog-front.jpg',
    'Catalog Player', '2025', 'Panini', 'Select WNBA', '7',
    'White Disco Prizm', 0.995, '2025 Select WNBA Catalog Player 7 White Disco Prizm', 30.00,
    jsonb_build_object(
      'player','Catalog Player','year','2025','brand','Panini',
      'setName','Select WNBA','cardNumber','7','parallel','White Disco Prizm',
      'serialNumber','01/75','team','Test Team','sport','Basketball',
      'isRookie',true,'isAuto',false,'isRelic',false,'confidence',0.995
    ),
    jsonb_build_object(
      'catalogEvidence',jsonb_build_object(
        'status','catalog_confirmed','catalogConfirmed',true
      ),
      'sourceCoverage','[]'::jsonb
    ),
    now()
  );

  select trust_status, confirmed_count, catalog_confirmed_count, observation_count
  into v_entry
  from public.tcos_card_knowledge_entries
  where latest_scan_id = '20000000-0000-0000-0000-000000000001';

  if v_entry.trust_status <> 'tcos_trusted'
     or v_entry.catalog_confirmed_count <> 1
     or v_entry.confirmed_count <> 1
     or v_entry.observation_count <> 1 then
    raise exception 'One exact catalog confirmation must promote trust: %', row_to_json(v_entry);
  end if;
end;
$$;

do $$
declare
  v_entry_id uuid;
  v_before record;
  v_after record;
  v_cache_id uuid := '30000000-0000-0000-0000-000000000001';
begin
  select knowledge_entry_id into v_entry_id
  from public.tcos_card_knowledge_observations
  where observation_key = 'scan:10000000-0000-0000-0000-000000000003';

  select confirmed_count, observation_count into v_before
  from public.tcos_card_knowledge_entries where id = v_entry_id;

  insert into public.instacomp_scan_knowledge_cache (
    id, image_fingerprint, scan_id, knowledge_entry_id,
    front_image_sha256, back_image_sha256, response_payload,
    identity_confidence, trusted_for_pricing, confirmation_status,
    market_expires_at
  ) values (
    v_cache_id,
    repeat('a',64) || ':' || repeat('b',64),
    '10000000-0000-0000-0000-000000000003',
    v_entry_id,
    repeat('a',64), repeat('b',64),
    jsonb_build_object(
      'ok',true,
      'ai',jsonb_build_object(
        'player','Test Player','year','2026','brand','Test Brand',
        'setName','Test Set','cardNumber','101','parallel','Silver Prizm'
      )
    ),
    0.99, true, 'operator_confirmed', now() + interval '6 hours'
  );

  perform public.tcos_instacomp_record_cache_replay(
    v_cache_id,
    'cache-replay:integration-test',
    null,
    'admin',
    null
  );

  select confirmed_count, observation_count into v_after
  from public.tcos_card_knowledge_entries where id = v_entry_id;

  if v_after.confirmed_count <> v_before.confirmed_count
     or v_after.observation_count <> v_before.observation_count + 1 then
    raise exception 'Cache replay changed confirmation trust incorrectly: before %, after %',
      row_to_json(v_before), row_to_json(v_after);
  end if;
end;
$$;

do $$
declare
  v_scan jsonb;
  v_before integer;
  v_after integer;
begin
  select count(*) into v_before
  from public.tcos_card_knowledge_observations
  where observation_key = 'scan:10000000-0000-0000-0000-000000000001';

  select to_jsonb(scan) into v_scan
  from public.instacomp_scans scan
  where id = '10000000-0000-0000-0000-000000000001';

  perform public.tcos_instacomp_record_scan_knowledge_payload(v_scan);
  perform public.tcos_instacomp_record_scan_knowledge_payload(v_scan);

  select count(*) into v_after
  from public.tcos_card_knowledge_observations
  where observation_key = 'scan:10000000-0000-0000-0000-000000000001';

  if v_before <> 1 or v_after <> 1 then
    raise exception 'Learning backfill is not idempotent: before %, after %', v_before, v_after;
  end if;
end;
$$;

do $$
declare
  v_plan jsonb;
  v_first jsonb;
  v_second jsonb;
  v_cards integer;
  v_identities integer;
begin
  select plan into v_plan from integration_plan;

  v_first := public.tcos_apply_checklist_import_plan(
    v_plan,
    v_plan #>> '{source,storage,originalFilename}',
    v_plan #>> '{source,storage,mimeType}',
    (v_plan #>> '{source,storage,sizeBytes}')::bigint,
    v_plan #>> '{source,storage,sha256}',
    v_plan #>> '{source,storage,bucket}',
    v_plan #>> '{source,storage,objectPath}'
  );

  if coalesce((v_first->>'ok')::boolean,false) is not true
     or v_first->>'status' <> 'live' then
    raise exception 'Checklist Registry transaction did not go live: %', v_first;
  end if;

  select count(*) into v_cards
  from public.checklist_cards
  where release_id = (v_first->>'releaseId')::uuid;
  select count(*) into v_identities
  from public.checklist_card_identities
  where release_id = (v_first->>'releaseId')::uuid;

  if v_cards <> (v_plan #>> '{validation,counts,cards}')::integer
     or v_identities <> (v_plan #>> '{validation,counts,identities}')::integer then
    raise exception 'Registry row counts do not match validated plan: cards %, identities %, result %',
      v_cards, v_identities, v_first;
  end if;

  v_second := public.tcos_apply_checklist_import_plan(
    v_plan,
    v_plan #>> '{source,storage,originalFilename}',
    v_plan #>> '{source,storage,mimeType}',
    (v_plan #>> '{source,storage,sizeBytes}')::bigint,
    v_plan #>> '{source,storage,sha256}',
    v_plan #>> '{source,storage,bucket}',
    v_plan #>> '{source,storage,objectPath}'
  );

  if coalesce((v_second->>'idempotent')::boolean,false) is not true then
    raise exception 'Second Checklist Registry import was not idempotent: %', v_second;
  end if;

  if (select count(*) from public.checklist_cards
      where release_id = (v_first->>'releaseId')::uuid) <> v_cards
     or (select count(*) from public.checklist_card_identities
         where release_id = (v_first->>'releaseId')::uuid) <> v_identities then
    raise exception 'Idempotent Registry replay duplicated rows';
  end if;
end;
$$;

select jsonb_build_object(
  'schema','instacomp.learningRegistry.integration.v1',
  'status','passed',
  'learningEntries',(select count(*) from public.tcos_card_knowledge_entries),
  'learningObservations',(select count(*) from public.tcos_card_knowledge_observations),
  'trustedEntries',(select count(*) from public.tcos_card_knowledge_entries where trust_status = 'tcos_trusted'),
  'registryReleases',(select count(*) from public.checklist_releases),
  'registryCards',(select count(*) from public.checklist_cards),
  'registryIdentities',(select count(*) from public.checklist_card_identities)
) as verification_receipt;
