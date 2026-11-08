-- Process KINGMAKER Beckett checklist rematches in bounded transactions.
--
-- A checklist activation immediately handles a small first batch. Remaining
-- unresolved rows are marked by active checklist version and drained through
-- a service-role-only RPC. Rows that remain unmatched or ambiguous are not
-- retried for the same checklist version, but become eligible automatically
-- when a newer checklist version activates. OCR-derived prices remain review-only.

begin;

create index if not exists tcos_kingmaker_price_entries_rematch_version_idx
  on public.tcos_kingmaker_price_entries (
    identity_match_status,
    (metadata ->> 'lastChecklistRematchVersionId'),
    guide_id,
    public.tcos_kingmaker_price_normalize(release_year),
    public.tcos_kingmaker_price_normalize(manufacturer),
    public.tcos_kingmaker_price_normalize(product)
  )
  where entry_kind = 'card'
    and validation_status <> 'rejected'
    and low_observation_id is null
    and high_observation_id is null;

create or replace function public.tcos_rematch_kingmaker_price_entries_for_release_batch(
  p_release_id uuid,
  p_checklist_version_id uuid default null,
  p_batch_size integer default 100,
  p_trigger_source text default 'manual_batch'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  release_row record;
  run_id uuid;
  effective_batch_size integer := least(greatest(coalesce(p_batch_size, 100), 1), 1000);
  guide_ids uuid[] := '{}'::uuid[];
  candidate_entry_ids uuid[] := '{}'::uuid[];
  current_guide_id uuid;
  matcher_result jsonb;
  matcher_results_payload jsonb := '[]'::jsonb;
  candidate_count integer := 0;
  ambiguous_before_count integer := 0;
  unmatched_before_count integer := 0;
  exact_after_count integer := 0;
  ambiguous_after_count integer := 0;
  unmatched_after_count integer := 0;
  has_more_for_release boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_release_id::text, 0));

  select
    release.id as release_id,
    release.release_year,
    release.season,
    release.product_name,
    manufacturer.name as manufacturer_name,
    sport.name as sport_name,
    version.id as active_version_id,
    version.version_number
  into release_row
  from public.checklist_releases release
  join public.checklist_manufacturers manufacturer
    on manufacturer.id = release.manufacturer_id
  join public.checklist_sports sport
    on sport.id = release.sport_id
  join public.checklist_versions version
    on version.release_id = release.id
   and version.is_active
   and version.status in ('live', 'revised')
  where release.id = p_release_id
  order by
    version.activated_at desc nulls last,
    version.version_number desc
  limit 1;

  if release_row.release_id is null then
    raise exception 'No active Checklist Registry version exists for release %', p_release_id;
  end if;

  if p_checklist_version_id is not null
     and p_checklist_version_id <> release_row.active_version_id then
    insert into public.tcos_kingmaker_beckett_rematch_runs (
      release_id,
      checklist_version_id,
      trigger_source,
      status,
      completed_at,
      error_message
    ) values (
      p_release_id,
      p_checklist_version_id,
      p_trigger_source,
      'skipped',
      now(),
      format(
        'Version %s is no longer active; active version is %s.',
        p_checklist_version_id,
        release_row.active_version_id
      )
    ) returning id into run_id;

    return jsonb_build_object(
      'run_id', run_id,
      'release_id', p_release_id,
      'checklist_version_id', p_checklist_version_id,
      'active_version_id', release_row.active_version_id,
      'status', 'skipped',
      'reason', 'stale_checklist_version',
      'processed_entries', 0,
      'has_more', false,
      'batch_size', effective_batch_size
    );
  end if;

  with batch_rows as (
    select
      entry.id,
      entry.guide_id,
      entry.identity_match_status
    from public.tcos_kingmaker_price_entries entry
    join public.tcos_kingmaker_price_guides guide
      on guide.id = entry.guide_id
    where entry.entry_kind = 'card'
      and entry.validation_status <> 'rejected'
      and entry.low_observation_id is null
      and entry.high_observation_id is null
      and entry.identity_match_status in ('unmatched', 'ambiguous')
      and coalesce(entry.metadata ->> 'lastChecklistRematchVersionId', '') <>
          release_row.active_version_id::text
      and public.tcos_kingmaker_price_normalize(guide.sport) =
          public.tcos_kingmaker_price_normalize(release_row.sport_name)
      and public.tcos_kingmaker_price_normalize(entry.release_year) in (
        public.tcos_kingmaker_price_normalize(release_row.release_year),
        public.tcos_kingmaker_price_normalize(release_row.season)
      )
      and public.tcos_kingmaker_price_normalize(entry.manufacturer) =
          public.tcos_kingmaker_price_normalize(release_row.manufacturer_name)
      and public.tcos_kingmaker_price_normalize(release_row.product_name) in (
        public.tcos_kingmaker_price_normalize(entry.product),
        public.tcos_kingmaker_price_normalize(
          concat_ws(' ', entry.release_year, entry.product)
        )
      )
    order by entry.guide_id, entry.id
    limit effective_batch_size
  )
  select
    count(*),
    count(*) filter (where identity_match_status = 'ambiguous'),
    count(*) filter (where identity_match_status = 'unmatched'),
    coalesce(array_agg(distinct guide_id order by guide_id), '{}'::uuid[]),
    coalesce(array_agg(id order by guide_id, id), '{}'::uuid[])
  into
    candidate_count,
    ambiguous_before_count,
    unmatched_before_count,
    guide_ids,
    candidate_entry_ids
  from batch_rows;

  insert into public.tcos_kingmaker_beckett_rematch_runs (
    release_id,
    checklist_version_id,
    trigger_source,
    status,
    candidate_entries,
    guide_count,
    exact_before,
    ambiguous_before,
    unmatched_before
  ) values (
    p_release_id,
    release_row.active_version_id,
    p_trigger_source,
    'running',
    candidate_count,
    coalesce(cardinality(guide_ids), 0),
    0,
    ambiguous_before_count,
    unmatched_before_count
  ) returning id into run_id;

  if candidate_count = 0 then
    update public.tcos_kingmaker_beckett_rematch_runs
    set
      status = 'succeeded',
      completed_at = now()
    where id = run_id;

    return jsonb_build_object(
      'run_id', run_id,
      'release_id', p_release_id,
      'checklist_version_id', release_row.active_version_id,
      'status', 'succeeded',
      'processed_entries', 0,
      'candidate_entries', 0,
      'new_exact_matches', 0,
      'ambiguous_after', 0,
      'unmatched_after', 0,
      'has_more', false,
      'batch_size', effective_batch_size,
      'matcher_results', '[]'::jsonb
    );
  end if;

  update public.tcos_kingmaker_price_review_queue queue
  set
    status = 'resolved',
    resolved_at = now(),
    resolution_notes = concat_ws(
      ' ',
      nullif(queue.resolution_notes, ''),
      format(
        'Automatically superseded when Checklist Registry version %s was rematched in batch %s.',
        release_row.active_version_id,
        run_id
      )
    )
  where queue.entry_id = any(candidate_entry_ids)
    and queue.status in ('open', 'in_review')
    and queue.issue_type in (
      'identity_unmatched',
      'identity_ambiguous',
      'value_verification_required'
    );

  update public.tcos_kingmaker_price_entries entry
  set
    checklist_identity_id = null,
    identity_match_status = 'unmatched',
    validation_status = 'review',
    validation_reasons = (
      select coalesce(jsonb_agg(reason order by reason), '[]'::jsonb)
      from (
        select distinct existing.reason
        from jsonb_array_elements_text(
          coalesce(entry.validation_reasons, '[]'::jsonb)
        ) as existing(reason)
        where existing.reason not in (
          'multiple_registry_identities_matched',
          'exact_identity_matched_value_verification_required',
          'checklist_registry_updated_rematch'
        )
        union
        select 'checklist_registry_updated_rematch'
      ) reasons
    ),
    metadata = coalesce(entry.metadata, '{}'::jsonb) || jsonb_build_object(
      'lastChecklistRematchRunId', run_id,
      'lastChecklistRematchVersionId', release_row.active_version_id,
      'lastChecklistRematchAt', now(),
      'lastChecklistRematchBatchSize', effective_batch_size
    )
  where entry.id = any(candidate_entry_ids);

  foreach current_guide_id in array guide_ids
  loop
    select public.tcos_match_kingmaker_price_entry_ids(
      current_guide_id,
      candidate_entry_ids
    ) into matcher_result;
    matcher_results_payload :=
      matcher_results_payload || jsonb_build_array(matcher_result);
  end loop;

  select
    count(*) filter (where entry.identity_match_status = 'exact'),
    count(*) filter (where entry.identity_match_status = 'ambiguous'),
    count(*) filter (where entry.identity_match_status = 'unmatched')
  into
    exact_after_count,
    ambiguous_after_count,
    unmatched_after_count
  from public.tcos_kingmaker_price_entries entry
  where entry.id = any(candidate_entry_ids);

  select exists (
    select 1
    from public.tcos_kingmaker_price_entries entry
    join public.tcos_kingmaker_price_guides guide
      on guide.id = entry.guide_id
    where entry.entry_kind = 'card'
      and entry.validation_status <> 'rejected'
      and entry.low_observation_id is null
      and entry.high_observation_id is null
      and entry.identity_match_status in ('unmatched', 'ambiguous')
      and coalesce(entry.metadata ->> 'lastChecklistRematchVersionId', '') <>
          release_row.active_version_id::text
      and public.tcos_kingmaker_price_normalize(guide.sport) =
          public.tcos_kingmaker_price_normalize(release_row.sport_name)
      and public.tcos_kingmaker_price_normalize(entry.release_year) in (
        public.tcos_kingmaker_price_normalize(release_row.release_year),
        public.tcos_kingmaker_price_normalize(release_row.season)
      )
      and public.tcos_kingmaker_price_normalize(entry.manufacturer) =
          public.tcos_kingmaker_price_normalize(release_row.manufacturer_name)
      and public.tcos_kingmaker_price_normalize(release_row.product_name) in (
        public.tcos_kingmaker_price_normalize(entry.product),
        public.tcos_kingmaker_price_normalize(
          concat_ws(' ', entry.release_year, entry.product)
        )
      )
    limit 1
  ) into has_more_for_release;

  update public.tcos_kingmaker_beckett_rematch_runs
  set
    status = 'succeeded',
    exact_after = exact_after_count,
    ambiguous_after = ambiguous_after_count,
    unmatched_after = unmatched_after_count,
    matcher_results = matcher_results_payload,
    completed_at = now()
  where id = run_id;

  return jsonb_build_object(
    'run_id', run_id,
    'release_id', p_release_id,
    'checklist_version_id', release_row.active_version_id,
    'status', 'succeeded',
    'processed_entries', candidate_count,
    'candidate_entries', candidate_count,
    'guide_count', coalesce(cardinality(guide_ids), 0),
    'new_exact_matches', exact_after_count,
    'exact_after', exact_after_count,
    'ambiguous_after', ambiguous_after_count,
    'unmatched_after', unmatched_after_count,
    'has_more', has_more_for_release,
    'batch_size', effective_batch_size,
    'matcher_results', matcher_results_payload
  );
