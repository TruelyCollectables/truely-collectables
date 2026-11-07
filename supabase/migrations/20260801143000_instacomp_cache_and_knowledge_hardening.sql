-- InstaComp 2.0 adversarial hardening: tenant-scoped cache, collision-aware
-- identity fingerprints, append-only canonical versions, and promotion-only
-- writes for trusted knowledge.

create extension if not exists pgcrypto;

-- Old exact-image cache rows were keyed globally. Expire them so only the new
-- actor/store-scoped hashes can ever be replayed.
update public.instacomp_scan_knowledge_cache
set market_expires_at = least(market_expires_at, now()),
    updated_at = now()
where submitted_store_id is null
   or submitted_by_actor_type not in ('admin', 'seller')
   or (submitted_by_actor_type = 'seller' and submitted_by_account_id is null);

create index if not exists instacomp_scan_cache_actor_scope_idx
  on public.instacomp_scan_knowledge_cache(
    submitted_store_id,
    submitted_by_actor_type,
    submitted_by_account_id,
    image_fingerprint,
    market_expires_at desc
  );

alter table public.tcos_card_knowledge_entries
  add column if not exists identity_fingerprint_v2 text,
  add column if not exists collision_detected boolean not null default false,
  add column if not exists canonical_revision integer not null default 0,
  add column if not exists canonical_promotion_status text,
  add column if not exists canonical_promoted_at timestamptz;

create index if not exists tcos_card_knowledge_entries_fingerprint_v2_idx
  on public.tcos_card_knowledge_entries(identity_fingerprint_v2)
  where identity_fingerprint_v2 is not null;

create table if not exists public.tcos_card_knowledge_collision_audit (
  id uuid primary key default gen_random_uuid(),
  identity_fingerprint_v2 text not null,
  knowledge_entry_ids uuid[] not null,
  entry_count integer not null check (entry_count >= 2),
  status text not null default 'open'
    check (status in ('open', 'in_review', 'resolved', 'dismissed')),
  evidence jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(identity_fingerprint_v2)
);

create table if not exists public.tcos_card_knowledge_canonical_versions (
  id uuid primary key default gen_random_uuid(),
  knowledge_entry_id uuid not null
    references public.tcos_card_knowledge_entries(id) on delete cascade,
  revision integer not null check (revision > 0),
  promoted_by_status text not null
    check (promoted_by_status in ('operator_confirmed', 'catalog_confirmed', 'migration_snapshot')),
  source_observation_id uuid
    references public.tcos_card_knowledge_observations(id) on delete set null,
  identity_fingerprint text not null,
  identity_fingerprint_v2 text,
  canonical_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(knowledge_entry_id, revision),
  check (jsonb_typeof(canonical_snapshot) = 'object')
);

create index if not exists tcos_card_knowledge_canonical_versions_entry_idx
  on public.tcos_card_knowledge_canonical_versions(
    knowledge_entry_id,
    revision desc
  );

alter table public.tcos_card_knowledge_collision_audit enable row level security;
alter table public.tcos_card_knowledge_canonical_versions enable row level security;
revoke all privileges on table public.tcos_card_knowledge_collision_audit
  from anon, authenticated, service_role;
revoke all privileges on table public.tcos_card_knowledge_canonical_versions
  from anon, authenticated, service_role;
grant select, insert, update, delete on table public.tcos_card_knowledge_collision_audit
  to service_role;
grant select, insert on table public.tcos_card_knowledge_canonical_versions
  to service_role;

create or replace function public.tcos_instacomp_knowledge_boolean_label(
  p_value text,
  p_true_label text,
  p_false_label text
)
returns text
language sql
immutable
as $$
  select case
    when lower(btrim(coalesce(p_value, ''))) in ('true','t','1','yes','y')
      then p_true_label
    else p_false_label
  end;
$$;

