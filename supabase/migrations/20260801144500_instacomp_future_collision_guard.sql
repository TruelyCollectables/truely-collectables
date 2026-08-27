-- Keep future complete-identity collisions fail-closed after the one-time legacy
-- audit in the main InstaComp cache/knowledge hardening migration.

create or replace function public.tcos_instacomp_flag_v2_collision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry_ids uuid[];
  v_entry_count integer;
begin
  if new.identity_fingerprint_v2 is null then
    return new;
  end if;

  select array_agg(id order by created_at, id), count(*)::integer
  into v_entry_ids, v_entry_count
  from public.tcos_card_knowledge_entries
  where identity_fingerprint_v2 = new.identity_fingerprint_v2;

  if coalesce(v_entry_count, 0) <= 1 then
    return new;
  end if;

  insert into public.tcos_card_knowledge_collision_audit(
    identity_fingerprint_v2,
    knowledge_entry_ids,
    entry_count,
    status,
    evidence
  ) values (
    new.identity_fingerprint_v2,
    v_entry_ids,
    v_entry_count,
    'open',
    jsonb_build_object(
      'reason', 'Multiple knowledge rows map to one complete v2 identity.',
      'detectedBy', 'tcos_instacomp_flag_v2_collision',
      'automaticMergeAllowed', false,
      'requiredAction', 'Operator review and explicit split/merge resolution.'
    )
  )
  on conflict(identity_fingerprint_v2) do update
  set knowledge_entry_ids = excluded.knowledge_entry_ids,
      entry_count = excluded.entry_count,
      status = case
        when public.tcos_card_knowledge_collision_audit.status = 'dismissed'
          then 'open'
        else public.tcos_card_knowledge_collision_audit.status
      end,
      evidence = excluded.evidence,
      resolved_at = null,
      resolution_notes = null,
      updated_at = now();

  perform set_config('tcos.instacomp_canonical_promotion', 'on', true);
  update public.tcos_card_knowledge_entries
  set collision_detected = true,
      trust_status = 'needs_review',
      trusted_at = null,
      updated_at = now()
  where id = any(v_entry_ids);

  return new;
end;
$$;

drop trigger if exists tcos_card_knowledge_entries_flag_v2_collision
  on public.tcos_card_knowledge_entries;
create trigger tcos_card_knowledge_entries_flag_v2_collision
after insert or update of identity_fingerprint_v2
on public.tcos_card_knowledge_entries
for each row execute function public.tcos_instacomp_flag_v2_collision();

revoke all on function public.tcos_instacomp_flag_v2_collision()
  from public, anon, authenticated;
grant execute on function public.tcos_instacomp_flag_v2_collision()
  to service_role;