exception
  when others then
    if run_id is not null then
      update public.tcos_kingmaker_beckett_rematch_runs
      set
        status = 'failed',
        error_message = sqlerrm,
        completed_at = now()
      where id = run_id;
    end if;
    raise;
end;
$$;

create or replace function public.tcos_rematch_kingmaker_price_entries_for_release(
  p_release_id uuid,
  p_checklist_version_id uuid default null,
  p_trigger_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.tcos_rematch_kingmaker_price_entries_for_release_batch(
    p_release_id,
    p_checklist_version_id,
    500,
    p_trigger_source
  );
end;
$$;

create or replace function public.tcos_drain_kingmaker_price_rematch_batch(
  p_batch_size integer default 500,
  p_trigger_source text default 'scheduled_drain'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_release_id uuid;
  target_version_id uuid;
  result jsonb;
begin
  select
    release.id,
    version.id
  into
    target_release_id,
    target_version_id
  from public.checklist_releases release
  join public.checklist_manufacturers manufacturer
    on manufacturer.id = release.manufacturer_id
  join public.checklist_sports sport
    on sport.id = release.sport_id
  join public.checklist_versions version
    on version.release_id = release.id
   and version.is_active
   and version.status in ('live', 'revised')
  where exists (
    select 1
    from public.tcos_kingmaker_price_entries entry
    join public.tcos_kingmaker_price_guides guide
      on guide.id = entry.guide_id
    where entry.entry_kind = 'card'
      and entry.validation_status <> 'rejected'
      and entry.low_observation_id is null
      and entry.high_observation_id is null
      and entry.identity_match_status in ('unmatched', 'ambiguous')
      and coalesce(entry.metadata ->> 'lastChecklistRematchVersionId', '') <>
          version.id::text
      and public.tcos_kingmaker_price_normalize(guide.sport) =
          public.tcos_kingmaker_price_normalize(sport.name)
      and public.tcos_kingmaker_price_normalize(entry.release_year) in (
        public.tcos_kingmaker_price_normalize(release.release_year),
        public.tcos_kingmaker_price_normalize(release.season)
      )
      and public.tcos_kingmaker_price_normalize(entry.manufacturer) =
          public.tcos_kingmaker_price_normalize(manufacturer.name)
      and public.tcos_kingmaker_price_normalize(release.product_name) in (
        public.tcos_kingmaker_price_normalize(entry.product),
        public.tcos_kingmaker_price_normalize(
          concat_ws(' ', entry.release_year, entry.product)
        )
      )
    limit 1
  )
  order by
    version.activated_at asc nulls first,
    release.id,
    version.id
  limit 1;

  if target_release_id is null then
    return jsonb_build_object(
      'drain_status', 'idle',
      'status', 'succeeded',
      'processed_entries', 0,
      'new_exact_matches', 0,
      'has_more', false,
      'batch_size', least(greatest(coalesce(p_batch_size, 500), 1), 1000)
    );
  end if;

  result := public.tcos_rematch_kingmaker_price_entries_for_release_batch(
    target_release_id,
    target_version_id,
    p_batch_size,
    p_trigger_source
  );

  return result || jsonb_build_object(
    'drain_status', 'processed',
    'has_more', true
  );
end;
$$;

create or replace function public.tcos_trigger_kingmaker_beckett_rematch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active
     and new.status in ('live', 'revised')
     and new.activated_at is not null
     and (
       tg_op = 'INSERT'
       or old.is_active is distinct from new.is_active
       or old.status is distinct from new.status
       or old.activated_at is distinct from new.activated_at
     ) then
    perform public.tcos_rematch_kingmaker_price_entries_for_release_batch(
      new.release_id,
      new.id,
      100,
      'checklist_version_activation'
    );
  end if;
  return new;
end;
$$;

revoke all on function public.tcos_rematch_kingmaker_price_entries_for_release_batch(uuid, uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.tcos_rematch_kingmaker_price_entries_for_release(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.tcos_drain_kingmaker_price_rematch_batch(integer, text)
  from public, anon, authenticated;
revoke all on function public.tcos_trigger_kingmaker_beckett_rematch()
  from public, anon, authenticated;

grant execute on function public.tcos_rematch_kingmaker_price_entries_for_release_batch(uuid, uuid, integer, text)
  to service_role;
grant execute on function public.tcos_rematch_kingmaker_price_entries_for_release(uuid, uuid, text)
  to service_role;
grant execute on function public.tcos_drain_kingmaker_price_rematch_batch(integer, text)
  to service_role;
grant execute on function public.tcos_trigger_kingmaker_beckett_rematch()
  to service_role;

commit;