create or replace function public.tcos_instacomp_knowledge_fingerprint(p_ai jsonb)
returns text
language sql
immutable
as $$
  select concat_ws('|',
    'v2',
    coalesce(public.tcos_instacomp_knowledge_normalize(p_ai->>'year'), 'unknown'),
    coalesce(public.tcos_instacomp_knowledge_normalize(p_ai->>'brand'), 'unknown'),
    coalesce(public.tcos_instacomp_knowledge_normalize(p_ai->>'setName'), 'unknown'),
    coalesce(public.tcos_instacomp_knowledge_normalize(p_ai->>'cardNumber', true), 'unknown'),
    coalesce(public.tcos_instacomp_knowledge_normalize(p_ai->>'player'), 'unknown'),
    coalesce(
      public.tcos_instacomp_knowledge_normalize(p_ai->>'parallel'),
      'base'
    ),
    coalesce(
      public.tcos_instacomp_knowledge_normalize(p_ai->>'variation'),
      'none'
    ),
    coalesce(public.tcos_instacomp_knowledge_normalize(
      public.tcos_instacomp_knowledge_serial_run(p_ai->>'serialNumber')
    ), 'unknown'),
    public.tcos_instacomp_knowledge_boolean_label(
      p_ai->>'isAuto', 'autograph', 'non-autograph'
    ),
    public.tcos_instacomp_knowledge_boolean_label(
      p_ai->>'isRelic', 'memorabilia', 'non-memorabilia'
    ),
    case
      when nullif(btrim(coalesce(p_ai->>'gradingCompany', '')), '') is not null
        or nullif(btrim(coalesce(p_ai->>'gradeValue', '')), '') is not null
      then 'graded'
      else 'raw'
    end,
    coalesce(
      public.tcos_instacomp_knowledge_normalize(p_ai->>'gradingCompany'),
      'none'
    ),
    coalesce(
      public.tcos_instacomp_knowledge_normalize(p_ai->>'gradeValue'),
      'none'
    ),
    coalesce(
      public.tcos_instacomp_knowledge_normalize(
        coalesce(nullif(p_ai->>'languageCode',''), nullif(p_ai->>'language',''))
      ),
      'unknown'
    ),
    coalesce(
      public.tcos_instacomp_knowledge_normalize(
        p_ai->>'configurationExclusivity'
      ),
      'none'
    )
  );
$$;

create or replace function public.tcos_instacomp_entry_ai_snapshot(
  p_entry public.tcos_card_knowledge_entries
)
returns jsonb
language sql
stable
as $$
  select jsonb_strip_nulls(
    coalesce(p_entry.ai_result, '{}'::jsonb) ||
    jsonb_build_object(
      'year', p_entry.year,
      'brand', p_entry.brand,
      'setName', p_entry.set_name,
      'cardNumber', p_entry.card_number,
      'player', p_entry.player,
      'parallel', p_entry.parallel,
      'variation', p_entry.variation,
      'serialNumber', p_entry.serial_number,
      'team', p_entry.team,
      'sport', p_entry.sport,
      'isRookie', p_entry.is_rookie,
      'isAuto', p_entry.is_auto,
      'isRelic', p_entry.is_relic
    )
  );
$$;

create or replace function public.tcos_instacomp_set_fingerprint_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.identity_fingerprint_v2 := public.tcos_instacomp_knowledge_fingerprint(
    public.tcos_instacomp_entry_ai_snapshot(new)
  );
  return new;
end;
$$;

drop trigger if exists tcos_card_knowledge_entries_set_fingerprint_v2
  on public.tcos_card_knowledge_entries;
create trigger tcos_card_knowledge_entries_set_fingerprint_v2
before insert or update of
  year, brand, set_name, card_number, player, parallel, variation,
  serial_number, is_auto, is_relic, ai_result
on public.tcos_card_knowledge_entries
for each row execute function public.tcos_instacomp_set_fingerprint_v2();

update public.tcos_card_knowledge_entries entry
set identity_fingerprint_v2 = public.tcos_instacomp_knowledge_fingerprint(
  public.tcos_instacomp_entry_ai_snapshot(entry)
)
where identity_fingerprint_v2 is null
   or identity_fingerprint_v2 not like 'v2|%';

with collisions as (
  select
    identity_fingerprint_v2,
    array_agg(id order by created_at, id) as entry_ids,
    count(*)::integer as entry_count
  from public.tcos_card_knowledge_entries
  where identity_fingerprint_v2 is not null
  group by identity_fingerprint_v2
  having count(*) > 1
)
insert into public.tcos_card_knowledge_collision_audit(
  identity_fingerprint_v2,
  knowledge_entry_ids,
  entry_count,
  evidence
)
select
  identity_fingerprint_v2,
  entry_ids,
  entry_count,
  jsonb_build_object(
    'reason', 'Multiple legacy knowledge rows map to one complete v2 identity.',
    'automaticMergeAllowed', false,
    'requiredAction', 'Operator review and split/merge decision.'
  )
from collisions
on conflict(identity_fingerprint_v2) do update
set knowledge_entry_ids = excluded.knowledge_entry_ids,
    entry_count = excluded.entry_count,
    evidence = excluded.evidence,
    updated_at = now();

