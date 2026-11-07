create table if not exists public.tcos_kingmaker_metric_forecasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  metric text not null,
  predicted numeric not null,
  lower_bound numeric not null,
  upper_bound numeric not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  trend text not null check (trend in ('improving','stable','deteriorating')),
  horizon_periods integer not null check (horizon_periods > 0),
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_market_correlations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  identity_key text not null,
  marketplaces text[] not null,
  spread numeric not null,
  spread_pct numeric not null,
  weighted_confidence numeric not null check (weighted_confidence >= 0 and weighted_confidence <= 1),
  arbitrage_candidate boolean not null default false,
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_portfolio_simulations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  available_capital numeric not null check (available_capital >= 0),
  deployed_capital numeric not null check (deployed_capital >= 0),
  remaining_capital numeric not null check (remaining_capital >= 0),
  selected jsonb not null default '[]'::jsonb,
  scenarios jsonb not null default '[]'::jsonb,
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_readiness_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  score numeric not null check (score >= 0 and score <= 100),
  band text not null check (band in ('excellent','ready','caution','blocked')),
  reasons text[] not null default '{}',
  authorization_integrity boolean not null,
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_decision_explanations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  identity_key text not null,
  action text not null check (action in ('buy','offer','watch','research','reject')),
  explanation jsonb not null,
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);

alter table public.tcos_kingmaker_metric_forecasts enable row level security;
alter table public.tcos_kingmaker_market_correlations enable row level security;
alter table public.tcos_kingmaker_portfolio_simulations enable row level security;
alter table public.tcos_kingmaker_readiness_scores enable row level security;
alter table public.tcos_kingmaker_decision_explanations enable row level security;

revoke all on public.tcos_kingmaker_metric_forecasts from anon, authenticated;
revoke all on public.tcos_kingmaker_market_correlations from anon, authenticated;
revoke all on public.tcos_kingmaker_portfolio_simulations from anon, authenticated;
revoke all on public.tcos_kingmaker_readiness_scores from anon, authenticated;
revoke all on public.tcos_kingmaker_decision_explanations from anon, authenticated;

grant all on public.tcos_kingmaker_metric_forecasts to service_role;
grant all on public.tcos_kingmaker_market_correlations to service_role;
grant all on public.tcos_kingmaker_portfolio_simulations to service_role;
grant all on public.tcos_kingmaker_readiness_scores to service_role;
grant all on public.tcos_kingmaker_decision_explanations to service_role;

create index if not exists tcos_kingmaker_metric_forecasts_tenant_created_idx on public.tcos_kingmaker_metric_forecasts (tenant_id, created_at desc);
create index if not exists tcos_kingmaker_market_correlations_identity_idx on public.tcos_kingmaker_market_correlations (tenant_id, identity_key, created_at desc);
create index if not exists tcos_kingmaker_portfolio_simulations_tenant_created_idx on public.tcos_kingmaker_portfolio_simulations (tenant_id, created_at desc);
create index if not exists tcos_kingmaker_readiness_scores_tenant_created_idx on public.tcos_kingmaker_readiness_scores (tenant_id, created_at desc);
create index if not exists tcos_kingmaker_decision_explanations_identity_idx on public.tcos_kingmaker_decision_explanations (tenant_id, identity_key, created_at desc);
