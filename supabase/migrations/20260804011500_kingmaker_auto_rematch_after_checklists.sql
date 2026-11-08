-- Project KINGMAKER: automatically rematch unresolved Beckett rows when a
-- Checklist Registry version becomes active. OCR-derived values remain review-only.

begin;

create table if not exists public.tcos_kingmaker_beckett_rematch_runs (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.checklist_releases(id) on delete cascade,
  checklist_version_id uuid references public.checklist_versions(id) on delete set null,
  trigger_source text not null default 'manual',
  status text not null default 'running'
    check (status in ('running','succeeded','skipped','failed')),
  candidate_entries integer not null default 0 check (candidate_entries >= 0),
  guide_count integer not null default 0 check (guide_count >= 0),
  exact_before integer not null default 0 check (exact_before >= 0),
  ambiguous_before integer not null default 0 check (ambiguous_before >= 0),
  unmatched_before integer not null default 0 check (unmatched_before >= 0),
  exact_after integer not null default 0 check (exact_after >= 0),
  ambiguous_after integer not null default 0 check (ambiguous_after >= 0),
  unmatched_after integer not null default 0 check (unmatched_after >= 0),
  matcher_results jsonb not null default '[]'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tcos_kingmaker_beckett_rematch_runs_release_idx
  on public.tcos_kingmaker_beckett_rematch_runs (
    release_id,
    started_at desc
  );

create index if not exists tcos_kingmaker_price_entries_auto_rematch_idx
  on public.tcos_kingmaker_price_entries (
    public.tcos_kingmaker_price_normalize(release_year),
    public.tcos_kingmaker_price_normalize(manufacturer),
    public.tcos_kingmaker_price_normalize(product),
    identity_match_status,
    guide_id
  )
  where entry_kind = 'card'
    and validation_status <> 'rejected'
    and low_observation_id is null
    and high_observation_id is null;

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
declare
  release_row record;
  run_id uuid;
  guide_ids uuid[] := '{}'::uuid[];
  current_guide_id uuid;
  matcher_result jsonb;
  matcher_results jsonb := '[]'::jsonb;
  candidate_count integer := 0;
  exact_before_count integer := 0;
  ambiguous_before_count integer := 0;
  unmatched_before_count integer := 0;
  exact_after_count integer := 0;
  ambiguous_after_count integer := 0;
  unmatched_after_count integer := 0;
  run_started_at timestamptz := clock_timestamp();
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
   and version.status in ('live','revised')
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
      'reason', 'stale_checklist_version'
    );
  end if;

  select
    count(*),
    count(*) filter (where entry.identity_match_status = 'exact'),
    count(*) filter (where entry.identity_match_status = 'ambiguous'),
    count(*) filter (where entry.identity_match_status = 'unmatched'),
    coalesce(array_agg(distinct entry.guide_id), '{}'::uuid[])
  into
    candidate_count,
    exact_before_count,
    ambiguous_before_count,
    unmatched_before_count,
    guide_ids
  from public.tcos_kingmaker_price_entries entry
  join public.tcos_kingmaker_price_guides guide
    on guide.id = entry.guide_id
  where entry.entry_kind = 'card'
    and entry.validation_status <> 'rejected'
    and entry.low_observation_id is null
    and entry.high_observation_id is null
    and entry.identity_match_status in ('unmatched','ambiguous')
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
    );

  insert into public.tcos_kingmaker_beckett_rematch_runs (
    release_id,
    checklist_version_id,
    trigger_source,
    status,
    candidate_entries,
    guide_count,
    exact_before,
    ambiguous_before,
    unmatched_before,
    started_at
  ) values (
    p_release_id,
    release_row.active_version_id,
    p_trigger_source,
    'running',
    candidate_count,
    coalesce(array_length(guide_ids, 1), 0),
    exact_before_count,
    ambiguous_before_count,
    unmatched_before_count,
    run_started_at
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
      'candidate_entries', 0,
      'exact_after', 0,
      'ambiguous_after', 0,
      'unmatched_after', 0
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
        'Automatically superseded when Checklist Registry version %s activated.',
        release_row.active_version_id
      )
    )
  where queue.status in ('open','in_review')
    and queue.issue_type in (
      'identity_unmatched',
      'identity_ambiguous',
      'value_verification_required'
    )
    and exists (
      select 1
      from public.tcos_kingmaker_price_entries entry
      join public.tcos_kingmaker_price_guides guide
        on guide.id = entry.guide_id
      where entry.id = queue.entry_id
        and entry.entry_kind = 'card'
        and entry.validation_status <> 'rejected'
        and entry.low_observation_id is null
        and entry.high_observation_id is null
        and entry.identity_match_status in ('unmatched','ambiguous')
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
    );

  update public.tcos_kingmaker_price_entries entry
  set
    checklist_identity_id = null,
    identity_match_status = 'unmatched',
    validation_status = 'review',
    validation_reasons = (
      select coalesce(jsonb_agg(reason order by reason), '[]'::jsonb)
      from (
        select distinct reason
        from jsonb_array_elements_text(
          coalesce(entry.validation_reasons, '[]'::jsonb)
        ) as existing(reason)
        where reason not in (
          'multiple_registry_identities_matched',
          'exact_identity_matched_value_verification_required',
          'checklist_registry_updated_rematch'
        )
        union all
        select 'checklist_registry_updated_rematch'
      ) reasons
    ),
    metadata = coalesce(entry.metadata, '{}'::jsonb) || jsonb_build_object(
      'lastChecklistRematchRunId', run_id,
      'lastChecklistRematchVersionId', release_row.active_version_id,
      'lastChecklistRematchAt', now()
    )
  from public.tcos_kingmaker_price_guides guide
  where guide.id = entry.guide_id
    and entry.entry_kind = 'card'
    and entry.validation_status <> 'rejected'
    and entry.low_observation_id is null
    and entry.high_observation_id is null
    and entry.identity_match_status in ('unmatched','ambiguous')
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
    );

  foreach current_guide_id in array guide_ids
  loop
    select public.tcos_match_kingmaker_price_entries(current_guide_id)
      into matcher_result;
    matcher_results := matcher_results || jsonb_build_array(matcher_result);
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
  join public.tcos_kingmaker_price_guides guide
    on guide.id = entry.guide_id
  where entry.entry_kind = 'card'
    and entry.validation_status <> 'rejected'
    and entry.low_observation_id is null
    and entry.high_observation_id is null
    and entry.updated_at >= run_started_at
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
    );

  update public.tcos_kingmaker_beckett_rematch_runs
  set
    status = 'succeeded',
    exact_after = exact_after_count,
    ambiguous_after = ambiguous_after_count,
    unmatched_after = unmatched_after_count,
    matcher_results = matcher_results,
    completed_at = now()
  where id = run_id;

  return jsonb_build_object(
    'run_id', run_id,
    'release_id', p_release_id,
    'checklist_version_id', release_row.active_version_id,
    'status', 'succeeded',
    'candidate_entries', candidate_count,
    'guide_count', coalesce(array_length(guide_ids, 1), 0),
    'exact_before', exact_before_count,
    'ambiguous_before', ambiguous_before_count,
    'unmatched_before', unmatched_before_count,
    'exact_after', exact_after_count,
    'ambiguous_after', ambiguous_after_count,
    'unmatched_after', unmatched_after_count,
    'new_exact_matches', greatest(exact_after_count - exact_before_count, 0),
    'matcher_results', matcher_results
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

create or replace function public.tcos_trigger_kingmaker_beckett_rematch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active
     and new.status in ('live','revised')
     and new.activated_at is not null
     and (
       tg_op = 'INSERT'
       or old.is_active is distinct from new.is_active
       or old.status is distinct from new.status
       or old.activated_at is distinct from new.activated_at
     ) then
    perform public.tcos_rematch_kingmaker_price_entries_for_release(
      new.release_id,
      new.id,
      'checklist_version_activation'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists checklist_versions_kingmaker_beckett_rematch
  on public.checklist_versions;
create trigger checklist_versions_kingmaker_beckett_rematch
after insert or update of is_active, status, activated_at
on public.checklist_versions
for each row
execute function public.tcos_trigger_kingmaker_beckett_rematch();

alter table public.tcos_kingmaker_beckett_rematch_runs enable row level security;
revoke all on public.tcos_kingmaker_beckett_rematch_runs from anon, authenticated;
revoke all on function public.tcos_rematch_kingmaker_price_entries_for_release(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.tcos_trigger_kingmaker_beckett_rematch()
  from public, anon, authenticated;

grant select, insert, update, delete
  on public.tcos_kingmaker_beckett_rematch_runs to service_role;
grant execute
  on function public.tcos_rematch_kingmaker_price_entries_for_release(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
