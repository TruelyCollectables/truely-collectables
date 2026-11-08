-- Make trust-state recomputation review-first and require the original three
-- independent operator confirmations (or one catalog confirmation) before a
-- canonical knowledge promotion can become trusted.

create or replace function public.tcos_instacomp_refresh_knowledge_entry(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_observation_count integer := 0;
  v_scanner_count integer := 0;
  v_operator_count integer := 0;
  v_catalog_count integer := 0;
  v_last_observed timestamptz;
  v_has_review boolean := false;
  v_collision boolean := false;
  v_status text;
  v_row public.tcos_card_knowledge_entries%rowtype;
begin
  select
    count(*) filter (where confirmation_status <> 'operator_rejected')::integer,
    count(*) filter (where confirmation_status in ('scanner_observed','cache_replay'))::integer,
    count(*) filter (where confirmation_status = 'operator_confirmed')::integer,
    count(*) filter (where confirmation_status = 'catalog_confirmed')::integer,
    max(observed_at),
    bool_or(confirmation_status in ('operator_rejected','needs_more_info'))
  into
    v_observation_count,
    v_scanner_count,
    v_operator_count,
    v_catalog_count,
    v_last_observed,
    v_has_review
  from public.tcos_card_knowledge_observations
  where knowledge_entry_id = p_entry_id;

  select collision_detected
  into v_collision
  from public.tcos_card_knowledge_entries
  where id = p_entry_id;

  v_status := case
    when coalesce(v_collision, false) or coalesce(v_has_review, false)
      then 'needs_review'
    when v_catalog_count >= 1 or v_operator_count >= 3
      then 'tcos_trusted'
    else 'learning'
  end;

  update public.tcos_card_knowledge_entries
  set observation_count = v_observation_count,
      scanner_observed_count = v_scanner_count,
      catalog_confirmed_count = v_catalog_count,
      confirmed_count = v_operator_count + v_catalog_count,
      trust_status = v_status,
      trusted_at = case
        when v_status = 'tcos_trusted' then coalesce(trusted_at, now())
        else null
      end,
      last_seen_at = coalesce(v_last_observed, last_seen_at),
      last_observed_at = v_last_observed
  where id = p_entry_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'identityFingerprint', v_row.identity_fingerprint,
    'identityFingerprintV2', v_row.identity_fingerprint_v2,
    'title', v_row.title,
    'trustStatus', v_row.trust_status,
    'confirmedCount', v_row.confirmed_count,
    'observationCount', v_row.observation_count,
    'scannerObservedCount', v_row.scanner_observed_count,
    'catalogConfirmedCount', v_row.catalog_confirmed_count,
    'collisionDetected', v_row.collision_detected,
    'canonicalRevision', v_row.canonical_revision,
    'lastObservedAt', v_row.last_observed_at
  );
end;
$$;

create or replace function public.tcos_instacomp_protect_trusted_canonical()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.trust_status = 'tcos_trusted'
     and coalesce(current_setting('tcos.instacomp_canonical_promotion', true), '') <> 'on'
  then
    new.identity_fingerprint := old.identity_fingerprint;
    new.identity_fingerprint_v2 := old.identity_fingerprint_v2;
    new.title := old.title;
    new.year := old.year;
    new.brand := old.brand;
    new.set_name := old.set_name;
    new.card_number := old.card_number;
    new.player := old.player;
    new.parallel := old.parallel;
    new.variation := old.variation;
    new.serial_run := old.serial_run;
    new.serial_number := old.serial_number;
    new.team := old.team;
    new.sport := old.sport;
    new.is_rookie := old.is_rookie;
    new.is_auto := old.is_auto;
    new.is_relic := old.is_relic;
    new.ai_result := old.ai_result;
    new.operator_corrections := old.operator_corrections;
    new.catalog_evidence := old.catalog_evidence;
    new.consensus := old.consensus;
    new.market_snapshot := old.market_snapshot;
    new.source_coverage := old.source_coverage;
    new.result_payload := old.result_payload;
    new.canonical_revision := old.canonical_revision;
    new.canonical_promotion_status := old.canonical_promotion_status;
    new.canonical_promoted_at := old.canonical_promoted_at;
  end if;
  return new;
end;
$$;

create or replace function public.tcos_instacomp_promote_confirmed_observation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ai jsonb;
  v_entry public.tcos_card_knowledge_entries%rowtype;
  v_revision integer;
  v_operator_count integer := 0;
