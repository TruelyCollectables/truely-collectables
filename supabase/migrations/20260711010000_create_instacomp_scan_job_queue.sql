begin;

create table if not exists public.instacomp_scan_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  seller_account_id uuid
    references public.account_profiles(id) on delete cascade,
  actor_type text not null default 'seller',
  client_batch_id text not null,
  name text not null default 'InstaComp batch',
  status text not null default 'uploading',
  total_items integer not null,
  uploaded_items integer not null default 0,
  queued_items integer not null default 0,
  processing_items integer not null default 0,
  processed_items integer not null default 0,
  completed_items integer not null default 0,
  review_required_items integer not null default 0,
  failed_items integer not null default 0,
  cancelled_items integer not null default 0,
  drafted_items integer not null default 0,
  requested_concurrency smallint not null default 3,
  auto_create_drafts boolean not null default false,
  options jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  last_error_code text,
  last_error text,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  cancel_requested_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instacomp_scan_jobs_actor_type_check
    check (actor_type in ('seller', 'admin')),
  constraint instacomp_scan_jobs_actor_owner_check
    check (actor_type = 'admin' or seller_account_id is not null),
  constraint instacomp_scan_jobs_name_check
    check (
      name = btrim(name)
      and char_length(name) between 1 and 200
    ),
  constraint instacomp_scan_jobs_client_batch_id_check
    check (
      client_batch_id = btrim(client_batch_id)
      and char_length(client_batch_id) between 1 and 200
    ),
  constraint instacomp_scan_jobs_status_check
    check (status in (
      'uploading',
      'queued',
      'processing',
      'completed',
      'completed_with_errors',
      'failed',
      'cancelling',
      'cancelled'
    )),
  constraint instacomp_scan_jobs_total_items_check
    check (total_items between 1 and 500),
  constraint instacomp_scan_jobs_concurrency_check
    check (requested_concurrency between 1 and 6),
  constraint instacomp_scan_jobs_counts_check
    check (
      uploaded_items between 0 and total_items
      and queued_items between 0 and total_items
      and processing_items between 0 and total_items
      and processed_items between 0 and total_items
      and completed_items between 0 and total_items
      and review_required_items between 0 and total_items
      and failed_items between 0 and total_items
      and cancelled_items between 0 and total_items
      and drafted_items between 0 and total_items
      and processed_items = (
        completed_items
        + review_required_items
        + failed_items
        + cancelled_items
      )
    ),
  constraint instacomp_scan_jobs_options_object_check
    check (jsonb_typeof(options) = 'object'),
  constraint instacomp_scan_jobs_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists instacomp_scan_jobs_batch_idempotency_idx
  on public.instacomp_scan_jobs (
    store_id,
    coalesce(
      seller_account_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    ),
    client_batch_id
  );

create index if not exists instacomp_scan_jobs_seller_created_idx
  on public.instacomp_scan_jobs(
    seller_account_id,
    store_id,
    created_at desc
  )
  where seller_account_id is not null;

create index if not exists instacomp_scan_jobs_status_activity_idx
  on public.instacomp_scan_jobs(
    store_id,
    status,
    updated_at desc
  );

