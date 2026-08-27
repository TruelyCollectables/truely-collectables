create table if not exists public.tcos_kingmaker_learning_outcomes (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.tcos_kingmaker_signals(id) on delete set null,
  decision_id uuid references public.tcos_kingmaker_decisions(id) on delete set null,
  signal_fingerprint text not null,
  outcome_fingerprint text not null unique,
  entity_key text not null,
  source text,
  seller_key text,
  decision text not null check (decision in ('buy','offer','watch','pass','dismiss','research')),
  state text not null check (state in ('open','won','lost','flat','non_purchase')),
  decided_at timestamptz not null,
  sold_at timestamptz,
  predicted_profit numeric,
  predicted_roi_percent numeric,
  predicted_confidence numeric check (predicted_confidence is null or predicted_confidence between 0 and 1),
  offer_amount numeric,
  paid_amount numeric,
  landed_cost numeric,
  sold_amount numeric,
  realized_profit numeric,
  realized_roi_percent numeric,
  prediction_error_profit numeric,
  prediction_error_roi_percent numeric,
  days_to_exit numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tcos_kingmaker_learning_outcomes_entity_idx
  on public.tcos_kingmaker_learning_outcomes(entity_key, decided_at desc);
create index if not exists tcos_kingmaker_learning_outcomes_seller_idx
  on public.tcos_kingmaker_learning_outcomes(seller_key, decided_at desc)
  where seller_key is not null;
create index if not exists tcos_kingmaker_learning_outcomes_state_idx
  on public.tcos_kingmaker_learning_outcomes(state, decided_at desc);

alter table public.tcos_kingmaker_learning_outcomes enable row level security;
revoke all on public.tcos_kingmaker_learning_outcomes from anon, authenticated;
grant all on public.tcos_kingmaker_learning_outcomes to service_role;

comment on table public.tcos_kingmaker_learning_outcomes is
  'Append-oriented KINGMAKER learning ledger comparing predicted deal economics with actual outcomes.';
