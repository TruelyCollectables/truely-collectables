begin;

create extension if not exists pgcrypto;

create table if not exists public.tcos_mi_search_candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_fingerprint text not null unique,
  source_slug text not null,
  collectible_identity_id uuid null references public.tcos_mi_collectible_identities(id) on delete set null,
  external_listing_id text null,
  direct_url text not null,
  original_title text not null,
  description text null,
  image_urls jsonb not null default '[]'::jsonb,
  listing_format text not null default 'unknown',
  asking_price numeric(12,2) not null default 0,
  shipping_price numeric(12,2) not null default 0,
  buyer_fee numeric(12,2) not null default 0,
  quantity integer not null default 1 check (quantity > 0),
  seller_name text null,
  seller_rating numeric(6,2) null,
  listed_at timestamptz null,
  auction_end_at timestamptz null,
  query_mode text null,
  query_text text null,
  candidate_confidence numeric(6,2) null,
  candidate_priority_score numeric(10,2) null,
  status text not null default 'pending_review' check (
    status in (
      'pending_review',
      'probable_exact',
      'verified_exact',
      'conflict_detected',
      'rejected',
      'promoted'
    )
  ),
  evidence jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  promoted_listing_id uuid null references public.tcos_mi_listings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tcos_mi_search_candidates_status_idx
  on public.tcos_mi_search_candidates(status, candidate_priority_score desc, last_seen_at desc);
create index if not exists tcos_mi_search_candidates_identity_idx
  on public.tcos_mi_search_candidates(collectible_identity_id, status);
create index if not exists tcos_mi_search_candidates_source_idx
  on public.tcos_mi_search_candidates(source_slug, last_seen_at desc);

create table if not exists public.tcos_mi_identity_proof_reviews (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid null references public.tcos_mi_listings(id) on delete cascade,
  candidate_id uuid null references public.tcos_mi_search_candidates(id) on delete cascade,
  collectible_identity_id uuid null references public.tcos_mi_collectible_identities(id) on delete set null,
  prior_status text null,
  decision text not null check (
    decision in (
      'review_required',
      'probable_exact',
      'verified_exact',
      'conflict_detected',
      'rejected',
      'promoted'
    )
  ),
  reviewer text not null default 'private_owner',
  notes text null,
  evidence jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint tcos_mi_identity_proof_reviews_target_check
    check (listing_id is not null or candidate_id is not null)
);

create index if not exists tcos_mi_identity_proof_reviews_listing_idx
  on public.tcos_mi_identity_proof_reviews(listing_id, reviewed_at desc);
create index if not exists tcos_mi_identity_proof_reviews_candidate_idx
  on public.tcos_mi_identity_proof_reviews(candidate_id, reviewed_at desc);

alter table public.tcos_mi_search_candidates enable row level security;
alter table public.tcos_mi_identity_proof_reviews enable row level security;

comment on table public.tcos_mi_search_candidates is
  'Private Profit Hunter staging queue. External workers write unverified marketplace candidates here; only operator-reviewed candidates are promoted.';
comment on table public.tcos_mi_identity_proof_reviews is
  'Immutable private-owner audit trail for exact-card identity proof decisions.';

create or replace function public.tcos_mi_enforce_identity_proof_on_deal_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  proof_status text;
  is_mislisted boolean;
begin
  select
    coalesce(l.metadata ->> 'identity_proof_status', 'review_required'),
    coalesce(l.suspected_mislisting, false)
  into proof_status, is_mislisted
  from public.tcos_mi_listings l
  where l.id = new.listing_id;

  if coalesce(proof_status, 'review_required') <> 'verified_exact' then
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
        'Identity Proof Gate suppressed this recommendation; proof status is %s.',
        coalesce(proof_status, 'review_required')
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists tcos_mi_identity_proof_deal_score_trigger
  on public.tcos_mi_deal_scores;
create trigger tcos_mi_identity_proof_deal_score_trigger
before insert or update on public.tcos_mi_deal_scores
for each row execute function public.tcos_mi_enforce_identity_proof_on_deal_score();

create or replace function public.tcos_mi_enforce_identity_proof_on_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  proof_status text;
  operator_confirmed boolean;
begin
  if new.source_listing_id is null then
    return new;
  end if;

  select
    coalesce(l.metadata ->> 'identity_proof_status', 'review_required'),
    coalesce((l.metadata ->> 'identity_proof_operator_confirmed')::boolean, false)
  into proof_status, operator_confirmed
  from public.tcos_mi_listings l
  where l.id = new.source_listing_id;

  if proof_status <> 'verified_exact' or not operator_confirmed then
    raise exception
      'Identity Proof Gate blocked purchase: source listing % is not operator-verified exact (status %).',
      new.source_listing_id,
      coalesce(proof_status, 'review_required')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists tcos_mi_identity_proof_purchase_trigger
  on public.tcos_mi_purchase_lots;
create trigger tcos_mi_identity_proof_purchase_trigger
before insert on public.tcos_mi_purchase_lots
for each row execute function public.tcos_mi_enforce_identity_proof_on_purchase();

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
    'Identity Proof Gate suppressed this existing recommendation until private-owner exact-card verification.'
  )
from public.tcos_mi_listings l
where l.id = ds.listing_id
  and coalesce(l.metadata ->> 'identity_proof_status', 'review_required') <> 'verified_exact'
  and ds.actionable = true;

commit;
