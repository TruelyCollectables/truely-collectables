-- Optimize trusted InstaComp holdout lookup around exact player + card number.
create index if not exists checklist_card_players_instacomp_player_card_idx
  on public.checklist_card_players using btree (player_id, card_id);

create index if not exists checklist_cards_instacomp_number_card_idx
  on public.checklist_cards using btree (normalized_card_number, id);

create or replace function public.instacomp_holdout_player_card_candidates_v1(
  p_player text,
  p_card_number text,
  p_limit integer default 500
)
returns table (
  identity_id uuid,
  fingerprint_sha256 text,
  card_id uuid,
  release_id uuid,
  version_id uuid,
  set_id uuid,
  card_number text,
  players text[],
  teams text[],
  release_year text,
  season text,
  manufacturer text,
  brand text,
  product_name text,
  set_name text,
  sport text,
  league text,
  parallel text,
  serial_run integer,
  variation text,
  autograph_status text,
  memorabilia_status text
)
language sql
stable
set search_path = public
as $$
  with player_cards as materialized (
    select distinct cp.card_id
    from public.checklist_players p
    join public.checklist_card_players cp on cp.player_id = p.id
    where p.normalized_name = lower(regexp_replace(trim(p_player), '\s+', ' ', 'g'))
  ),
  number_cards as materialized (
    select c.id as card_id
    from public.checklist_cards c
    where c.normalized_card_number = lower(regexp_replace(trim(p_card_number), '[\s-]+', '', 'g'))
  ),
  matched_cards as materialized (
    select c.id, c.release_id, c.version_id, c.set_id, c.card_number,
           c.variation, c.autograph_status, c.memorabilia_status
    from number_cards n
    join player_cards pc on pc.card_id = n.card_id
    join public.checklist_cards c on c.id = n.card_id
    join public.checklist_versions v on v.id = c.version_id
      and v.is_active = true
      and v.status = 'live'
      and v.release_id = c.release_id
    limit least(greatest(coalesce(p_limit, 500), 1), 1000) + 1
  )
  select
    i.id as identity_id,
    i.fingerprint_sha256,
    mc.id as card_id,
    mc.release_id,
    mc.version_id,
    mc.set_id,
    mc.card_number,
    coalesce((
      select array_agg(pl.canonical_name order by cp.display_order, pl.canonical_name)
      from public.checklist_card_players cp
      join public.checklist_players pl on pl.id = cp.player_id
      where cp.card_id = mc.id
    ), array[]::text[]) as players,
    coalesce((
      select array_agg(t.canonical_name order by ct.display_order, t.canonical_name)
      from public.checklist_card_teams ct
      join public.checklist_teams t on t.id = ct.team_id
      where ct.card_id = mc.id
    ), array[]::text[]) as teams,
    r.release_year,
    r.season,
    m.name as manufacturer,
    b.name as brand,
    r.product_name,
    s.name as set_name,
    sp.name as sport,
    l.name as league,
    coalesce(par.name, 'Base') as parallel,
    par.serial_run,
    coalesce(i.variation, mc.variation) as variation,
    coalesce(i.autograph_status, mc.autograph_status) as autograph_status,
    coalesce(i.memorabilia_status, mc.memorabilia_status) as memorabilia_status
  from matched_cards mc
  join public.checklist_card_identities i on i.card_id = mc.id
  join public.checklist_releases r on r.id = mc.release_id
  left join public.checklist_sets s on s.id = mc.set_id
  left join public.checklist_parallels par on par.id = i.parallel_id
  left join public.checklist_manufacturers m on m.id = r.manufacturer_id
  left join public.checklist_brands b on b.id = r.brand_id
  left join public.checklist_sports sp on sp.id = r.sport_id
  left join public.checklist_leagues l on l.id = r.league_id;
$$;

grant execute on function public.instacomp_holdout_player_card_candidates_v1(text, text, integer) to service_role;
