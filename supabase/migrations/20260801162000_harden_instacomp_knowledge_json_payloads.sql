begin;

-- PostgreSQL JSON null is a real jsonb value, not SQL NULL. Legacy scan rows can
-- therefore bypass COALESCE(...) and reach the knowledge tables as JSON `null`,
-- where the object/array constraints correctly reject them. Normalize every
-- write at the table boundary so automatic learning, operator confirmation, and
-- future import paths cannot be broken by nullable provider payload members.

create or replace function public.tcos_instacomp_normalize_knowledge_entry_json()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.ai_result := case
    when jsonb_typeof(new.ai_result) = 'object' then new.ai_result
    else '{}'::jsonb
  end;
  new.operator_corrections := case
    when jsonb_typeof(new.operator_corrections) = 'object'
      then new.operator_corrections
    else '{}'::jsonb
  end;
  new.catalog_evidence := case
    when jsonb_typeof(new.catalog_evidence) = 'object'
      then new.catalog_evidence
    else '{}'::jsonb
  end;
  new.consensus := case
    when jsonb_typeof(new.consensus) = 'object' then new.consensus
    else '{}'::jsonb
  end;
  new.market_snapshot := case
    when jsonb_typeof(new.market_snapshot) = 'object' then new.market_snapshot
    else '{}'::jsonb
  end;
  new.source_coverage := case
    when jsonb_typeof(new.source_coverage) = 'array' then new.source_coverage
    else '[]'::jsonb
  end;
  new.result_payload := case
    when jsonb_typeof(new.result_payload) = 'object' then new.result_payload
    else '{}'::jsonb
  end;
  return new;
end;
$$;

drop trigger if exists tcos_card_knowledge_entries_normalize_json
  on public.tcos_card_knowledge_entries;
create trigger tcos_card_knowledge_entries_normalize_json
before insert or update on public.tcos_card_knowledge_entries
for each row
execute function public.tcos_instacomp_normalize_knowledge_entry_json();

create or replace function public.tcos_instacomp_normalize_knowledge_observation_json()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.ai_result := case
    when jsonb_typeof(new.ai_result) = 'object' then new.ai_result
    else '{}'::jsonb
  end;
  new.operator_corrections := case
    when jsonb_typeof(new.operator_corrections) = 'object'
      then new.operator_corrections
    else '{}'::jsonb
  end;
  new.catalog_evidence := case
    when jsonb_typeof(new.catalog_evidence) = 'object'
      then new.catalog_evidence
    else '{}'::jsonb
  end;
  new.consensus := case
    when jsonb_typeof(new.consensus) = 'object' then new.consensus
    else '{}'::jsonb
  end;
  new.result_payload := case
    when jsonb_typeof(new.result_payload) = 'object' then new.result_payload
    else '{}'::jsonb
  end;
  return new;
end;
$$;

drop trigger if exists tcos_card_knowledge_observations_normalize_json
  on public.tcos_card_knowledge_observations;
create trigger tcos_card_knowledge_observations_normalize_json
before insert or update on public.tcos_card_knowledge_observations
for each row
execute function public.tcos_instacomp_normalize_knowledge_observation_json();

revoke all on function public.tcos_instacomp_normalize_knowledge_entry_json()
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_normalize_knowledge_observation_json()
  from public, anon, authenticated;

commit;