update public.tcos_card_knowledge_entries entry
set collision_detected = true,
    trust_status = 'needs_review',
    trusted_at = null
where exists (
  select 1
  from public.tcos_card_knowledge_collision_audit audit
  where audit.identity_fingerprint_v2 = entry.identity_fingerprint_v2
    and audit.status in ('open','in_review')
);

create or replace function public.tcos_instacomp_reject_canonical_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'InstaComp canonical knowledge history is append-only';
end;
$$;

drop trigger if exists tcos_card_knowledge_canonical_versions_append_only
  on public.tcos_card_knowledge_canonical_versions;
create trigger tcos_card_knowledge_canonical_versions_append_only
before update or delete on public.tcos_card_knowledge_canonical_versions
for each row execute function public.tcos_instacomp_reject_canonical_history_mutation();

insert into public.tcos_card_knowledge_canonical_versions(
  knowledge_entry_id,
  revision,
  promoted_by_status,
  source_observation_id,
  identity_fingerprint,
  identity_fingerprint_v2,
  canonical_snapshot,
  created_at
)
select
  entry.id,
  1,
  'migration_snapshot',
  null,
  entry.identity_fingerprint,
  entry.identity_fingerprint_v2,
  to_jsonb(entry),
  coalesce(entry.trusted_at, entry.updated_at, now())
from public.tcos_card_knowledge_entries entry
where entry.trust_status = 'tcos_trusted'
  and not entry.collision_detected
  and not exists (
    select 1
    from public.tcos_card_knowledge_canonical_versions version
    where version.knowledge_entry_id = entry.id
  );

update public.tcos_card_knowledge_entries
set canonical_revision = 1,
    canonical_promotion_status = coalesce(canonical_promotion_status, 'migration_snapshot'),
    canonical_promoted_at = coalesce(canonical_promoted_at, trusted_at, updated_at, now())
where trust_status = 'tcos_trusted'
  and not collision_detected
  and canonical_revision = 0;

create or replace function public.tcos_instacomp_protect_trusted_canonical()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.trust_status = 'tcos_trusted'
     and coalesce(current_setting('tcos.instacomp_canonical_promotion', true), '') <> 'on'
  then
    new.identity_fingerprint := old.identity_fingerprint;
    new.identity_fingerprint_v2 := old.identity_fingerprint_v2;
    new.title := old.title;
    new.year := old.year;
    new.brand := old.brand;
    new.set_name := old.set_name;
    new.card_number := old.card_number;
    new.player := old.player;
    new.parallel := old.parallel;
    new.variation := old.variation;
    new.serial_run := old.serial_run;
    new.serial_number := old.serial_number;
    new.team := old.team;
    new.sport := old.sport;
    new.is_rookie := old.is_rookie;
    new.is_auto := old.is_auto;
    new.is_relic := old.is_relic;
    new.ai_result := old.ai_result;
    new.operator_corrections := old.operator_corrections;
    new.catalog_evidence := old.catalog_evidence;
    new.consensus := old.consensus;
    new.market_snapshot := old.market_snapshot;
    new.source_coverage := old.source_coverage;
    new.result_payload := old.result_payload;
    new.trust_status := old.trust_status;
    new.trusted_at := old.trusted_at;
    new.collision_detected := old.collision_detected;
    new.canonical_revision := old.canonical_revision;
    new.canonical_promotion_status := old.canonical_promotion_status;
    new.canonical_promoted_at := old.canonical_promoted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists tcos_card_knowledge_entries_protect_trusted
  on public.tcos_card_knowledge_entries;
create trigger tcos_card_knowledge_entries_protect_trusted
before update on public.tcos_card_knowledge_entries
for each row execute function public.tcos_instacomp_protect_trusted_canonical();

create or replace function public.tcos_instacomp_promote_confirmed_observation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ai jsonb;
  v_entry public.tcos_card_knowledge_entries%rowtype;
  v_revision integer;