create table if not exists public.instacomp_scan_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null
    references public.instacomp_scan_jobs(id) on delete cascade,
  position integer not null,
  client_item_id text not null,
  status text not null default 'awaiting_upload',
  front_original_filename text,
  back_original_filename text,
  front_content_type text,
  back_content_type text,
  front_size_bytes bigint,
  back_size_bytes bigint,
  front_storage_path text,
  back_storage_path text,
  front_image_sha256 text,
  back_image_sha256 text,
  detail_storage_paths text[] not null default '{}'::text[],
  pairing_confidence numeric(5, 4),
  attempt_count smallint not null default 0,
  max_attempts smallint not null default 3,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  processing_started_at timestamptz,
  completed_at timestamptz,
  player text,
  year text,
  brand text,
  set_name text,
  card_number text,
  parallel text,
  serial_number text,
  team text,
  sport text,
  is_rookie boolean,
  is_auto boolean,
  is_relic boolean,
  condition_guess text,
  confidence numeric(5, 4),
  search_query text,
  market_price numeric(12, 2),
  suggested_price numeric(12, 2),
  ocr_provider text,
  analysis_model text,
  ocr_result jsonb not null default '{}'::jsonb,
  ai_result jsonb not null default '{}'::jsonb,
  comp_result jsonb not null default '{}'::jsonb,
  source_coverage jsonb not null default '[]'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  review_reasons text[] not null default '{}'::text[],
  last_error_code text,
  last_error text,
  draft_inventory_item_id uuid
    references public.inventory_items(id) on delete set null,
  drafted_at timestamptz,
  draft_reservation_token uuid,
  draft_reservation_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instacomp_scan_items_position_check
    check (position between 0 and 499),
  constraint instacomp_scan_items_client_item_id_check
    check (
      client_item_id = btrim(client_item_id)
      and char_length(client_item_id) between 1 and 240
    ),
  constraint instacomp_scan_items_status_check
    check (status in (
      'awaiting_upload',
      'queued',
      'processing',
      'retry_wait',
      'completed',
      'review_required',
      'failed',
      'cancelled'
    )),
  constraint instacomp_scan_items_front_content_type_check
    check (
      front_content_type is null
      or front_content_type in ('image/jpeg', 'image/png', 'image/webp')
    ),
  constraint instacomp_scan_items_back_content_type_check
    check (
      back_content_type is null
      or back_content_type in ('image/jpeg', 'image/png', 'image/webp')
    ),
  constraint instacomp_scan_items_front_size_check
    check (
      front_size_bytes is null
      or front_size_bytes between 1 and 3000000
    ),
  constraint instacomp_scan_items_back_size_check
    check (
      back_size_bytes is null
      or back_size_bytes between 1 and 3000000
    ),
  constraint instacomp_scan_items_front_hash_check
    check (
      front_image_sha256 is not null
      and front_image_sha256 ~ '^[A-Fa-f0-9]{64}$'
    ),
  constraint instacomp_scan_items_back_hash_check
    check (
      (
        back_storage_path is null
        and back_image_sha256 is null
      )
      or (
        back_storage_path is not null
        and back_image_sha256 is not null
        and back_image_sha256 ~ '^[A-Fa-f0-9]{64}$'
      )
    ),
  constraint instacomp_scan_items_draft_reservation_check
    check (
      (
        draft_reservation_token is null
        and draft_reservation_expires_at is null
      )
      or (
        draft_reservation_token is not null
        and draft_reservation_expires_at is not null
      )
    ),
  constraint instacomp_scan_items_front_storage_path_check
    check (
      front_storage_path is null
      or char_length(btrim(front_storage_path)) between 1 and 1024
    ),
  constraint instacomp_scan_items_back_storage_path_check
    check (
      back_storage_path is null
      or char_length(btrim(back_storage_path)) between 1 and 1024
    ),
  constraint instacomp_scan_items_detail_image_count_check
    check (cardinality(detail_storage_paths) <= 24),
  constraint instacomp_scan_items_pairing_confidence_check
    check (
      pairing_confidence is null
      or pairing_confidence between 0 and 1
    ),
  constraint instacomp_scan_items_attempt_check
    check (
      max_attempts between 1 and 10
      and attempt_count between 0 and max_attempts
    ),
  constraint instacomp_scan_items_lease_state_check
    check (
      (
        status = 'processing'
        and lease_token is not null
        and lease_owner is not null
        and lease_expires_at is not null
      )
      or (
        status <> 'processing'
        and lease_token is null
        and lease_owner is null
        and lease_expires_at is null
      )
    ),
  constraint instacomp_scan_items_lease_owner_check
    check (
      lease_owner is null
      or char_length(btrim(lease_owner)) between 1 and 200
    ),
  constraint instacomp_scan_items_front_required_check
    check (
      status in ('awaiting_upload', 'failed', 'cancelled')
      or front_storage_path is not null
    ),
  constraint instacomp_scan_items_confidence_check
    check (confidence is null or confidence between 0 and 1),
  constraint instacomp_scan_items_market_price_check
    check (market_price is null or market_price >= 0),
  constraint instacomp_scan_items_suggested_price_check
    check (suggested_price is null or suggested_price >= 0),
  constraint instacomp_scan_items_ocr_result_object_check
    check (jsonb_typeof(ocr_result) = 'object'),
  constraint instacomp_scan_items_ai_result_object_check
    check (jsonb_typeof(ai_result) = 'object'),
  constraint instacomp_scan_items_comp_result_object_check
    check (jsonb_typeof(comp_result) = 'object'),
  constraint instacomp_scan_items_source_coverage_array_check
    check (jsonb_typeof(source_coverage) = 'array'),
  constraint instacomp_scan_items_result_payload_object_check
    check (jsonb_typeof(result_payload) = 'object'),
  unique(job_id, position),
  unique(job_id, client_item_id)
);

