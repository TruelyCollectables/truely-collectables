\set ON_ERROR_STOP on

do $$
declare
  v_collision_a uuid;
  v_collision_b uuid;
  v_catalog_entry uuid;
  v_operator_entry uuid;
  v_ai_catalog jsonb := jsonb_build_object(
    'player', 'Catalog Player',
    'year', '2026',
    'brand', 'Panini',
    'setName', 'Hardening Set',
    'cardNumber', 'CAT-1',
    'parallel', 'Silver',
    'variation', 'Photo A',
    'serialNumber', null,
    'team', 'Test Team',
    'sport', 'Basketball',
    'isRookie', false,
    'isAuto', false,
    'isRelic', false,
    'gradingCompany', null,
    'gradeValue', null,
    'languageCode', 'en',
    'configurationExclusivity', 'hobby'
  );
  v_ai_operator jsonb := jsonb_build_object(
    'player', 'Operator Player',
    'year', '2026',
    'brand', 'Topps',
    'setName', 'Three Witness Set',
    'cardNumber', 'OP-3',
    'parallel', 'Gold',
    'variation', null,
    'serialNumber', '03/50',
    'team', 'Witness Team',
    'sport', 'Baseball',
    'isRookie', true,
    'isAuto', true,
    'isRelic', false,
    'gradingCompany', null,
    'gradeValue', null,
    'languageCode', 'en',
    'configurationExclusivity', 'hobby'
  );
  v_count integer;
  v_status text;
  v_revision integer;
  v_player text;
  v_title text;
