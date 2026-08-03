-- Round Two learning provenance hardening.
-- A bare consensus boolean is not a durable trust receipt. Reusable catalog or
-- operator knowledge must carry one exact Registry identity, one exact catalog
-- identity, an allowed comp-search decision, and agreement between both IDs.
-- Automatic observations verify the permanent scan ledger directly because the
-- legacy recovered result payload intentionally contains only a reduced view.

begin;

create or replace function public.tcos_instacomp_payload_exact_identity_trusted(
  p_payload jsonb
)
returns boolean
language sql
immutable
as $$
  select
    lower(coalesce(p_payload #>> '{consensus,trustedForIdentity}', 'false')) = 'true'
    and lower(coalesce(p_payload #>> '{compSearchDecision,allowed}', 'false')) = 'true'
    and lower(coalesce(p_payload #>> '{checklistRegistry,matched}', 'false')) = 'true'
    and nullif(btrim(coalesce(p_payload #>> '{checklistRegistry,identityId}', '')), '') is not null
    and lower(coalesce(p_payload #>> '{catalogEvidence,status}', '')) = 'catalog_confirmed'
    and lower(coalesce(p_payload #>> '{catalogEvidence,catalogConfirmed}', 'false')) = 'true'
    and nullif(
      btrim(coalesce(p_payload #>> '{catalogEvidence,selectedMatch,catalogId}', '')),
      ''
    ) is not null
    and btrim(p_payload #>> '{checklistRegistry,identityId}') =
      btrim(p_payload #>> '{catalogEvidence,selectedMatch,catalogId}');
$$;

create or replace function public.tcos_instacomp_observation_exact_identity_trusted(
  p_source_scan_id text,
  p_result_payload jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb := coalesce(p_result_payload, '{}'::jsonb);
  v_scan_payload jsonb;
begin
  if nullif(btrim(coalesce(p_source_scan_id, '')), '') is not null
     and to_regclass('public.instacomp_scans') is not null then
    select coalesce(raw_comp_results, '{}'::jsonb)
    into v_scan_payload
    from public.instacomp_scans
    where id::text = p_source_scan_id
    limit 1;

    if found then
      v_payload := v_scan_payload;
    end if;
  end if;

  return public.tcos_instacomp_payload_exact_identity_trusted(v_payload);
end;
$$;

create or replace function public.tcos_instacomp_enforce_observation_identity_trust()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exact_identity_trusted boolean :=
    public.tcos_instacomp_observation_exact_identity_trusted(
      new.source_scan_id::text,
      coalesce(new.result_payload, '{}'::jsonb)
    );
begin
  if new.confirmation_status = 'catalog_confirmed'
     and not v_exact_identity_trusted then
    new.confirmation_status := 'scanner_observed';
  end if;

  if new.confirmation_status = 'operator_confirmed'
     and not v_exact_identity_trusted
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
    before insert or update of confirmation_status, source_scan_id, consensus,
      catalog_evidence, operator_corrections, ai_result, result_payload
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
  v_corrections jsonb := coalesce(v_payload->'operatorCorrections', '{}'::jsonb);
  v_ai jsonb := coalesce(v_payload->'ai', '{}'::jsonb);
  v_exact_identity_trusted boolean :=
    public.tcos_instacomp_payload_exact_identity_trusted(v_payload);
begin
  if new.confirmation_status = 'catalog_confirmed'
     and not v_exact_identity_trusted then
    new.confirmation_status := 'scanner_observed';
    new.trusted_for_pricing := false;
  end if;

  if new.confirmation_status = 'operator_confirmed'
     and not v_exact_identity_trusted
     and not public.tcos_instacomp_operator_identity_complete(v_corrections, v_ai) then
    new.confirmation_status := 'needs_more_info';
    new.trusted_for_pricing := false;
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
    before insert or update of confirmation_status, response_payload,
      trusted_for_pricing
    on public.instacomp_scan_knowledge_cache
    for each row execute function public.tcos_instacomp_enforce_cache_identity_trust();
  end if;
end;
$$;

create temporary table instacomp_learning_provenance_impacted_entries (
  id uuid primary key
) on commit drop;

insert into instacomp_learning_provenance_impacted_entries(id)
select distinct knowledge_entry_id
from public.tcos_card_knowledge_observations
where knowledge_entry_id is not null
  and (
    (
      confirmation_status = 'catalog_confirmed'
      and not public.tcos_instacomp_observation_exact_identity_trusted(
        source_scan_id::text,
        coalesce(result_payload, '{}'::jsonb)
      )
    )
    or (
      confirmation_status = 'operator_confirmed'
      and not public.tcos_instacomp_observation_exact_identity_trusted(
        source_scan_id::text,
        coalesce(result_payload, '{}'::jsonb)
      )
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
  and not public.tcos_instacomp_observation_exact_identity_trusted(
    source_scan_id::text,
    coalesce(result_payload, '{}'::jsonb)
  );

update public.tcos_card_knowledge_observations
set confirmation_status = 'needs_more_info'
where confirmation_status = 'operator_confirmed'
  and not public.tcos_instacomp_observation_exact_identity_trusted(
    source_scan_id::text,
    coalesce(result_payload, '{}'::jsonb)
  )
  and not public.tcos_instacomp_operator_identity_complete(
    coalesce(operator_corrections, '{}'::jsonb),
    coalesce(ai_result, '{}'::jsonb)
  );

update public.instacomp_scan_knowledge_cache
set confirmation_status = 'scanner_observed',
    trusted_for_pricing = false
where confirmation_status = 'catalog_confirmed'
  and not public.tcos_instacomp_payload_exact_identity_trusted(
    coalesce(response_payload, '{}'::jsonb)
  );

update public.instacomp_scan_knowledge_cache
set confirmation_status = 'needs_more_info',
    trusted_for_pricing = false
where confirmation_status = 'operator_confirmed'
  and not public.tcos_instacomp_payload_exact_identity_trusted(
    coalesce(response_payload, '{}'::jsonb)
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
    select id from instacomp_learning_provenance_impacted_entries
  loop
    perform public.tcos_instacomp_refresh_knowledge_entry(v_entry_id);
  end loop;
end;
$$;

revoke all on function public.tcos_instacomp_payload_exact_identity_trusted(jsonb)
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_observation_exact_identity_trusted(text,jsonb)
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_enforce_observation_identity_trust()
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_enforce_cache_identity_trust()
  from public, anon, authenticated;

grant execute on function public.tcos_instacomp_payload_exact_identity_trusted(jsonb)
  to service_role;
grant execute on function public.tcos_instacomp_observation_exact_identity_trusted(text,jsonb)
  to service_role;
grant execute on function public.tcos_instacomp_enforce_observation_identity_trust()
  to service_role;
grant execute on function public.tcos_instacomp_enforce_cache_identity_trust()
  to service_role;

commit;