create index if not exists instacomp_scan_items_job_status_position_idx
  on public.instacomp_scan_items(job_id, status, position);

create index if not exists instacomp_scan_items_claim_idx
  on public.instacomp_scan_items(
    status,
    next_attempt_at,
    lease_expires_at,
    created_at
  )
  where status in ('queued', 'retry_wait', 'processing');

create index if not exists instacomp_scan_items_draft_inventory_idx
  on public.instacomp_scan_items(draft_inventory_item_id)
  where draft_inventory_item_id is not null;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'instacomp-job-images',
  'instacomp-job-images',
  false,
  3000000,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.instacomp_scan_jobs enable row level security;
alter table public.instacomp_scan_items enable row level security;

revoke all privileges on table public.instacomp_scan_jobs
  from anon, authenticated, service_role;
revoke all privileges on table public.instacomp_scan_items
  from anon, authenticated, service_role;

grant select on table public.instacomp_scan_jobs
  to authenticated;
grant select on table public.instacomp_scan_items
  to authenticated;

grant select, insert, update, delete on table public.instacomp_scan_jobs
  to service_role;
grant select, insert, update, delete on table public.instacomp_scan_items
  to service_role;

drop policy if exists instacomp_scan_jobs_seller_select
  on public.instacomp_scan_jobs;
create policy instacomp_scan_jobs_seller_select
  on public.instacomp_scan_jobs
  for select
  to authenticated
  using (seller_account_id = (select auth.uid()));

drop policy if exists instacomp_scan_items_seller_select
  on public.instacomp_scan_items;
create policy instacomp_scan_items_seller_select
  on public.instacomp_scan_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.instacomp_scan_jobs as job
      where job.id = instacomp_scan_items.job_id
        and job.seller_account_id = (select auth.uid())
    )
  );

create or replace function public.tcos_touch_instacomp_scan_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists instacomp_scan_jobs_touch_updated_at
  on public.instacomp_scan_jobs;
create trigger instacomp_scan_jobs_touch_updated_at
before update on public.instacomp_scan_jobs
for each row
execute function public.tcos_touch_instacomp_scan_updated_at();

drop trigger if exists instacomp_scan_items_touch_updated_at
  on public.instacomp_scan_items;
create trigger instacomp_scan_items_touch_updated_at
before update on public.instacomp_scan_items
for each row
execute function public.tcos_touch_instacomp_scan_updated_at();

create or replace function public.tcos_refresh_instacomp_scan_job_counts(
  p_job_id uuid
)
returns public.instacomp_scan_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.instacomp_scan_jobs%rowtype;
  v_uploaded integer := 0;
  v_queued integer := 0;
  v_processing integer := 0;
  v_processed integer := 0;
  v_completed integer := 0;
  v_review_required integer := 0;
  v_failed integer := 0;
  v_cancelled integer := 0;
  v_drafted integer := 0;
  v_draft_reservations integer := 0;
  v_next_status text;
  v_now timestamptz := now();
