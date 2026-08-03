begin;

create table if not exists public.tcos_kingmaker_price_index (
  id uuid primary key default gen_random_uuid(),
  checklist_identity_id uuid not null references public.checklist_card_identities(id) on delete restrict,
  entity_key text not null,
  latest_guide_id uuid not null references public.tcos_kingmaker_price_guides(id) on delete restrict,
  latest_entry_id uuid not null references public.tcos_kingmaker_price_entries(id) on delete restrict,
  edition_date date not null,
  value_low numeric(14,2),
  value_high numeric(14,2),
  midpoint numeric(14,2),
  currency text not null default 'USD',
  confidence numeric not null check (confidence between 0 and 1),
  status text not null check (status in ('verified','review_required')),
  history_count integer not null check (history_count > 0),
  trend_pct numeric,
  fingerprint text not null unique check (length(fingerprint) = 64),
  refreshed_at timestamptz not null default now(),
  unique (checklist_identity_id)
);

create table if not exists public.tcos_kingmaker_price_history (
  id uuid primary key default gen_random_uuid(),
  checklist_identity_id uuid not null references public.checklist_card_identities(id) on delete restrict,
  guide_id uuid not null references public.tcos_kingmaker_price_guides(id) on delete restrict,
  entry_id uuid not null references public.tcos_kingmaker_price_entries(id) on delete restrict,
  edition_date date not null,
  value_low numeric(14,2),
  value_high numeric(14,2),
  midpoint numeric(14,2),
  currency text not null default 'USD',
  confidence numeric not null check (confidence between 0 and 1),
  validation_status text not null,
  source_engine text not null,
  fingerprint text not null unique check (length(fingerprint) = 64),
  created_at timestamptz not null default now(),
  unique (checklist_identity_id, guide_id, entry_id)
);

create or replace function public.tcos_refresh_kingmaker_price_index()
returns jsonb language plpgsql security definer set search_path = public as $$
declare history_rows integer := 0; index_rows integer := 0;
begin
  insert into public.tcos_kingmaker_price_history (
    checklist_identity_id,guide_id,entry_id,edition_date,value_low,value_high,midpoint,currency,confidence,validation_status,source_engine,fingerprint
  )
  select entry.checklist_identity_id,entry.guide_id,entry.id,guide.edition_date,entry.value_low,entry.value_high,
    case when entry.value_low is not null and entry.value_high is not null then round((entry.value_low+entry.value_high)/2,2) else coalesce(entry.value_low,entry.value_high) end,
    entry.currency,entry.parse_confidence,entry.validation_status,coalesce(entry.metadata->>'sourceEngine','unknown'),
    encode(digest(concat_ws('|',entry.checklist_identity_id,entry.guide_id,entry.id,guide.edition_date,entry.value_low,entry.value_high,entry.currency,entry.parse_confidence,entry.validation_status,coalesce(entry.metadata->>'sourceEngine','unknown')),'sha256'),'hex')
  from public.tcos_kingmaker_price_entries entry
  join public.tcos_kingmaker_price_guides guide on guide.id=entry.guide_id
  where entry.identity_match_status='exact' and entry.checklist_identity_id is not null and entry.validation_status<>'rejected'
    and (entry.value_low is not null or entry.value_high is not null)
  on conflict (checklist_identity_id,guide_id,entry_id) do update set
    edition_date=excluded.edition_date,value_low=excluded.value_low,value_high=excluded.value_high,midpoint=excluded.midpoint,
    currency=excluded.currency,confidence=excluded.confidence,validation_status=excluded.validation_status,source_engine=excluded.source_engine,fingerprint=excluded.fingerprint;
  get diagnostics history_rows = row_count;

  with ranked as (
    select history.*,count(*) over(partition by checklist_identity_id) total_history,
      lag(midpoint) over(partition by checklist_identity_id order by edition_date,guide_id,entry_id) previous_midpoint,
      row_number() over(partition by checklist_identity_id order by edition_date desc,guide_id desc,entry_id desc) latest_rank
    from public.tcos_kingmaker_price_history history
  )
  insert into public.tcos_kingmaker_price_index (
    checklist_identity_id,entity_key,latest_guide_id,latest_entry_id,edition_date,value_low,value_high,midpoint,currency,confidence,status,history_count,trend_pct,fingerprint,refreshed_at
  )
  select ranked.checklist_identity_id,identity.canonical_key,ranked.guide_id,ranked.entry_id,ranked.edition_date,ranked.value_low,ranked.value_high,ranked.midpoint,
    ranked.currency,ranked.confidence,case when ranked.validation_status='accepted' and ranked.source_engine='text' then 'verified' else 'review_required' end,
    ranked.total_history,case when ranked.previous_midpoint is not null and ranked.previous_midpoint<>0 and ranked.midpoint is not null then round(((ranked.midpoint-ranked.previous_midpoint)/ranked.previous_midpoint)*100,2) end,
    encode(digest(concat_ws('|',ranked.checklist_identity_id,ranked.guide_id,ranked.entry_id,ranked.edition_date,ranked.value_low,ranked.value_high,ranked.currency,ranked.confidence,ranked.validation_status,ranked.source_engine,ranked.total_history,ranked.previous_midpoint),'sha256'),'hex'),now()
  from ranked join public.checklist_card_identities identity on identity.id=ranked.checklist_identity_id where ranked.latest_rank=1
  on conflict (checklist_identity_id) do update set
    entity_key=excluded.entity_key,latest_guide_id=excluded.latest_guide_id,latest_entry_id=excluded.latest_entry_id,edition_date=excluded.edition_date,
    value_low=excluded.value_low,value_high=excluded.value_high,midpoint=excluded.midpoint,currency=excluded.currency,confidence=excluded.confidence,status=excluded.status,
    history_count=excluded.history_count,trend_pct=excluded.trend_pct,fingerprint=excluded.fingerprint,refreshed_at=excluded.refreshed_at;
  get diagnostics index_rows = row_count;
  return jsonb_build_object('history_rows_touched',history_rows,'index_rows_touched',index_rows,'promoted_observations',0);
end; $$;

alter table public.tcos_kingmaker_price_index enable row level security;
alter table public.tcos_kingmaker_price_history enable row level security;
revoke all on public.tcos_kingmaker_price_index from anon,authenticated;
revoke all on public.tcos_kingmaker_price_history from anon,authenticated;
revoke all on function public.tcos_refresh_kingmaker_price_index() from public,anon,authenticated;
grant all on public.tcos_kingmaker_price_index to service_role;
grant all on public.tcos_kingmaker_price_history to service_role;
grant execute on function public.tcos_refresh_kingmaker_price_index() to service_role;
create index if not exists tcos_kingmaker_price_index_entity_idx on public.tcos_kingmaker_price_index(entity_key,edition_date desc);
create index if not exists tcos_kingmaker_price_index_status_idx on public.tcos_kingmaker_price_index(status,refreshed_at desc);
create index if not exists tcos_kingmaker_price_history_identity_date_idx on public.tcos_kingmaker_price_history(checklist_identity_id,edition_date desc);
commit;
