create table if not exists public.account_collector_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  collector_handle text,
  bio text,
  collecting_focus text,
  location_label text,
  website_url text,
  instagram_url text,
  facebook_url text,
  x_url text,
  tiktok_url text,
  youtube_url text,
  whatnot_url text,
  ebay_url text,
  visibility text not null default 'private',
  allow_messages boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, store_id),
  constraint account_collector_profiles_visibility_check
    check (visibility in ('private', 'community', 'public', 'admin_review'))
);

create index if not exists account_collector_profiles_store_visibility_idx
  on public.account_collector_profiles(store_id, visibility, updated_at desc);

create index if not exists account_collector_profiles_handle_idx
  on public.account_collector_profiles(store_id, lower(collector_handle))
  where collector_handle is not null;

create table if not exists public.account_conversations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  created_by_account_id uuid not null references public.account_profiles(id) on delete cascade,
  recipient_account_id uuid references public.account_profiles(id) on delete set null,
  related_product_id bigint,
  related_collection_item_id uuid references public.account_collection_items(id) on delete set null,
  related_wish_list_item_id uuid references public.account_wish_list_items(id) on delete set null,
  subject text,
  status text not null default 'open',
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_conversations_status_check
    check (status in ('open', 'archived', 'blocked', 'closed'))
);

create index if not exists account_conversations_created_by_idx
  on public.account_conversations(created_by_account_id, store_id, status, updated_at desc);

create index if not exists account_conversations_recipient_idx
  on public.account_conversations(recipient_account_id, store_id, status, updated_at desc)
  where recipient_account_id is not null;

create table if not exists public.account_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.account_conversations(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  sender_account_id uuid not null references public.account_profiles(id) on delete cascade,
  message_type text not null default 'message',
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint account_conversation_messages_type_check
    check (message_type in ('message', 'binding_offer', 'system'))
);

create index if not exists account_conversation_messages_thread_idx
  on public.account_conversation_messages(conversation_id, created_at asc);

create table if not exists public.account_binding_offers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  conversation_id uuid references public.account_conversations(id) on delete set null,
  buyer_account_id uuid not null references public.account_profiles(id) on delete cascade,
  seller_account_id uuid references public.account_profiles(id) on delete set null,
  product_id bigint,
  collection_item_id uuid references public.account_collection_items(id) on delete set null,
  wish_list_item_id uuid references public.account_wish_list_items(id) on delete set null,
  offer_amount numeric not null,
  shipping_amount numeric not null default 0,
  tax_amount numeric not null default 0,
  total_amount numeric not null,
  currency text not null default 'usd',
  status text not null default 'payment_required',
  payment_requirement text not null default 'card_required_before_submission',
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_payment_method_id text,
  stripe_setup_intent_id text,
  stripe_payment_intent_id text,
  accepted_at timestamptz,
  declined_at timestamptz,
  canceled_at timestamptz,
  expires_at timestamptz,
  tos_acceptance_event_id uuid,
  tos_version text,
  client_ip_address text,
  client_user_agent text,
  client_identity_risk text,
  client_identity_evidence jsonb not null default '{}'::jsonb,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_binding_offers_amount_check
    check (offer_amount > 0 and shipping_amount >= 0 and tax_amount >= 0 and total_amount > 0),
  constraint account_binding_offers_status_check
    check (status in (
      'payment_required',
      'payment_method_authorized',
      'submitted',
      'accepted',
      'declined',
      'canceled',
      'expired',
      'paid',
      'failed'
    ))
);

create index if not exists account_binding_offers_buyer_idx
  on public.account_binding_offers(buyer_account_id, store_id, status, created_at desc);

create index if not exists account_binding_offers_seller_idx
  on public.account_binding_offers(seller_account_id, store_id, status, created_at desc)
  where seller_account_id is not null;

create table if not exists public.account_collection_export_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  export_type text not null,
  status text not null default 'completed',
  file_name text,
  file_url text,
  item_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint account_collection_export_jobs_type_check
    check (export_type in ('csv', 'catalog_json', 'media_archive')),
  constraint account_collection_export_jobs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed'))
);

create index if not exists account_collection_export_jobs_account_idx
  on public.account_collection_export_jobs(account_id, store_id, created_at desc);
