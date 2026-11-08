create table if not exists public.tos_acceptance_events (
  id uuid primary key default gen_random_uuid(),
  context_type text not null,
  context_id text,
  tos_kind text not null,
  tos_version text not null,
  ip_address text not null,
  user_agent text,
  ip_risk text not null,
  ip_block_reason text,
  ip_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists tos_acceptance_event_id uuid,
  add column if not exists tos_ip_address text,
  add column if not exists tos_user_agent text,
  add column if not exists tos_ip_risk text,
  add column if not exists tos_ip_block_reason text,
  add column if not exists tos_ip_evidence jsonb;

alter table public.offers
  add column if not exists tos_acceptance_event_id uuid,
  add column if not exists tos_ip_address text,
  add column if not exists tos_user_agent text,
  add column if not exists tos_ip_risk text,
  add column if not exists tos_ip_block_reason text,
  add column if not exists tos_ip_evidence jsonb;

create index if not exists orders_tos_ip_address_idx
  on public.orders (tos_ip_address);

create index if not exists offers_tos_ip_address_idx
  on public.offers (tos_ip_address);

create index if not exists tos_acceptance_events_ip_address_idx
  on public.tos_acceptance_events (ip_address);

create index if not exists tos_acceptance_events_context_idx
  on public.tos_acceptance_events (context_type, context_id);

create index if not exists tos_acceptance_events_created_at_idx
  on public.tos_acceptance_events (created_at desc);