begin
  select *
    into v_job
    from public.instacomp_scan_jobs
   where id = p_job_id
   for update;

  if not found then
    raise exception 'InstaComp scan job % was not found', p_job_id
      using errcode = 'P0002';
  end if;

  if v_job.status = 'cancelling' then
    update public.instacomp_scan_items
       set status = 'cancelled',
           lease_token = null,
           lease_owner = null,
           lease_expires_at = null,
           draft_reservation_token = null,
           draft_reservation_expires_at = null,
           completed_at = v_now,
           last_error_code = 'job_cancelled',
           last_error = 'The InstaComp job was cancelled.'
     where job_id = p_job_id
       and (
         status in ('awaiting_upload', 'queued', 'retry_wait', 'failed')
         or (
           status = 'processing'
           and lease_expires_at <= v_now
         )
       );

    update public.instacomp_scan_items
       set draft_reservation_token = null,
           draft_reservation_expires_at = null
     where job_id = p_job_id
       and draft_reservation_token is not null
       and draft_reservation_expires_at <= v_now;
  end if;

  select
    count(*) filter (
      where front_storage_path is not null
        and status in (
          'queued',
          'processing',
          'retry_wait',
          'completed',
          'review_required',
          'failed'
        )
    ),
    count(*) filter (where status in ('queued', 'retry_wait')),
    count(*) filter (where status = 'processing'),
    count(*) filter (
      where status in ('completed', 'review_required', 'failed', 'cancelled')
    ),
    count(*) filter (where status = 'completed'),
    count(*) filter (where status = 'review_required'),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status = 'cancelled'),
    count(*) filter (where draft_inventory_item_id is not null),
    count(*) filter (
      where draft_reservation_token is not null
        and draft_reservation_expires_at > v_now
    )
    into
      v_uploaded,
      v_queued,
      v_processing,
      v_processed,
      v_completed,
      v_review_required,
      v_failed,
      v_cancelled,
      v_drafted,
      v_draft_reservations
    from public.instacomp_scan_items
   where job_id = p_job_id;

  v_next_status := v_job.status;

  if v_job.status = 'cancelling'
     and v_processing = 0
     and v_draft_reservations = 0 then
    v_next_status := 'cancelled';
  elsif v_job.status not in (
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled'
  ) and v_processed >= v_job.total_items then
    if v_failed >= v_job.total_items then
      v_next_status := 'failed';
    elsif v_failed > 0
       or v_review_required > 0
       or v_cancelled > 0 then
      v_next_status := 'completed_with_errors';
    else
      v_next_status := 'completed';
    end if;
  end if;

  update public.instacomp_scan_jobs
     set uploaded_items = v_uploaded,
         queued_items = v_queued,
         processing_items = v_processing,
         processed_items = v_processed,
         completed_items = v_completed,
         review_required_items = v_review_required,
         failed_items = v_failed,
         cancelled_items = v_cancelled,
         drafted_items = v_drafted,
         status = v_next_status,
         completed_at = case
           when v_next_status in ('completed', 'completed_with_errors', 'failed')
             then coalesce(completed_at, v_now)
           else completed_at
         end,
         cancelled_at = case
           when v_next_status = 'cancelled'
             then coalesce(cancelled_at, v_now)
           else cancelled_at
         end
   where id = p_job_id
   returning * into v_job;

  return v_job;
end;
$$;

create or replace function public.tcos_claim_instacomp_scan_items(
  p_job_id uuid,
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 300
)
returns setof public.instacomp_scan_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_status text;
  v_now timestamptz := now();
  v_limit integer;
  v_lease_seconds integer;
begin
  if p_job_id is null then
    raise exception 'InstaComp scan job id is required'
      using errcode = '22023';
  end if;

  if p_worker_id is null
     or btrim(p_worker_id) = ''
     or char_length(p_worker_id) > 200 then
    raise exception 'Worker id must contain 1 to 200 characters'
      using errcode = '22023';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 1), 6));
  v_lease_seconds := greatest(
    30,
    least(coalesce(p_lease_seconds, 300), 900)
  );

  select status
    into v_job_status
    from public.instacomp_scan_jobs
   where id = p_job_id
   for update;

  if not found then
    raise exception 'InstaComp scan job % was not found', p_job_id
      using errcode = 'P0002';
  end if;

  if v_job_status not in ('queued', 'processing') then
    return;
  end if;

  update public.instacomp_scan_items
     set status = 'failed',
         lease_token = null,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = v_now,
         last_error_code = 'attempts_exhausted',
         last_error = coalesce(
           last_error,
           'The worker lease expired after the maximum number of attempts.'
         )
   where job_id = p_job_id
     and attempt_count >= max_attempts
     and (
       status in ('queued', 'retry_wait')
       or (
         status = 'processing'
         and lease_expires_at <= v_now
       )
     );

  update public.instacomp_scan_jobs
     set status = 'processing',
         started_at = coalesce(started_at, v_now),
         heartbeat_at = v_now,
         last_error_code = null,
         last_error = null
   where id = p_job_id;

  return query
  with candidates as (
    select item.id
      from public.instacomp_scan_items as item
     where item.job_id = p_job_id
       and item.attempt_count < item.max_attempts
       and item.next_attempt_at <= v_now
       and (
         item.status in ('queued', 'retry_wait')
         or (
           item.status = 'processing'
           and item.lease_expires_at <= v_now
         )
       )
     order by item.position
     for update skip locked
     limit v_limit
  )
  update public.instacomp_scan_items as item
     set status = 'processing',
         attempt_count = item.attempt_count + 1,
         lease_token = gen_random_uuid(),
         lease_owner = left(btrim(p_worker_id), 200),
         lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
         processing_started_at = coalesce(item.processing_started_at, v_now),
         completed_at = null,
         last_error_code = null,
         last_error = null
    from candidates
   where item.id = candidates.id
  returning item.*;

  perform public.tcos_refresh_instacomp_scan_job_counts(p_job_id);
end;
$$;

