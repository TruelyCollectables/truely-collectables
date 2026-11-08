begin;

create or replace function public.tcos_mi_identity_proof_is_complete(proof_metadata jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    coalesce(proof_metadata ->> 'identity_proof_status', 'review_required') = 'verified_exact'
    and lower(coalesce(proof_metadata ->> 'identity_proof_operator_confirmed', 'false')) = 'true'
    and lower(coalesce(proof_metadata -> 'identity_proof_evidence' ->> 'front_image_confirmed', 'false')) = 'true'
    and (
      lower(coalesce(proof_metadata -> 'identity_proof_evidence' ->> 'back_image_confirmed', 'false')) = 'true'
      or lower(coalesce(proof_metadata -> 'identity_proof_evidence' ->> 'slab_label_confirmed', 'false')) = 'true'
    )
    and lower(coalesce(proof_metadata -> 'identity_proof_evidence' ->> 'checklist_confirmed', 'false')) = 'true'
    and lower(coalesce(proof_metadata -> 'identity_proof_evidence' ->> 'card_number_confirmed', 'false')) = 'true'
    and lower(coalesce(proof_metadata -> 'identity_proof_evidence' ->> 'parallel_confirmed', 'false')) = 'true'
    and lower(coalesce(proof_metadata -> 'identity_proof_evidence' ->> 'no_conflicting_evidence', 'false')) = 'true'
    and (
      lower(coalesce(proof_metadata -> 'identity_proof_requirements' ->> 'serial_numbered', 'false')) <> 'true'
      or lower(coalesce(proof_metadata -> 'identity_proof_evidence' ->> 'serial_number_confirmed', 'false')) = 'true'
    )
    and (
      (
        lower(coalesce(proof_metadata -> 'identity_proof_requirements' ->> 'autograph', 'false')) <> 'true'
        and lower(coalesce(proof_metadata -> 'identity_proof_requirements' ->> 'memorabilia', 'false')) <> 'true'
      )
      or lower(coalesce(proof_metadata -> 'identity_proof_evidence' ->> 'autograph_relic_confirmed', 'false')) = 'true'
    );
$$;

comment on function public.tcos_mi_identity_proof_is_complete(jsonb) is
  'Returns true only when Identity Proof Gate v2 has operator confirmation and every core plus conditionally required evidence field.';

create or replace function public.tcos_mi_enforce_identity_proof_on_deal_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  listing_metadata jsonb;
  proof_status text;
  is_mislisted boolean;
begin
  select
    coalesce(l.metadata, '{}'::jsonb),
    coalesce(l.metadata ->> 'identity_proof_status', 'review_required'),
    coalesce(l.suspected_mislisting, false)
  into listing_metadata, proof_status, is_mislisted
  from public.tcos_mi_listings l
  where l.id = new.listing_id;

  if not public.tcos_mi_identity_proof_is_complete(listing_metadata) then
    new.actionable := false;
    if new.deal_label in (
      'too_good_to_be_true',
      'steal',
      'great_buy',
      'good_buy',
      'wholesale_opportunity'
    ) then
      new.deal_label := case when is_mislisted then 'mislisted' else 'watch' end;
    end if;
    new.risk_notes := concat_ws(
      ' ',
      nullif(new.risk_notes, ''),
      format(
        'Identity Proof Gate v2 suppressed this recommendation; proof status is %s or required evidence is incomplete.',
        coalesce(proof_status, 'review_required')
      )
    );
  end if;

  return new;
end;
$$;

create or replace function public.tcos_mi_enforce_identity_proof_on_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  listing_metadata jsonb;
  proof_status text;
begin
  if new.source_listing_id is null then
    return new;
  end if;

  select
    coalesce(l.metadata, '{}'::jsonb),
    coalesce(l.metadata ->> 'identity_proof_status', 'review_required')
  into listing_metadata, proof_status
  from public.tcos_mi_listings l
  where l.id = new.source_listing_id;

  if not public.tcos_mi_identity_proof_is_complete(listing_metadata) then
    raise exception
      'Identity Proof Gate blocked purchase: source listing % is not fully operator-verified exact (status %).',
      new.source_listing_id,
      coalesce(proof_status, 'review_required')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.tcos_mi_enforce_candidate_promotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'promoted' then
    return new;
  end if;

  if new.promoted_listing_id is null then
    raise exception 'Promoted candidate % must reference its promoted listing.', new.id
      using errcode = 'check_violation';
  end if;

  if new.listing_format = 'lot'
     or new.query_mode = 'lot'
     or lower(coalesce(new.evidence ->> 'requires_lot_workflow', 'false')) = 'true' then
    raise exception 'Single-card promotion blocked: candidate % requires the lot-composition workflow.', new.id
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.tcos_mi_search_candidates sibling
    where sibling.id <> new.id
      and sibling.source_slug = new.source_slug
      and (
        (new.external_listing_id is not null and sibling.external_listing_id = new.external_listing_id)
        or (new.external_listing_id is null and sibling.direct_url = new.direct_url)
      )
      and sibling.status <> 'rejected'
      and sibling.collectible_identity_id is not null
      and sibling.collectible_identity_id is distinct from new.collectible_identity_id
  ) then
    raise exception 'Promotion blocked: candidate % has an unresolved sibling identity for the same marketplace listing.', new.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists tcos_mi_candidate_promotion_guard_trigger
  on public.tcos_mi_search_candidates;
create trigger tcos_mi_candidate_promotion_guard_trigger
before insert or update on public.tcos_mi_search_candidates
for each row execute function public.tcos_mi_enforce_candidate_promotion();

create or replace function public.tcos_mi_protect_verified_listing_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.collectible_identity_id is distinct from new.collectible_identity_id
     and public.tcos_mi_identity_proof_is_complete(coalesce(old.metadata, '{}'::jsonb)) then
    raise exception 'Verified listing % cannot be reassigned to a different collectible identity.', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists tcos_mi_verified_listing_identity_guard_trigger
  on public.tcos_mi_listings;
create trigger tcos_mi_verified_listing_identity_guard_trigger
before update of collectible_identity_id on public.tcos_mi_listings
for each row execute function public.tcos_mi_protect_verified_listing_identity();

update public.tcos_mi_deal_scores ds
set
  actionable = false,
  deal_label = case
    when coalesce(l.suspected_mislisting, false) then 'mislisted'
    else 'watch'
  end,
  risk_notes = concat_ws(
    ' ',
    nullif(ds.risk_notes, ''),
    'Identity Proof Gate v2 suppressed this existing recommendation until complete private-owner exact-card verification.'
  )
from public.tcos_mi_listings l
where l.id = ds.listing_id
  and not public.tcos_mi_identity_proof_is_complete(coalesce(l.metadata, '{}'::jsonb))
  and ds.actionable = true;

comment on function public.tcos_mi_enforce_candidate_promotion() is
  'Blocks lot promotion and unresolved cross-identity promotion in the single-card Profit Hunter flow.';
comment on function public.tcos_mi_protect_verified_listing_identity() is
  'Prevents a fully verified listing from being overwritten with a different collectible identity.';

commit;
