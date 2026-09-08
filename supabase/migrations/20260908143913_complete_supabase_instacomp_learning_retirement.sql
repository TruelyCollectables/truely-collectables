-- Production follow-up for projects that had already recorded the first retirement
-- migration before its stronger trigger/grant lockdown was source-controlled.
-- Safe to reapply: Supabase is storefront/audit/cache mirror only; Mac-local
-- services own Registry identity, operator lessons, pricing trust, and LoRA learning.

drop trigger if exists instacomp_scans_auto_learning on public.instacomp_scans;
drop trigger if exists tcos_card_knowledge_observations_promote_canonical
  on public.tcos_card_knowledge_observations;

revoke execute on function public.tcos_instacomp_scan_learning_trigger()
  from public, anon, authenticated, service_role;
revoke execute on function public.tcos_instacomp_record_scan_knowledge_payload(jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.tcos_instacomp_refresh_knowledge_entry(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.tcos_instacomp_confirm_scan_knowledge(text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.tcos_instacomp_record_cache_replay(uuid, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.tcos_instacomp_promote_confirmed_observation()
  from public, anon, authenticated, service_role;

revoke insert, update, delete on table public.tcos_card_knowledge_entries
  from anon, authenticated, service_role;
revoke insert, update, delete on table public.tcos_card_knowledge_observations
  from anon, authenticated, service_role;
revoke insert, update, delete on table public.tcos_card_knowledge_canonical_versions
  from anon, authenticated, service_role;

update public.instacomp_scan_knowledge_cache
set knowledge_entry_id = null,
    confirmation_status = 'scanner_observed'
where knowledge_entry_id is not null
   or confirmation_status <> 'scanner_observed';

update public.tcos_card_knowledge_entries
set trust_status = 'needs_review',
    trusted_at = null
where trust_status = 'tcos_trusted'
   or trusted_at is not null;
