-- Fail-closed trust gate for InstaComp reusable learning.
-- Catalog and operator confirmations may not promote unresolved scanner guesses.

begin;

create or replace function public.tcos_instacomp_consensus_identity_trusted(
  p_consensus jsonb
)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_consensus->>'trustedForIdentity', 'false')) = 'true';
$$;

create or replace function public.tcos_instacomp_operator_identity_complete(
  p_corrections jsonb,
  p_ai jsonb
)
returns boolean
language sql
immutable
as $$
  select
    nullif(btrim(coalesce(p_corrections->>'player', '')), '') is not null
    and nullif(btrim(coalesce(p_corrections->>'year', '')), '') is not null
    and nullif(btrim(coalesce(p_corrections->>'brand', '')), '') is not null
    and nullif(btrim(coalesce(p_corrections->>'setName', '')), '') is not null
    and nullif(btrim(coalesce(p_corrections->>'cardNumber', '')), '') is not null
    and nullif(btrim(coalesce(p_corrections->>'parallel', '')), '') is not null
    and (
      nullif(btrim(coalesce(p_ai->>'serialNumber', '')), '') is null
      or nullif(btrim(coalesce(p_corrections->>'serialNumber', '')), '') is not null
    );
$$;

create or replace function public.tcos_instacomp_enforce_observation_identity_trust()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.confirmation_status = 'catalog_confirmed'
     and not (
       public.tcos_instacomp_consensus_identity_trusted(coalesce(new.consensus, '{}'::jsonb))
       and lower(coalesce(new.catalog_evidence->>'catalogConfirmed', 'false')) = 'true'
     ) then
    new.confirmation_status := 'scanner_observed';
  end if;

  if new.confirmation_status = 'operator_confirmed'
     and not public.tcos_instacomp_consensus_identity_trusted(coalesce(new.consensus, '{}'::jsonb))
     and not public.tcos_instacomp_operator_identity_complete(
       coalesce(new.operator_corrections, '{}'::jsonb),
       coalesce(new.ai_result, '{}'::jsonb)
     ) then
    new.confirmation_status := 'needs_more_info';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.tcos_card_knowledge_observations') is not null then
    drop trigger if exists tcos_instacomp_observation_identity_trust_gate
      on public.tcos_card_knowledge_observations;
    create trigger tcos_instacomp_observation_identity_trust_gate
    before insert or update of confirmation_status, consensus, catalog_evidence,
      operator_corrections, ai_result
    on public.tcos_card_knowledge_observations
    for each row execute function public.tcos_instacomp_enforce_observation_identity_trust();
  end if;
end;
$$;

create or replace function public.tcos_instacomp_enforce_cache_identity_trust()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb := coalesce(new.response_payload, '{}'::jsonb);
  v_consensus jsonb := coalesce(v_payload->'consensus', '{}'::jsonb);
  v_corrections jsonb := coalesce(v_payload->'operatorCorrections', '{}'::jsonb);
  v_ai jsonb := coalesce(v_payload->'ai', '{}'::jsonb);
begin
  if new.confirmation_status = 'catalog_confirmed'
     and not (
       public.tcos_instacomp_consensus_identity_trusted(v_consensus)
       and lower(coalesce(v_payload #>> '{catalogEvidence,catalogConfirmed}', 'false')) = 'true'
     ) then
    new.confirmation_status := 'scanner_observed';
  end if;

  if new.confirmation_status = 'operator_confirmed'
     and not public.tcos_instacomp_consensus_identity_trusted(v_consensus)
     and not public.tcos_instacomp_operator_identity_complete(v_corrections, v_ai) then
    new.confirmation_status := 'needs_more_info';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.instacomp_scan_knowledge_cache') is not null then
    drop trigger if exists tcos_instacomp_cache_identity_trust_gate
      on public.instacomp_scan_knowledge_cache;
    create trigger tcos_instacomp_cache_identity_trust_gate
    before insert or update of confirmation_status, response_payload
    on public.instacomp_scan_knowledge_cache
    for each row execute function public.tcos_instacomp_enforce_cache_identity_trust();
  end if;
end;
$$;

create temporary table instacomp_learning_gate_impacted_entries (
  id uuid primary key
) on commit drop;

insert into instacomp_learning_gate_impacted_entries(id)
select distinct knowledge_entry_id
from public.tcos_card_knowledge_observations
where knowledge_entry_id is not null
  and (
    (
      confirmation_status = 'catalog_confirmed'
      and not (
        public.tcos_instacomp_consensus_identity_trusted(coalesce(consensus, '{}'::jsonb))
        and lower(coalesce(catalog_evidence->>'catalogConfirmed', 'false')) = 'true'
      )
    )
    or (
      confirmation_status = 'operator_confirmed'
      and not public.tcos_instacomp_consensus_identity_trusted(coalesce(consensus, '{}'::jsonb))
      and not public.tcos_instacomp_operator_identity_complete(
        coalesce(operator_corrections, '{}'::jsonb),
        coalesce(ai_result, '{}'::jsonb)
      )
    )
  )
on conflict do nothing;

update public.tcos_card_knowledge_observations
set confirmation_status = 'scanner_observed'
where confirmation_status = 'catalog_confirmed'
  and not (
    public.tcos_instacomp_consensus_identity_trusted(coalesce(consensus, '{}'::jsonb))
    and lower(coalesce(catalog_evidence->>'catalogConfirmed', 'false')) = 'true'
  );

update public.tcos_card_knowledge_observations
set confirmation_status = 'needs_more_info'
where confirmation_status = 'operator_confirmed'
  and not public.tcos_instacomp_consensus_identity_trusted(coalesce(consensus, '{}'::jsonb))
  and not public.tcos_instacomp_operator_identity_complete(
    coalesce(operator_corrections, '{}'::jsonb),
    coalesce(ai_result, '{}'::jsonb)
  );

update public.instacomp_scan_knowledge_cache
set confirmation_status = 'scanner_observed'
where confirmation_status = 'catalog_confirmed'
  and not (
    public.tcos_instacomp_consensus_identity_trusted(
      coalesce(response_payload->'consensus', '{}'::jsonb)
    )
    and lower(coalesce(response_payload #>> '{catalogEvidence,catalogConfirmed}', 'false')) = 'true'
  );

update public.instacomp_scan_knowledge_cache
set confirmation_status = 'needs_more_info'
where confirmation_status = 'operator_confirmed'
  and not public.tcos_instacomp_consensus_identity_trusted(
    coalesce(response_payload->'consensus', '{}'::jsonb)
  )
  and not public.tcos_instacomp_operator_identity_complete(
    coalesce(response_payload->'operatorCorrections', '{}'::jsonb),
    coalesce(response_payload->'ai', '{}'::jsonb)
  );

do $$
declare
  v_entry_id uuid;
begin
  for v_entry_id in
    select id from instacomp_learning_gate_impacted_entries
  loop
    perform public.tcos_instacomp_refresh_knowledge_entry(v_entry_id);
  end loop;
end;
$$;

revoke all on function public.tcos_instacomp_consensus_identity_trusted(jsonb)
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_operator_identity_complete(jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_enforce_observation_identity_trust()
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_enforce_cache_identity_trust()
  from public, anon, authenticated;
grant execute on function public.tcos_instacomp_consensus_identity_trusted(jsonb)
  to service_role;
grant execute on function public.tcos_instacomp_operator_identity_complete(jsonb,jsonb)
  to service_role;

commit;