create or replace function public.tcos_finish_instacomp_scan_item(
  p_item_id uuid,
  p_lease_token uuid,
  p_result_status text,
  p_result_payload jsonb,
  p_review_reasons text[] default '{}'::text[],
  p_draft_inventory_item_id uuid default null
)
returns public.instacomp_scan_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.instacomp_scan_items%rowtype;
  v_job_id uuid;
  v_ai jsonb;
  v_ocr jsonb;
  v_source_coverage jsonb;
  v_review_reasons text[];
  v_confidence_text text;
  v_market_price_text text;
  v_suggested_price_text text;
  v_now timestamptz := now();
begin
  if p_result_status not in ('completed', 'review_required') then
    raise exception 'Result status must be completed or review_required'
      using errcode = '22023';
  end if;

  if p_result_payload is null
     or jsonb_typeof(p_result_payload) <> 'object' then
    raise exception 'Result payload must be a JSON object'
      using errcode = '22023';
  end if;

  select job_id
    into v_job_id
    from public.instacomp_scan_items
   where id = p_item_id;

  if not found then
    raise exception 'InstaComp scan item % was not found', p_item_id
      using errcode = 'P0002';
  end if;

  perform 1
    from public.instacomp_scan_jobs
   where id = v_job_id
   for update;

  select *
    into v_item
    from public.instacomp_scan_items
   where id = p_item_id
     and job_id = v_job_id
   for update;

  if not found then
    raise exception 'InstaComp scan item % was not found', p_item_id
      using errcode = 'P0002';
  end if;

  if v_item.status <> 'processing'
     or v_item.lease_token is distinct from p_lease_token
     or v_item.lease_expires_at <= v_now then
    raise exception 'The InstaComp scan item lease is missing, stale, or expired'
      using errcode = '55000';
  end if;

  v_ai := coalesce(p_result_payload -> 'ai', '{}'::jsonb);
  if jsonb_typeof(v_ai) <> 'object' then
    v_ai := '{}'::jsonb;
  end if;

  v_ocr := coalesce(p_result_payload -> 'ocrDiagnostics', '{}'::jsonb);
  if jsonb_typeof(v_ocr) <> 'object' then
    v_ocr := '{}'::jsonb;
  end if;

  v_source_coverage := coalesce(
    p_result_payload -> 'sourceCoverage',
    '[]'::jsonb
  );
  if jsonb_typeof(v_source_coverage) <> 'array' then
    v_source_coverage := '[]'::jsonb;
  end if;

  v_review_reasons := coalesce(p_review_reasons, '{}'::text[]);
  if p_result_status = 'review_required'
     and cardinality(v_review_reasons) = 0 then
    v_review_reasons := array['manual_review_required']::text[];
  end if;

  v_confidence_text := v_ai ->> 'confidence';
  v_market_price_text := p_result_payload #>> '{stats,median}';
  v_suggested_price_text := p_result_payload #>> '{stats,suggestedPrice}';

  update public.instacomp_scan_items
     set status = p_result_status,
         lease_token = null,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = v_now,
         player = nullif(btrim(v_ai ->> 'player'), ''),
         year = nullif(btrim(v_ai ->> 'year'), ''),
         brand = nullif(btrim(v_ai ->> 'brand'), ''),
         set_name = nullif(btrim(v_ai ->> 'setName'), ''),
         card_number = nullif(btrim(v_ai ->> 'cardNumber'), ''),
         parallel = nullif(btrim(v_ai ->> 'parallel'), ''),
         serial_number = nullif(btrim(v_ai ->> 'serialNumber'), ''),
         team = nullif(btrim(v_ai ->> 'team'), ''),
         sport = nullif(btrim(v_ai ->> 'sport'), ''),
         is_rookie = case lower(v_ai ->> 'isRookie')
           when 'true' then true
           when 'false' then false
           else null
         end,
         is_auto = case lower(v_ai ->> 'isAuto')
           when 'true' then true
           when 'false' then false
           else null
         end,
         is_relic = case lower(v_ai ->> 'isRelic')
           when 'true' then true
           when 'false' then false
           else null
         end,
         condition_guess = nullif(btrim(v_ai ->> 'conditionGuess'), ''),
         confidence = case
           when coalesce(v_confidence_text, '')
             ~ '^[0-9]+([.][0-9]+)?$'
             then least(1, greatest(0, v_confidence_text::numeric))
           else null
         end,
         search_query = nullif(
           left(btrim(p_result_payload ->> 'searchQuery'), 2000),
           ''
         ),
         market_price = case
           when coalesce(v_market_price_text, '')
             ~ '^[0-9]+([.][0-9]+)?$'
             then v_market_price_text::numeric
           else null
         end,
         suggested_price = case
           when coalesce(v_suggested_price_text, '')
             ~ '^[0-9]+([.][0-9]+)?$'
             then v_suggested_price_text::numeric
           else null
         end,
         ocr_provider = nullif(btrim(v_ocr ->> 'provider'), ''),
         ocr_result = v_ocr,
         ai_result = v_ai,
         comp_result = p_result_payload - 'ai' - 'ocrDiagnostics',
         source_coverage = v_source_coverage,
         result_payload = p_result_payload,
         review_reasons = v_review_reasons,
         last_error_code = null,
         last_error = null,
         draft_inventory_item_id = coalesce(
           p_draft_inventory_item_id,
           draft_inventory_item_id
         ),
         drafted_at = case
           when p_draft_inventory_item_id is not null
             then coalesce(drafted_at, v_now)
           else drafted_at
         end
   where id = p_item_id
   returning * into v_item;

  perform public.tcos_refresh_instacomp_scan_job_counts(v_item.job_id);

  return v_item;
