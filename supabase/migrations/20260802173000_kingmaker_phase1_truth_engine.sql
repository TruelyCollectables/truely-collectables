begin;

create extension if not exists pgcrypto;

create table if not exists public.tcos_kingmaker_opportunities (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_key text not null,
  source_watch text,
  source_listing_id uuid references public.tcos_mi_listings(id) on delete set null,
  collectible_identity_id uuid references public.tcos_mi_collectible_identities(id) on delete set null,
  title text not null,
  direct_url text,
  marketplace text,
  seller_name text,
  asking_price numeric(12,2),
  shipping_price numeric(12,2),
  buyer_fee numeric(12,2),
  delivered_cost numeric(12,2),
  identity_status text not null default 'review_required',
  market_status text not null default 'unverified',
  lifecycle_status text not null default 'new',
  owner_decision text,
  owner_decision_reason text,
  decision_at timestamptz,
  purchased_lot_id uuid references public.tcos_mi_purchase_lots(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kingmaker_opportunity_source_key_unique unique (source_type, source_key),
  constraint kingmaker_opportunity_source_type_check check (source_type in (
    'ebay', 'mercari', 'poshmark', 'comc', 'whatnot', 'fanatics_collect',
    'collx', 'facebook', 'card_show', 'dealer', 'private_seller',
    'seller_sweep', 'manual', 'other'
  )),
  constraint kingmaker_opportunity_identity_status_check check (identity_status in (
    'review_required', 'verified_exact', 'rejected_conflict', 'unavailable'
  )),
  constraint kingmaker_opportunity_market_status_check check (market_status in (
    'unverified', 'verified_completed_sales', 'insufficient_sales', 'stale', 'unavailable'
  )),
  constraint kingmaker_opportunity_lifecycle_status_check check (lifecycle_status in (
    'new', 'reviewing', 'watching', 'offer_planned', 'offer_sent', 'bought',
    'passed', 'expired', 'lost', 'cancelled', 'archived'
  )),
  constraint kingmaker_opportunity_owner_decision_check check (
    owner_decision is null or owner_decision in (
      'buy', 'make_offer', 'watch', 'pass', 'research', 'ignore'
    )
  ),
  constraint kingmaker_opportunity_nonnegative_money_check check (
    coalesce(asking_price, 0) >= 0 and
    coalesce(shipping_price, 0) >= 0 and
    coalesce(buyer_fee, 0) >= 0 and
    coalesce(delivered_cost, 0) >= 0
  ),
  constraint kingmaker_opportunity_bought_requires_purchase_check check (
    lifecycle_status <> 'bought' or purchased_lot_id is not null
  )
);

create index if not exists kingmaker_opportunities_lifecycle_idx
  on public.tcos_kingmaker_opportunities (lifecycle_status, updated_at desc);
create index if not exists kingmaker_opportunities_watch_idx
  on public.tcos_kingmaker_opportunities (source_watch, last_seen_at desc);
create index if not exists kingmaker_opportunities_listing_idx
  on public.tcos_kingmaker_opportunities (source_listing_id)
  where source_listing_id is not null;
create index if not exists kingmaker_opportunities_purchase_idx
  on public.tcos_kingmaker_opportunities (purchased_lot_id)
  where purchased_lot_id is not null;

create table if not exists public.tcos_kingmaker_opportunity_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.tcos_kingmaker_opportunities(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system',
  prior_status text,
  next_status text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint kingmaker_opportunity_event_actor_check check (actor_type in ('system', 'owner', 'import', 'reconciliation'))
);

create index if not exists kingmaker_opportunity_events_opportunity_idx
  on public.tcos_kingmaker_opportunity_events (opportunity_id, created_at desc);

create or replace function public.tcos_kingmaker_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tcos_kingmaker_opportunities_touch_updated_at
  on public.tcos_kingmaker_opportunities;
create trigger tcos_kingmaker_opportunities_touch_updated_at
before update on public.tcos_kingmaker_opportunities
for each row execute function public.tcos_kingmaker_touch_updated_at();

create or replace function public.tcos_kingmaker_record_opportunity_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.tcos_kingmaker_opportunity_events (
      opportunity_id, event_type, actor_type, next_status, metadata
    ) values (
      new.id, 'opportunity_created', 'import', new.lifecycle_status,
      jsonb_build_object('source_type', new.source_type, 'source_key', new.source_key)
    );
    return new;
  end if;

  if old.lifecycle_status is distinct from new.lifecycle_status
     or old.owner_decision is distinct from new.owner_decision
     or old.purchased_lot_id is distinct from new.purchased_lot_id then
    insert into public.tcos_kingmaker_opportunity_events (
      opportunity_id, event_type, actor_type, prior_status, next_status, reason, metadata
    ) values (
      new.id,
      case
        when old.purchased_lot_id is distinct from new.purchased_lot_id and new.purchased_lot_id is not null
          then 'purchase_linked'
        when old.owner_decision is distinct from new.owner_decision
          then 'owner_decision_changed'
        else 'lifecycle_changed'
      end,
      case when old.owner_decision is distinct from new.owner_decision then 'owner' else 'system' end,
      old.lifecycle_status,
      new.lifecycle_status,
      new.owner_decision_reason,
      jsonb_build_object(
        'prior_decision', old.owner_decision,
        'next_decision', new.owner_decision,
        'purchase_lot_id', new.purchased_lot_id
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists tcos_kingmaker_opportunities_record_event
  on public.tcos_kingmaker_opportunities;
create trigger tcos_kingmaker_opportunities_record_event
after insert or update on public.tcos_kingmaker_opportunities
for each row execute function public.tcos_kingmaker_record_opportunity_event();

create or replace view public.tcos_kingmaker_truth_lifecycle
with (security_invoker = true)
as
select
  o.id as opportunity_id,
  o.source_type,
  o.source_key,
  o.source_watch,
  o.source_listing_id,
  o.collectible_identity_id,
  o.title,
  o.direct_url,
  o.marketplace,
  o.seller_name,
  o.asking_price,
  o.shipping_price,
  o.buyer_fee,
  o.delivered_cost,
  o.identity_status,
  o.market_status,
  o.lifecycle_status,
  o.owner_decision,
  o.owner_decision_reason,
  o.decision_at,
  o.purchased_lot_id,
  p.purchase_number,
  p.purchase_status,
  p.quantity_purchased,
  p.total_acquisition_cost,
  p.unit_cost_basis,
  o.first_seen_at,
  o.last_seen_at,
  o.expires_at,
  o.updated_at,
  case
    when o.lifecycle_status = 'bought' and o.purchased_lot_id is null then false
    when o.purchased_lot_id is not null and p.id is null then false
    when o.identity_status = 'verified_exact' and o.market_status <> 'verified_completed_sales' then false
    else true
  end as truth_consistent,
  array_remove(array[
    case when o.lifecycle_status = 'bought' and o.purchased_lot_id is null then 'bought_without_purchase_lot' end,
    case when o.purchased_lot_id is not null and p.id is null then 'missing_purchase_lot' end,
    case when o.identity_status = 'verified_exact' and o.market_status <> 'verified_completed_sales' then 'identity_verified_without_verified_market' end
  ], null) as truth_warnings
from public.tcos_kingmaker_opportunities o
left join public.tcos_mi_purchase_lots p on p.id = o.purchased_lot_id;

alter table public.tcos_kingmaker_opportunities enable row level security;
alter table public.tcos_kingmaker_opportunity_events enable row level security;

revoke all on public.tcos_kingmaker_opportunities from anon, authenticated;
revoke all on public.tcos_kingmaker_opportunity_events from anon, authenticated;
revoke all on public.tcos_kingmaker_truth_lifecycle from anon, authenticated;

grant select, insert, update, delete on public.tcos_kingmaker_opportunities to service_role;
grant select, insert on public.tcos_kingmaker_opportunity_events to service_role;
grant select on public.tcos_kingmaker_truth_lifecycle to service_role;

grant execute on function public.tcos_kingmaker_touch_updated_at() to service_role;
grant execute on function public.tcos_kingmaker_record_opportunity_event() to service_role;

notify pgrst, 'reload schema';

commit;