begin
  -- Two legacy rows with different old fingerprints but one complete v2
  -- identity must never silently merge or remain trusted.
  insert into public.tcos_card_knowledge_entries(
    identity_fingerprint, title, year, brand, set_name, card_number,
    player, parallel, variation, is_auto, is_relic, ai_result
  ) values (
    'legacy-collision-a', 'Collision A', '2025', 'Panini', 'Collision Set', '1',
    'Collision Player', 'Base', 'Photo A', false, false,
    jsonb_build_object(
      'player','Collision Player','year','2025','brand','Panini',
      'setName','Collision Set','cardNumber','1','parallel','Base',
      'variation','Photo A','isAuto',false,'isRelic',false
    )
  ) returning id into v_collision_a;

  insert into public.tcos_card_knowledge_entries(
    identity_fingerprint, title, year, brand, set_name, card_number,
    player, parallel, variation, is_auto, is_relic, ai_result
  ) values (
    'legacy-collision-b', 'Collision B', '2025', 'Panini', 'Collision Set', '1',
    'Collision Player', 'Base', 'Photo A', false, false,
    jsonb_build_object(
      'player','Collision Player','year','2025','brand','Panini',
      'setName','Collision Set','cardNumber','1','parallel','Base',
      'variation','Photo A','isAuto',false,'isRelic',false
    )
  ) returning id into v_collision_b;

  select count(*) into v_count
  from public.tcos_card_knowledge_entries
  where id in (v_collision_a, v_collision_b)
    and collision_detected
    and trust_status = 'needs_review';
  if v_count <> 2 then
    raise exception 'Future v2 collision did not fail closed for both rows';
  end if;

  select count(*) into v_count
  from public.tcos_card_knowledge_collision_audit
  where identity_fingerprint_v2 = (
    select identity_fingerprint_v2
    from public.tcos_card_knowledge_entries
    where id = v_collision_a
  )
    and entry_count = 2
    and status = 'open';
  if v_count <> 1 then
    raise exception 'Future v2 collision audit receipt was not created';
  end if;

  -- One catalog confirmation may promote a clean canonical identity.
  insert into public.tcos_card_knowledge_entries(
    identity_fingerprint, title, year, brand, set_name, card_number,
    player, parallel, variation, team, sport, is_auto, is_relic, ai_result
  ) values (
    'legacy-catalog-entry', 'Catalog Candidate', '2026', 'Panini',
    'Hardening Set', 'CAT-1', 'Catalog Player', 'Silver', 'Photo A',
    'Test Team', 'Basketball', false, false, v_ai_catalog
  ) returning id into v_catalog_entry;

  insert into public.tcos_card_knowledge_observations(
    knowledge_entry_id, observation_key, confirmation_status, title,
    ai_result, catalog_evidence, result_payload, observed_at
  ) values (
    v_catalog_entry, 'catalog-hardening-1', 'catalog_confirmed',
    'Catalog Player confirmed', v_ai_catalog,
    jsonb_build_object('status','catalog_confirmed','catalogConfirmed',true),
    jsonb_build_object('ok',true,'ai',v_ai_catalog), now()
  );

  select trust_status, canonical_revision, player, title
  into v_status, v_revision, v_player, v_title
  from public.tcos_card_knowledge_entries
  where id = v_catalog_entry;

  if v_status <> 'tcos_trusted' or v_revision <> 1
     or v_player <> 'Catalog Player' then
    raise exception 'Catalog promotion failed: status %, revision %, player %',
      v_status, v_revision, v_player;
  end if;

  select count(*) into v_count
  from public.tcos_card_knowledge_canonical_versions
  where knowledge_entry_id = v_catalog_entry
    and revision = 1
    and promoted_by_status = 'catalog_confirmed';
  if v_count <> 1 then
    raise exception 'Catalog canonical version history was not appended';
  end if;

  -- Simulate a later bad scanner upsert in a separate logical request. The
  -- canonical identity and payload must remain unchanged.
  perform set_config('tcos.instacomp_canonical_promotion', 'off', true);
  update public.tcos_card_knowledge_entries
  set player = 'Poisoned Scanner Player',
      title = 'Poisoned Scanner Title',
      ai_result = jsonb_build_object('player','Poisoned Scanner Player')
  where id = v_catalog_entry;

  select player, title into v_player, v_title
  from public.tcos_card_knowledge_entries
  where id = v_catalog_entry;
  if v_player <> 'Catalog Player' or v_title = 'Poisoned Scanner Title' then
    raise exception 'Trusted canonical knowledge was overwritten by scanner data';
  end if;

  -- A review flag must override earlier trust instead of being hidden behind
  -- the confirmation count.
  update public.tcos_card_knowledge_observations
  set confirmation_status = 'needs_more_info'
  where observation_key = 'catalog-hardening-1';
  perform public.tcos_instacomp_refresh_knowledge_entry(v_catalog_entry);

  select trust_status into v_status
  from public.tcos_card_knowledge_entries
  where id = v_catalog_entry;
  if v_status <> 'needs_review' then
    raise exception 'Review-first trust recomputation failed: %', v_status;
  end if;

  -- Operator evidence still requires three independent confirmed observations.
  insert into public.tcos_card_knowledge_entries(
    identity_fingerprint, title, year, brand, set_name, card_number,
    player, parallel, serial_number, team, sport, is_rookie, is_auto,
    is_relic, ai_result
  ) values (
    'legacy-operator-entry', 'Operator Candidate', '2026', 'Topps',
    'Three Witness Set', 'OP-3', 'Operator Player', 'Gold', '03/50',
    'Witness Team', 'Baseball', true, true, false, v_ai_operator
  ) returning id into v_operator_entry;

  insert into public.tcos_card_knowledge_observations(
    knowledge_entry_id, observation_key, confirmation_status, title,
    ai_result, operator_corrections, result_payload, observed_at
  ) values (
    v_operator_entry, 'operator-hardening-1', 'operator_confirmed',
    'Operator witness 1', v_ai_operator, '{}'::jsonb,
    jsonb_build_object('ok',true,'ai',v_ai_operator), now()
  );

  select trust_status, canonical_revision into v_status, v_revision
  from public.tcos_card_knowledge_entries where id = v_operator_entry;
  if v_status <> 'learning' or v_revision <> 0 then
    raise exception 'One operator witness promoted too early: %, %',
      v_status, v_revision;
  end if;

  insert into public.tcos_card_knowledge_observations(
    knowledge_entry_id, observation_key, confirmation_status, title,
    ai_result, operator_corrections, result_payload, observed_at
  ) values (
    v_operator_entry, 'operator-hardening-2', 'operator_confirmed',
    'Operator witness 2', v_ai_operator, '{}'::jsonb,
    jsonb_build_object('ok',true,'ai',v_ai_operator), now()
  );

  select trust_status, canonical_revision into v_status, v_revision
  from public.tcos_card_knowledge_entries where id = v_operator_entry;
  if v_status <> 'learning' or v_revision <> 0 then
    raise exception 'Two operator witnesses promoted too early: %, %',
      v_status, v_revision;
  end if;

  insert into public.tcos_card_knowledge_observations(
    knowledge_entry_id, observation_key, confirmation_status, title,
    ai_result, operator_corrections, result_payload, observed_at
  ) values (
    v_operator_entry, 'operator-hardening-3', 'operator_confirmed',
    'Operator witness 3', v_ai_operator, '{}'::jsonb,
    jsonb_build_object('ok',true,'ai',v_ai_operator), now()
  );

  select trust_status, canonical_revision into v_status, v_revision
  from public.tcos_card_knowledge_entries where id = v_operator_entry;
  if v_status <> 'tcos_trusted' or v_revision <> 1 then
    raise exception 'Three operator witnesses did not promote: %, %',
      v_status, v_revision;
  end if;

  select count(*) into v_count
  from public.tcos_card_knowledge_canonical_versions
  where knowledge_entry_id = v_operator_entry
    and revision = 1
    and promoted_by_status = 'operator_confirmed';
  if v_count <> 1 then
    raise exception 'Operator canonical version history was not appended';
  end if;
end;
$$;

select 'InstaComp cache and canonical knowledge hardening verified.' as result;