end;
$$;

create or replace function public.tcos_fail_instacomp_scan_item(
  p_item_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default true,
  p_retry_delay_seconds integer default 30
)
returns public.instacomp_scan_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.instacomp_scan_items%rowtype;
  v_job_id uuid;
  v_retry boolean;
  v_retry_delay integer;
  v_now timestamptz := now();
begin
  if p_error_message is null or btrim(p_error_message) = '' then
    raise exception 'A scan failure message is required'
      using errcode = '22023';
  end if;

  select job_id
    into v_job_id
    from public.instacomp_scan_items
   where id = p_item_id;

  if not found then
    raise exception 'InstaComp scan item % was not found', p_item_id
      using errcode = 'P0002';
  end if;

  perform 1
    from public.instacomp_scan_jobs
   where id = v_job_id
   for update;

  select *
    into v_item
    from public.instacomp_scan_items
   where id = p_item_id
     and job_id = v_job_id
   for update;

  if not found then
    raise exception 'InstaComp scan item % was not found', p_item_id
      using errcode = 'P0002';
  end if;

  if v_item.status <> 'processing'
     or v_item.lease_token is distinct from p_lease_token
     or v_item.lease_expires_at <= v_now then
    raise exception 'The InstaComp scan item lease is missing, stale, or expired'
      using errcode = '55000';
  end if;

  v_retry := coalesce(p_retryable, true)
    and v_item.attempt_count < v_item.max_attempts;
  v_retry_delay := greatest(
    0,
    least(coalesce(p_retry_delay_seconds, 30), 3600)
  );

  update public.instacomp_scan_items
     set status = case when v_retry then 'retry_wait' else 'failed' end,
         lease_token = null,
         lease_owner = null,
         lease_expires_at = null,
         next_attempt_at = case
           when v_retry
             then v_now + make_interval(secs => v_retry_delay)
           else next_attempt_at
         end,
         completed_at = case when v_retry then null else v_now end,
         last_error_code = nullif(left(btrim(p_error_code), 120), ''),
         last_error = left(btrim(p_error_message), 4000)
   where id = p_item_id
   returning * into v_item;

  update public.instacomp_scan_jobs
     set heartbeat_at = v_now,
         last_error_code = v_item.last_error_code,
         last_error = v_item.last_error
   where id = v_item.job_id;

  perform public.tcos_refresh_instacomp_scan_job_counts(v_item.job_id);

  return v_item;
end;
$$;

create or replace function public.tcos_reserve_instacomp_scan_item_draft(
  p_item_id uuid,
  p_reservation_token uuid,
  p_lease_seconds integer default 900
)
returns public.instacomp_scan_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.instacomp_scan_items%rowtype;
  v_job_id uuid;
  v_job_status text;
  v_now timestamptz := now();
  v_lease_seconds integer := greatest(
    60,
    least(coalesce(p_lease_seconds, 900), 900)
  );
