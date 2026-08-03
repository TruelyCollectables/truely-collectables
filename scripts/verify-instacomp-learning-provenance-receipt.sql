\set ON_ERROR_STOP on

begin;

do $$
declare
  v_forged_entry uuid;
  v_mismatch_entry uuid;
  v_exact_entry uuid;
  v_explicit_entry uuid;
  v_status text;
  v_trusted boolean;
  v_exact_payload jsonb;
  v_mismatch_payload jsonb;
  v_boolean_only_payload jsonb;
  v_ai jsonb := jsonb_build_object(
    'player', 'Round Two Player',
    'year', '2026',
    'brand', 'Panini',
    'setName', 'Audit Set',
    'cardNumber', 'R2-1',
    'parallel', 'Blue',
    'serialNumber', null,
    'isAuto', false,
    'isRelic', false
  );
begin
  v_boolean_only_payload := jsonb_build_object(
    'ai', v_ai,
    'consensus', jsonb_build_object('trustedForIdentity', true),
    'compSearchDecision', jsonb_build_object('allowed', true),
    'catalogEvidence', jsonb_build_object('catalogConfirmed', true)
  );

  v_mismatch_payload := v_boolean_only_payload || jsonb_build_object(
    'checklistRegistry', jsonb_build_object(
      'matched', true,
      'identityId', 'registry-round2-a'
    ),
    'catalogEvidence', jsonb_build_object(
      'status', 'catalog_confirmed',
      'catalogConfirmed', true,
      'selectedMatch', jsonb_build_object('catalogId', 'catalog-round2-b')
    )
  );

  v_exact_payload := v_boolean_only_payload || jsonb_build_object(
    'checklistRegistry', jsonb_build_object(
      'matched', true,
      'identityId', 'round2-exact-identity'
    ),
    'catalogEvidence', jsonb_build_object(
      'status', 'catalog_confirmed',
      'catalogConfirmed', true,
      'selectedMatch', jsonb_build_object(
        'catalogId', 'round2-exact-identity'
      )
    )
  );

  if public.tcos_instacomp_payload_exact_identity_trusted(
    v_boolean_only_payload
  ) then
    raise exception 'Boolean-only payload was accepted as exact identity trust';
  end if;

  if public.tcos_instacomp_payload_exact_identity_trusted(
    v_mismatch_payload
  ) then
    raise exception 'Mismatched Registry and catalog IDs were accepted';
  end if;

  if not public.tcos_instacomp_payload_exact_identity_trusted(
    v_exact_payload
  ) then
    raise exception 'Matching Registry and catalog receipt was rejected';
  end if;

  insert into public.tcos_card_knowledge_entries(
    identity_fingerprint,
    title,
    ai_result
  ) values (
    'round2-forged-trust-entry',
    'Round Two forged trust entry',
    v_ai
  ) returning id into v_forged_entry;

  insert into public.tcos_card_knowledge_observations(
    knowledge_entry_id,
    observation_key,
    confirmation_status,
    title,
    ai_result,
    consensus,
    catalog_evidence,
    result_payload
  ) values (
    v_forged_entry,
    'round2-forged-operator',
    'operator_confirmed',
    'Forged operator confirmation',
    v_ai,
    v_boolean_only_payload->'consensus',
    v_boolean_only_payload->'catalogEvidence',
    v_boolean_only_payload
  );

  select confirmation_status
  into v_status
  from public.tcos_card_knowledge_observations
  where observation_key = 'round2-forged-operator';
  if v_status <> 'needs_more_info' then
    raise exception 'Forged operator trust was not downgraded: %', v_status;
  end if;

  insert into public.tcos_card_knowledge_entries(
    identity_fingerprint,
    title,
    ai_result
  ) values (
    'round2-mismatch-entry',
    'Round Two mismatch entry',
    v_ai || jsonb_build_object('cardNumber', 'R2-2')
  ) returning id into v_mismatch_entry;

  insert into public.tcos_card_knowledge_observations(
    knowledge_entry_id,
    observation_key,
    confirmation_status,
    title,
    ai_result,
    consensus,
    catalog_evidence,
    result_payload
  ) values (
    v_mismatch_entry,
    'round2-mismatch-catalog',
    'catalog_confirmed',
    'Mismatched catalog confirmation',
    v_ai || jsonb_build_object('cardNumber', 'R2-2'),
    v_mismatch_payload->'consensus',
    v_mismatch_payload->'catalogEvidence',
    v_mismatch_payload
  );

  select confirmation_status
  into v_status
  from public.tcos_card_knowledge_observations
  where observation_key = 'round2-mismatch-catalog';
  if v_status <> 'scanner_observed' then
    raise exception 'Mismatched catalog identity was not downgraded: %', v_status;
  end if;

  insert into public.tcos_card_knowledge_entries(
    identity_fingerprint,
    title,
    ai_result
  ) values (
    'round2-exact-entry',
    'Round Two exact entry',
    v_ai || jsonb_build_object('cardNumber', 'R2-3')
  ) returning id into v_exact_entry;

  insert into public.tcos_card_knowledge_observations(
    knowledge_entry_id,
    observation_key,
    confirmation_status,
    title,
    ai_result,
    consensus,
    catalog_evidence,
    result_payload
  ) values (
    v_exact_entry,
    'round2-exact-operator',
    'operator_confirmed',
    'Exact operator confirmation',
    v_ai || jsonb_build_object('cardNumber', 'R2-3'),
    v_exact_payload->'consensus',
    v_exact_payload->'catalogEvidence',
    v_exact_payload
  );

  select confirmation_status
  into v_status
  from public.tcos_card_knowledge_observations
  where observation_key = 'round2-exact-operator';
  if v_status <> 'operator_confirmed' then
    raise exception 'Exact identity receipt was incorrectly downgraded: %', v_status;
  end if;

  insert into public.tcos_card_knowledge_entries(
    identity_fingerprint,
    title,
    ai_result
  ) values (
    'round2-explicit-entry',
    'Round Two explicit entry',
    v_ai || jsonb_build_object('cardNumber', 'R2-4')
  ) returning id into v_explicit_entry;

  insert into public.tcos_card_knowledge_observations(
    knowledge_entry_id,
    observation_key,
    confirmation_status,
    title,
    ai_result,
    operator_corrections,
    result_payload
  ) values (
    v_explicit_entry,
    'round2-explicit-operator',
    'operator_confirmed',
    'Explicit operator identity',
    v_ai || jsonb_build_object('cardNumber', 'R2-4'),
    jsonb_build_object(
      'player', 'Round Two Player',
      'year', '2026',
      'brand', 'Panini',
      'setName', 'Audit Set',
      'cardNumber', 'R2-4',
      'parallel', 'Blue'
    ),
    '{}'::jsonb
  );

  select confirmation_status
  into v_status
  from public.tcos_card_knowledge_observations
  where observation_key = 'round2-explicit-operator';
  if v_status <> 'operator_confirmed' then
    raise exception 'Complete explicit operator identity was rejected: %', v_status;
  end if;

  insert into public.instacomp_scan_knowledge_cache(
    image_fingerprint,
    front_image_sha256,
    response_payload,
    identity_confidence,
    trusted_for_pricing,
    confirmation_status
  ) values (
    'round2-forged-cache',
    repeat('a', 64),
    v_boolean_only_payload,
    0.99,
    true,
    'catalog_confirmed'
  );

  select trusted_for_pricing
  into v_trusted
  from public.instacomp_scan_knowledge_cache
  where image_fingerprint = 'round2-forged-cache';
  if v_trusted then
    raise exception 'Forged cache retained trusted pricing permission';
  end if;

  select confirmation_status
  into v_status
  from public.instacomp_scan_knowledge_cache
  where image_fingerprint = 'round2-forged-cache';
  if v_status <> 'scanner_observed' then
    raise exception 'Forged cache confirmation was not downgraded: %', v_status;
  end if;
end;
$$;

rollback;

select 'InstaComp learning provenance receipt attacks passed.' as result;
