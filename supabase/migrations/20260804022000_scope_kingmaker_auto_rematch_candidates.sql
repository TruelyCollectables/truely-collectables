-- Scope automatic Beckett rematching to the unresolved entry IDs for the
-- checklist release that just activated. This prevents a single checklist
-- update from rescanning every row in a large Beckett guide.

begin;

create or replace function public.tcos_match_kingmaker_price_entry_ids(
  p_guide_id uuid,
  p_entry_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_count integer := 0;
  ambiguous_count integer := 0;
  accepted_count integer := 0;
  review_count integer := 0;
  unmatched_count integer := 0;
begin
  if coalesce(cardinality(p_entry_ids), 0) = 0 then
    return jsonb_build_object(
      'guide_id', p_guide_id,
      'candidate_entries', 0,
      'matched', 0,
      'ambiguous', 0,
      'accepted', 0,
      'review', 0,
      'unmatched', 0,
      'scope', 'entry_ids'
    );
  end if;

  with candidate_rows as (
    select
      entry.id as entry_id,
      array_agg(distinct identity.id order by identity.id) as identity_ids,
      min(identity.canonical_key) as canonical_key,
      count(distinct identity.id) as candidate_count
    from public.tcos_kingmaker_price_entries entry
    join public.checklist_releases release
      on public.tcos_kingmaker_price_normalize(entry.release_year) in (
        public.tcos_kingmaker_price_normalize(release.release_year),
        public.tcos_kingmaker_price_normalize(release.season)
      )
    join public.checklist_manufacturers manufacturer
      on manufacturer.id = release.manufacturer_id
     and public.tcos_kingmaker_price_normalize(entry.manufacturer) =
         public.tcos_kingmaker_price_normalize(manufacturer.name)
    join public.checklist_versions version
      on version.release_id = release.id
     and version.is_active
    join public.checklist_sets set_row
      on set_row.release_id = release.id
     and set_row.version_id = version.id
     and (
       public.tcos_kingmaker_price_normalize(entry.set_name) =
         public.tcos_kingmaker_price_normalize(set_row.name)
       or (
         public.tcos_kingmaker_price_normalize(entry.set_name) = 'base'
         and set_row.set_type = 'base'
       )
     )
    join public.checklist_cards card
      on card.release_id = release.id
     and card.version_id = version.id
     and card.set_id = set_row.id
     and public.tcos_kingmaker_price_normalize(entry.card_number) =
         public.tcos_kingmaker_price_normalize(card.card_number)
    join public.checklist_card_identities identity
      on identity.release_id = release.id
     and identity.version_id = version.id
     and identity.set_id = set_row.id
     and identity.card_id = card.id
    left join public.checklist_parallels parallel
      on parallel.id = identity.parallel_id
    where entry.guide_id = p_guide_id
      and entry.id = any(p_entry_ids)
      and entry.entry_kind = 'card'
      and entry.validation_status <> 'rejected'
      and entry.card_number is not null
      and entry.product is not null
      and public.tcos_kingmaker_price_normalize(release.product_name) in (
        public.tcos_kingmaker_price_normalize(entry.product),
        public.tcos_kingmaker_price_normalize(
          concat_ws(' ', entry.release_year, entry.product)
        )
      )
      and (
        (
          nullif(public.tcos_kingmaker_price_normalize(entry.parallel_name), '') is null
          and identity.parallel_id is null
        )
        or public.tcos_kingmaker_price_normalize(entry.parallel_name) =
           public.tcos_kingmaker_price_normalize(parallel.name)
      )
    group by entry.id
  ), matched_rows as (
    update public.tcos_kingmaker_price_entries entry
    set
      checklist_identity_id = candidates.identity_ids[1],
      identity_match_status = case
        when candidates.candidate_count = 1 then 'exact'
        else 'ambiguous'
      end,
      entity_key = case
        when candidates.candidate_count = 1 then candidates.canonical_key
        else entry.entity_key
      end,
      validation_status = case
        when candidates.candidate_count = 1
          and coalesce(entry.metadata ->> 'sourceEngine', '') = 'text'
          and entry.parse_confidence >= 0.98
        then 'accepted'
        else 'review'
      end,
      validation_reasons = case
        when candidates.candidate_count = 1
          and coalesce(entry.metadata ->> 'sourceEngine', '') = 'text'
          and entry.parse_confidence >= 0.98
        then '[]'::jsonb
        when candidates.candidate_count = 1
        then coalesce(entry.validation_reasons, '[]'::jsonb) ||
             jsonb_build_array('exact_identity_matched_value_verification_required')
        else coalesce(entry.validation_reasons, '[]'::jsonb) ||
             jsonb_build_array('multiple_registry_identities_matched')
      end
    from candidate_rows candidates
    where entry.id = candidates.entry_id
    returning entry.identity_match_status, entry.validation_status
  )
  select
    count(*) filter (where identity_match_status = 'exact'),
    count(*) filter (where identity_match_status = 'ambiguous'),
    count(*) filter (where validation_status = 'accepted'),
    count(*) filter (where validation_status = 'review')
  into matched_count, ambiguous_count, accepted_count, review_count
  from matched_rows;

  insert into public.tcos_kingmaker_price_review_queue (
    guide_id,
    entry_id,
    page_number,
    issue_type,
    severity,
    reason,
    evidence
  )
  select
    entry.guide_id,
    entry.id,
    entry.page_number,
    case
      when entry.identity_match_status = 'ambiguous' then 'identity_ambiguous'
      when entry.identity_match_status = 'unmatched' then 'identity_unmatched'
      when entry.identity_match_status = 'exact' and entry.validation_status = 'review'
        then 'value_verification_required'
      else 'parser_review'
    end,
    case
      when entry.identity_match_status in ('ambiguous', 'exact') then 'high'
      else 'medium'
    end,
    case
      when entry.identity_match_status = 'ambiguous'
        then 'More than one active Checklist Registry identity matched this Beckett row.'
      when entry.identity_match_status = 'unmatched'
        then 'No exact active Checklist Registry identity matched this Beckett row.'
      when entry.identity_match_status = 'exact' and entry.validation_status = 'review'
        then 'Identity matched exactly, but OCR-derived values require visual verification before promotion.'
      else 'Parser marked this row for review.'
    end,
    jsonb_build_object(
      'source_row_key', entry.source_row_key,
      'raw_text', entry.raw_text,
      'validation_reasons', entry.validation_reasons,
      'identity_match_status', entry.identity_match_status,
      'parse_confidence', entry.parse_confidence,
      'match_scope', 'entry_ids'
    )
  from public.tcos_kingmaker_price_entries entry
  where entry.guide_id = p_guide_id
    and entry.id = any(p_entry_ids)
    and entry.entry_kind = 'card'
    and entry.validation_status = 'review'
    and not exists (
      select 1
      from public.tcos_kingmaker_price_review_queue queue
      where queue.entry_id = entry.id
        and queue.status in ('open', 'in_review')
    );

  select count(*)
  into unmatched_count
  from public.tcos_kingmaker_price_entries entry
  where entry.guide_id = p_guide_id
    and entry.id = any(p_entry_ids)
    and entry.entry_kind = 'card'
    and entry.identity_match_status = 'unmatched';

  return jsonb_build_object(
    'guide_id', p_guide_id,
    'candidate_entries', cardinality(p_entry_ids),
    'matched', matched_count,
    'ambiguous', ambiguous_count,
    'accepted', accepted_count,
    'review', review_count,
    'unmatched', unmatched_count,
    'scope', 'entry_ids'
  );
end;
$$;

do $migration$
declare
  function_signature constant regprocedure :=
    'public.tcos_rematch_kingmaker_price_entries_for_release(uuid,uuid,text)'::regprocedure;
  definition text;
  patched_definition text;
begin
  select pg_get_functiondef(function_signature)
  into definition;

  if definition is null then
    raise exception 'KINGMAKER checklist release rematch function is missing.';
  end if;

  patched_definition := definition;

  if position(
    'tcos_match_kingmaker_price_entry_ids(current_guide_id, candidate_entry_ids)'
    in patched_definition
  ) = 0 then
    patched_definition := regexp_replace(
      patched_definition,
      'select[[:space:]]+public\.tcos_match_kingmaker_price_entries\(current_guide_id\)[[:space:]]+into[[:space:]]+matcher_result;',
      'select public.tcos_match_kingmaker_price_entry_ids(current_guide_id, candidate_entry_ids) into matcher_result;',
      'g'
    );
  end if;

  if position(
    'tcos_match_kingmaker_price_entries(current_guide_id)'
    in patched_definition
  ) > 0 then
    raise exception 'Full-guide KINGMAKER rematch call remains after scoped patch.';
  end if;

  if position(
    'tcos_match_kingmaker_price_entry_ids(current_guide_id, candidate_entry_ids)'
    in patched_definition
  ) = 0 then
    raise exception 'Scoped KINGMAKER rematch helper call was not installed.';
  end if;

  if patched_definition is distinct from definition then
    execute patched_definition;
  end if;
end;
$migration$;

revoke all on function public.tcos_match_kingmaker_price_entry_ids(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.tcos_match_kingmaker_price_entry_ids(uuid, uuid[])
  to service_role;

revoke all on function public.tcos_rematch_kingmaker_price_entries_for_release(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.tcos_rematch_kingmaker_price_entries_for_release(uuid, uuid, text)
  to service_role;

commit;