begin
  if p_reservation_token is null then
    raise exception 'A draft reservation token is required'
      using errcode = '22023';
  end if;

  select job_id
    into v_job_id
    from public.instacomp_scan_items
   where id = p_item_id;

  if not found then
    raise exception 'InstaComp scan item % was not found', p_item_id
      using errcode = 'P0002';
  end if;

  select status
    into v_job_status
    from public.instacomp_scan_jobs
   where id = v_job_id
   for update;

  if v_job_status in ('cancelling', 'cancelled', 'failed') then
    raise exception 'A cancelled or failed InstaComp job cannot create drafts'
      using errcode = '55000';
  end if;

  select *
    into v_item
    from public.instacomp_scan_items
   where id = p_item_id
     and job_id = v_job_id
   for update;

  if not found then
    raise exception 'InstaComp scan item % was not found', p_item_id
      using errcode = 'P0002';
  end if;

  if v_item.draft_inventory_item_id is not null then
    update public.instacomp_scan_items
       set draft_reservation_token = null,
           draft_reservation_expires_at = null,
           updated_at = v_now
     where id = p_item_id
     returning * into v_item;

    perform public.tcos_refresh_instacomp_scan_job_counts(v_item.job_id);

    return v_item;
  end if;

  if v_item.status not in ('completed', 'review_required') then
    raise exception 'Only a completed or review-required row can reserve a draft'
      using errcode = '55000';
  end if;

  if v_item.draft_reservation_token is not null
     and v_item.draft_reservation_token is distinct from p_reservation_token
     and v_item.draft_reservation_expires_at > v_now then
    raise exception 'Another request is already creating this InstaComp draft'
      using errcode = '55000';
  end if;

  update public.instacomp_scan_items
     set draft_reservation_token = p_reservation_token,
         draft_reservation_expires_at =
           v_now + make_interval(secs => v_lease_seconds),
         updated_at = v_now
   where id = p_item_id
   returning * into v_item;

  return v_item;
end;
$$;

create or replace function public.tcos_finish_instacomp_scan_item_draft(
  p_item_id uuid,
  p_reservation_token uuid,
  p_draft_inventory_item_id uuid
)
returns public.instacomp_scan_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.instacomp_scan_items%rowtype;
  v_job_id uuid;
  v_now timestamptz := now();
begin
  if p_reservation_token is null or p_draft_inventory_item_id is null then
    raise exception 'Draft reservation and inventory item IDs are required'
      using errcode = '22023';
  end if;

  select job_id
    into v_job_id
    from public.instacomp_scan_items
   where id = p_item_id;

  if not found then
    raise exception 'InstaComp scan item % was not found', p_item_id
      using errcode = 'P0002';
  end if;

  perform 1
    from public.instacomp_scan_jobs
   where id = v_job_id
   for update;

  select *
    into v_item
    from public.instacomp_scan_items
   where id = p_item_id
     and job_id = v_job_id
   for update;

  if not found then
    raise exception 'InstaComp scan item % was not found', p_item_id
      using errcode = 'P0002';
  end if;

  if v_item.draft_inventory_item_id is not null then
    if v_item.draft_inventory_item_id is distinct from p_draft_inventory_item_id then
      raise exception 'The InstaComp row is already linked to another inventory item'
        using errcode = '55000';
    end if;

    update public.instacomp_scan_items
       set draft_reservation_token = null,
           draft_reservation_expires_at = null,
           updated_at = v_now
     where id = p_item_id
     returning * into v_item;

    perform public.tcos_refresh_instacomp_scan_job_counts(v_item.job_id);

    return v_item;
  end if;

  if v_item.status not in ('completed', 'review_required')
     or v_item.draft_reservation_token is distinct from p_reservation_token
     or v_item.draft_reservation_expires_at <= v_now then
    raise exception 'The InstaComp draft reservation is missing, stale, or expired'
      using errcode = '55000';
  end if;

  update public.instacomp_scan_items
     set draft_inventory_item_id = p_draft_inventory_item_id,
         drafted_at = coalesce(drafted_at, v_now),
         draft_reservation_token = null,
         draft_reservation_expires_at = null,
         updated_at = v_now
   where id = p_item_id
   returning * into v_item;

  perform public.tcos_refresh_instacomp_scan_job_counts(v_item.job_id);

  return v_item;
end;
$$;

create or replace function public.tcos_release_instacomp_scan_item_draft(
  p_item_id uuid,
  p_reservation_token uuid
)
returns public.instacomp_scan_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.instacomp_scan_items%rowtype;
  v_job_id uuid;
begin
  if p_reservation_token is null then
    raise exception 'A draft reservation token is required'
      using errcode = '22023';
  end if;

  select job_id
    into v_job_id
    from public.instacomp_scan_items
   where id = p_item_id;

  if not found then
    return v_item;
  end if;

  perform 1
    from public.instacomp_scan_jobs
   where id = v_job_id
   for update;

  update public.instacomp_scan_items
     set draft_reservation_token = null,
         draft_reservation_expires_at = null,
         updated_at = now()
   where id = p_item_id
     and job_id = v_job_id
     and draft_reservation_token = p_reservation_token
     and draft_inventory_item_id is null
   returning * into v_item;

  if v_item.id is not null then
    perform public.tcos_refresh_instacomp_scan_job_counts(v_item.job_id);
  end if;

  return v_item;
