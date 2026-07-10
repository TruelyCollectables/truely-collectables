begin;

create table if not exists public.live_payment_launch_gates (
  store_id uuid primary key references public.stores(id) on delete cascade,
  gate_status text not null default 'locked',
  approval_version text not null,
  approved_at timestamptz,
  approved_by text,
  approval_note text,
  revoked_at timestamptz,
  revoked_by text,
  last_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_payment_launch_gates_status_check
    check (gate_status in ('locked', 'approved', 'revoked'))
);

create table if not exists public.live_payment_launch_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  event_type text not null,
  approval_version text not null,
  actor text not null,
  note text,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint live_payment_launch_events_type_check
    check (event_type in ('approved', 'revoked'))
);

create index if not exists live_payment_launch_events_store_created_idx
  on public.live_payment_launch_events(store_id, created_at desc);

alter table public.live_payment_launch_gates enable row level security;
alter table public.live_payment_launch_events enable row level security;

revoke all privileges on table public.live_payment_launch_gates
  from public, anon, authenticated;
revoke all privileges on table public.live_payment_launch_events
  from public, anon, authenticated;

grant select, insert, update on table public.live_payment_launch_gates
  to service_role;
grant select, insert on table public.live_payment_launch_events
  to service_role;

notify pgrst, 'reload schema';

commit;