begin
  if new.confirmation_status not in ('operator_confirmed','catalog_confirmed') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.confirmation_status = new.confirmation_status
     and old.ai_result = new.ai_result
     and old.operator_corrections = new.operator_corrections
     and old.catalog_evidence = new.catalog_evidence
     and old.result_payload = new.result_payload
  then
    return new;
  end if;

  select * into v_entry
  from public.tcos_card_knowledge_entries
  where id = new.knowledge_entry_id
  for update;

  if v_entry.id is null then
    return new;
  end if;

  v_ai := jsonb_strip_nulls(
    coalesce(new.ai_result, '{}'::jsonb) ||
    coalesce(new.operator_corrections, '{}'::jsonb)
  );
  v_revision := greatest(coalesce(v_entry.canonical_revision, 0), 0) + 1;

  perform set_config('tcos.instacomp_canonical_promotion', 'on', true);

  update public.tcos_card_knowledge_entries
  set identity_fingerprint = public.tcos_instacomp_knowledge_fingerprint(v_ai),
      identity_fingerprint_v2 = public.tcos_instacomp_knowledge_fingerprint(v_ai),
      title = public.tcos_instacomp_knowledge_title(v_ai),
      year = nullif(v_ai->>'year',''),
      brand = nullif(v_ai->>'brand',''),
      set_name = nullif(v_ai->>'setName',''),
      card_number = nullif(v_ai->>'cardNumber',''),
      player = nullif(v_ai->>'player',''),
      parallel = nullif(v_ai->>'parallel',''),
      variation = nullif(v_ai->>'variation',''),
      serial_run = public.tcos_instacomp_knowledge_serial_run(v_ai->>'serialNumber'),
      serial_number = nullif(v_ai->>'serialNumber',''),
      team = nullif(v_ai->>'team',''),
      sport = nullif(v_ai->>'sport',''),
      is_rookie = lower(coalesce(v_ai->>'isRookie','false')) in ('true','t','1','yes','y'),
      is_auto = lower(coalesce(v_ai->>'isAuto','false')) in ('true','t','1','yes','y'),
      is_relic = lower(coalesce(v_ai->>'isRelic','false')) in ('true','t','1','yes','y'),
      ai_result = v_ai,
      operator_corrections = coalesce(new.operator_corrections, '{}'::jsonb),
      catalog_evidence = coalesce(new.catalog_evidence, '{}'::jsonb),
      consensus = coalesce(new.consensus, '{}'::jsonb),
      result_payload = coalesce(new.result_payload, '{}'::jsonb),
      trust_status = case when collision_detected then 'needs_review' else 'tcos_trusted' end,
      trusted_at = case when collision_detected then null else coalesce(trusted_at, now()) end,
      canonical_revision = v_revision,
      canonical_promotion_status = new.confirmation_status,
      canonical_promoted_at = now(),
      updated_at = now()
  where id = new.knowledge_entry_id
  returning * into v_entry;

  if not v_entry.collision_detected then
    insert into public.tcos_card_knowledge_canonical_versions(
      knowledge_entry_id,
      revision,
      promoted_by_status,
      source_observation_id,
      identity_fingerprint,
      identity_fingerprint_v2,
      canonical_snapshot
    ) values (
      v_entry.id,
      v_revision,
      new.confirmation_status,
      new.id,
      v_entry.identity_fingerprint,
      v_entry.identity_fingerprint_v2,
      to_jsonb(v_entry)
    )
    on conflict(knowledge_entry_id, revision) do nothing;
  end if;

  return new;
exception
  when unique_violation then
    perform set_config('tcos.instacomp_canonical_promotion', 'on', true);
    update public.tcos_card_knowledge_entries
    set collision_detected = true,
        trust_status = 'needs_review',
        trusted_at = null,
        updated_at = now()
    where id = new.knowledge_entry_id;
    return new;
end;
$$;

drop trigger if exists tcos_card_knowledge_observations_promote_canonical
  on public.tcos_card_knowledge_observations;
create trigger tcos_card_knowledge_observations_promote_canonical
after insert or update of
  confirmation_status, ai_result, operator_corrections,
  catalog_evidence, consensus, result_payload
on public.tcos_card_knowledge_observations
for each row execute function public.tcos_instacomp_promote_confirmed_observation();

revoke all on function public.tcos_instacomp_knowledge_boolean_label(text,text,text)
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_entry_ai_snapshot(public.tcos_card_knowledge_entries)
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_set_fingerprint_v2()
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_protect_trusted_canonical()
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_promote_confirmed_observation()
  from public, anon, authenticated;

grant execute on function public.tcos_instacomp_knowledge_boolean_label(text,text,text)
  to service_role;
grant execute on function public.tcos_instacomp_entry_ai_snapshot(public.tcos_card_knowledge_entries)
  to service_role;
grant execute on function public.tcos_instacomp_set_fingerprint_v2()
  to service_role;
grant execute on function public.tcos_instacomp_protect_trusted_canonical()
  to service_role;
grant execute on function public.tcos_instacomp_promote_confirmed_observation()
  to service_role;