end;
$$;

create or replace function public.tcos_requeue_instacomp_scan_item(
  p_item_id uuid,
  p_reason text
)
returns public.instacomp_scan_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.instacomp_scan_items%rowtype;
  v_job_id uuid;
  v_now timestamptz := now();
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A manual requeue reason is required'
      using errcode = '22023';
  end if;

  select job_id
    into v_job_id
    from public.instacomp_scan_items
   where id = p_item_id;

  if not found then
    raise exception 'InstaComp scan item % was not found', p_item_id
      using errcode = 'P0002';
  end if;

  perform 1
    from public.instacomp_scan_jobs
   where id = v_job_id
   for update;

  select *
    into v_item
    from public.instacomp_scan_items
   where id = p_item_id
     and job_id = v_job_id
   for update;

  if not found then
    raise exception 'InstaComp scan item % was not found', p_item_id
      using errcode = 'P0002';
  end if;

  if v_item.status not in (
    'completed',
    'review_required',
    'failed',
    'cancelled'
  ) then
    raise exception 'Only a terminal InstaComp scan item may be requeued'
      using errcode = '55000';
  end if;

  if v_item.draft_inventory_item_id is not null then
    raise exception 'An item already linked to a draft cannot be requeued'
      using errcode = '55000';
  end if;

  if v_item.front_storage_path is null then
    raise exception 'An item cannot be requeued without a front image'
      using errcode = '55000';
  end if;

  update public.instacomp_scan_items
     set status = 'queued',
         attempt_count = 0,
         next_attempt_at = v_now,
         lease_token = null,
         lease_owner = null,
         lease_expires_at = null,
         draft_reservation_token = null,
         draft_reservation_expires_at = null,
         processing_started_at = null,
         completed_at = null,
         review_reasons = '{}'::text[],
         last_error_code = 'manual_requeue',
         last_error = left(btrim(p_reason), 4000)
   where id = p_item_id
   returning * into v_item;

  update public.instacomp_scan_jobs
     set status = 'queued',
         completed_at = null,
         cancelled_at = null,
         cancel_requested_at = null,
         last_error_code = null,
         last_error = null,
         heartbeat_at = v_now
   where id = v_item.job_id;

  perform public.tcos_refresh_instacomp_scan_job_counts(v_item.job_id);

  return v_item;
end;
$$;

revoke all on function public.tcos_touch_instacomp_scan_updated_at()
  from public, anon, authenticated;

revoke all on function public.tcos_refresh_instacomp_scan_job_counts(uuid)
  from public, anon, authenticated;
revoke all on function public.tcos_claim_instacomp_scan_items(
  uuid, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.tcos_finish_instacomp_scan_item(
  uuid, uuid, text, jsonb, text[], uuid
) from public, anon, authenticated;
revoke all on function public.tcos_fail_instacomp_scan_item(
  uuid, uuid, text, text, boolean, integer
) from public, anon, authenticated;
revoke all on function public.tcos_reserve_instacomp_scan_item_draft(
  uuid, uuid, integer
) from public, anon, authenticated;
revoke all on function public.tcos_finish_instacomp_scan_item_draft(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.tcos_release_instacomp_scan_item_draft(
  uuid, uuid
) from public, anon, authenticated;
revoke all on function public.tcos_requeue_instacomp_scan_item(uuid, text)
  from public, anon, authenticated;

grant execute on function public.tcos_refresh_instacomp_scan_job_counts(uuid)
  to service_role;
grant execute on function public.tcos_claim_instacomp_scan_items(
  uuid, text, integer, integer
) to service_role;
grant execute on function public.tcos_finish_instacomp_scan_item(
  uuid, uuid, text, jsonb, text[], uuid
) to service_role;
grant execute on function public.tcos_fail_instacomp_scan_item(
  uuid, uuid, text, text, boolean, integer
) to service_role;
grant execute on function public.tcos_reserve_instacomp_scan_item_draft(
  uuid, uuid, integer
) to service_role;
grant execute on function public.tcos_finish_instacomp_scan_item_draft(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.tcos_release_instacomp_scan_item_draft(
  uuid, uuid
) to service_role;
grant execute on function public.tcos_requeue_instacomp_scan_item(uuid, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
