create index if not exists checklist_card_identities_holdout_players_idx
  on public.checklist_card_identities
  using gin ((metadata -> 'players') jsonb_path_ops);

create index if not exists checklist_card_identities_holdout_card_number_idx
  on public.checklist_card_identities
  ((split_part(split_part(canonical_key, '|card_number=', 2), '|', 1)));

create or replace function public.instacomp_holdout_identity_candidates(
  p_players text[],
  p_card_number text,
  p_limit integer default 201
)
returns table (
  identity_id uuid,
  card_id uuid,
  fingerprint_sha256 text,
  canonical_key text,
  metadata jsonb,
  version_id uuid,
  release_id uuid,
  set_id uuid,
  variation text,
  autograph_status text,
  memorabilia_status text
)
language sql
stable
set search_path = public
as $$
  select
    i.id as identity_id,
    i.card_id,
    i.fingerprint_sha256,
    i.canonical_key,
    i.metadata,
    i.version_id,
    i.release_id,
    i.set_id,
    i.variation,
    i.autograph_status,
    i.memorabilia_status
  from public.checklist_card_identities i
  join public.checklist_versions v on v.id = i.version_id
  where v.is_active = true
    and v.status = 'live'
    and (i.metadata -> 'players') @> to_jsonb(coalesce(p_players, array[]::text[]))
    and split_part(split_part(i.canonical_key, '|card_number=', 2), '|', 1) = p_card_number
  order by i.fingerprint_sha256
  limit least(greatest(coalesce(p_limit, 201), 1), 501);
$$;

revoke all on function public.instacomp_holdout_identity_candidates(text[], text, integer) from public;
grant execute on function public.instacomp_holdout_identity_candidates(text[], text, integer) to service_role;
