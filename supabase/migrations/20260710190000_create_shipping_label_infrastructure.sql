create table if not exists public.order_shipping_labels (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id),
  order_id bigint not null references public.orders(id) on delete cascade,
  seller_account_id uuid references public.account_profiles(id),
  provider text not null default 'pending_provider',
  provider_label_id text,
  provider_shipment_id text,
  provider_rate_id text,
  provider_service text,
  service_level text,
  carrier text,
  tracking_number text,
  label_url text,
  label_pdf_url text,
  label_format text not null default 'pdf',
  postage_amount numeric(12, 2) not null default 0,
  currency text not null default 'USD',
  label_status text not null default 'planned'
    check (label_status in (
      'planned',
      'rate_selected',
      'purchase_pending',
      'purchased',
      'printed',
      'void_pending',
      'voided',
      'failed'
    )),
  requested_shipping_method text,
  resolved_shipping_method text,
  coverage_provider text not null default 'Coverage',
  coverage_required boolean not null default true,
  coverage_status text not null default 'required_at_label_purchase'
    check (coverage_status in (
      'not_required',
      'required_at_label_purchase',
      'purchase_pending',
      'covered',
      'claim_pending',
      'claim_paid',
      'claim_denied',
      'failed'
    )),
  coverage_amount numeric(12, 2) not null default 0,
  coverage_policy_id text,
  coverage_claim_id text,
  coverage_claim_status text,
  purchased_at timestamptz,
  printed_at timestamptz,
  voided_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_shipping_labels_store_order_idx
  on public.order_shipping_labels(store_id, order_id, created_at desc);

create index if not exists order_shipping_labels_tracking_idx
  on public.order_shipping_labels(carrier, tracking_number)
  where tracking_number is not null;

create index if not exists order_shipping_labels_status_idx
  on public.order_shipping_labels(store_id, label_status, coverage_status, created_at desc);

create table if not exists public.order_shipping_tracking_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id),
  order_id bigint not null references public.orders(id) on delete cascade,
  shipping_label_id uuid references public.order_shipping_labels(id) on delete set null,
  provider text not null default 'manual',
  carrier text,
  tracking_number text,
  event_type text not null default 'tracking_update',
  event_code text,
  event_status text,
  message text,
  location text,
  occurred_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_shipping_tracking_events_order_idx
  on public.order_shipping_tracking_events(store_id, order_id, occurred_at desc);

create index if not exists order_shipping_tracking_events_label_idx
  on public.order_shipping_tracking_events(shipping_label_id, occurred_at desc);

create table if not exists public.order_shipping_coverage_claims (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id),
  order_id bigint not null references public.orders(id) on delete cascade,
  shipping_label_id uuid references public.order_shipping_labels(id) on delete set null,
  provider text not null default 'Coverage',
  provider_claim_id text,
  claim_status text not null default 'draft'
    check (claim_status in (
      'draft',
      'submitted',
      'under_review',
      'approved',
      'paid',
      'denied',
      'cancelled'
    )),
  claim_type text not null default 'shipment_loss_or_damage',
  claim_amount numeric(12, 2) not null default 0,
  reason text,
  submitted_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_shipping_coverage_claims_order_idx
  on public.order_shipping_coverage_claims(store_id, order_id, created_at desc);

create index if not exists order_shipping_coverage_claims_status_idx
  on public.order_shipping_coverage_claims(store_id, claim_status, created_at desc);