begin
  if new.confirmation_status not in ('operator_confirmed','catalog_confirmed') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.confirmation_status = new.confirmation_status
     and old.ai_result = new.ai_result
     and old.operator_corrections = new.operator_corrections
     and old.catalog_evidence = new.catalog_evidence
     and old.result_payload = new.result_payload
  then
    return new;
  end if;

  if new.confirmation_status = 'operator_confirmed' then
    select count(*)::integer
    into v_operator_count
    from public.tcos_card_knowledge_observations
    where knowledge_entry_id = new.knowledge_entry_id
      and confirmation_status = 'operator_confirmed';

    if v_operator_count < 3 then
      perform public.tcos_instacomp_refresh_knowledge_entry(new.knowledge_entry_id);
      return new;
    end if;
  end if;

  select * into v_entry
  from public.tcos_card_knowledge_entries
  where id = new.knowledge_entry_id
  for update;

  if v_entry.id is null then
    return new;
  end if;

  if v_entry.collision_detected then
    perform public.tcos_instacomp_refresh_knowledge_entry(new.knowledge_entry_id);
    return new;
  end if;

  v_ai := jsonb_strip_nulls(
    coalesce(new.ai_result, '{}'::jsonb) ||
    coalesce(new.operator_corrections, '{}'::jsonb)
  );
  v_revision := greatest(coalesce(v_entry.canonical_revision, 0), 0) + 1;

  perform set_config('tcos.instacomp_canonical_promotion', 'on', true);

  update public.tcos_card_knowledge_entries
  set identity_fingerprint = public.tcos_instacomp_knowledge_fingerprint(v_ai),
      identity_fingerprint_v2 = public.tcos_instacomp_knowledge_fingerprint(v_ai),
      title = public.tcos_instacomp_knowledge_title(v_ai),
      year = nullif(v_ai->>'year',''),
      brand = nullif(v_ai->>'brand',''),
      set_name = nullif(v_ai->>'setName',''),
      card_number = nullif(v_ai->>'cardNumber',''),
      player = nullif(v_ai->>'player',''),
      parallel = nullif(v_ai->>'parallel',''),
      variation = nullif(v_ai->>'variation',''),
      serial_run = public.tcos_instacomp_knowledge_serial_run(v_ai->>'serialNumber'),
      serial_number = nullif(v_ai->>'serialNumber',''),
      team = nullif(v_ai->>'team',''),
      sport = nullif(v_ai->>'sport',''),
      is_rookie = lower(coalesce(v_ai->>'isRookie','false')) in ('true','t','1','yes','y'),
      is_auto = lower(coalesce(v_ai->>'isAuto','false')) in ('true','t','1','yes','y'),
      is_relic = lower(coalesce(v_ai->>'isRelic','false')) in ('true','t','1','yes','y'),
      ai_result = v_ai,
      operator_corrections = coalesce(new.operator_corrections, '{}'::jsonb),
      catalog_evidence = coalesce(new.catalog_evidence, '{}'::jsonb),
      consensus = coalesce(new.consensus, '{}'::jsonb),
      result_payload = coalesce(new.result_payload, '{}'::jsonb),
      canonical_revision = v_revision,
      canonical_promotion_status = new.confirmation_status,
      canonical_promoted_at = now(),
      updated_at = now()
  where id = new.knowledge_entry_id
  returning * into v_entry;

  insert into public.tcos_card_knowledge_canonical_versions(
    knowledge_entry_id,
    revision,
    promoted_by_status,
    source_observation_id,
    identity_fingerprint,
    identity_fingerprint_v2,
    canonical_snapshot
  ) values (
    v_entry.id,
    v_revision,
    new.confirmation_status,
    new.id,
    v_entry.identity_fingerprint,
    v_entry.identity_fingerprint_v2,
    to_jsonb(v_entry)
  )
  on conflict(knowledge_entry_id, revision) do nothing;

  perform public.tcos_instacomp_refresh_knowledge_entry(new.knowledge_entry_id);
  return new;
exception
  when unique_violation then
    perform set_config('tcos.instacomp_canonical_promotion', 'on', true);
    update public.tcos_card_knowledge_entries
    set collision_detected = true,
        trust_status = 'needs_review',
        trusted_at = null,
        updated_at = now()
    where id = new.knowledge_entry_id;
    return new;
end;
$$;

revoke all on function public.tcos_instacomp_refresh_knowledge_entry(uuid)
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_protect_trusted_canonical()
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_promote_confirmed_observation()
  from public, anon, authenticated;

grant execute on function public.tcos_instacomp_refresh_knowledge_entry(uuid)
  to service_role;
grant execute on function public.tcos_instacomp_protect_trusted_canonical()
  to service_role;
grant execute on function public.tcos_instacomp_promote_confirmed_observation()
  to service_role;
