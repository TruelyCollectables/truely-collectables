create table if not exists public.checklist_card_number_aliases (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.checklist_cards(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (card_id, normalized_alias)
);

create index if not exists checklist_card_number_aliases_lookup_idx
  on public.checklist_card_number_aliases (normalized_alias);

alter table public.checklist_card_number_aliases enable row level security;
revoke all on table public.checklist_card_number_aliases from anon, authenticated;
grant select, insert, update, delete on table public.checklist_card_number_aliases to service_role;

-- Panini's 2025 Prizm WNBA checklist uses numeric checklist positions for these
-- autograph sets while the physical cards visibly print alphanumeric numbers.
-- Preserve the authoritative checklist number and add the verified physical
-- number as an alias instead of rewriting canonical card_number.
insert into public.checklist_card_number_aliases (
  card_id,
  alias,
  normalized_alias,
  source,
  evidence
)
select
  c.id,
  case lower(s.name)
    when 'signatures' then 'SG-SAB'
    when 'throwback signatures' then 'TB-SAB'
  end,
  case lower(s.name)
    when 'signatures' then 'sgsab'
    when 'throwback signatures' then 'tbsab'
  end,
  'verified_physical_card_back_20260821',
  jsonb_build_object(
    'player', p.canonical_name,
    'release', r.product_name,
    'releaseYear', r.release_year,
    'setName', s.name,
    'canonicalChecklistNumber', c.card_number,
    'evidence', 'Multiple Deal Hunter card-back scans visibly print No. SG-SAB / No. TB-SAB while the active checklist stores numeric checklist positions.'
  )
from public.checklist_cards c
join public.checklist_sets s on s.id = c.set_id
join public.checklist_releases r on r.id = c.release_id
join public.checklist_versions v on v.id = c.version_id
join public.checklist_card_players cp on cp.card_id = c.id
join public.checklist_players p on p.id = cp.player_id
where v.is_active = true
  and v.status = 'live'
  and p.canonical_name = 'Sarah Ashlee Barker'
  and r.release_year = '2025'
  and lower(r.product_name) like '%prizm%wnba%'
  and (
    (lower(s.name) = 'signatures' and c.card_number = '15')
    or
    (lower(s.name) = 'throwback signatures' and c.card_number = '19')
  )
on conflict (card_id, normalized_alias) do update
set source = excluded.source,
    evidence = excluded.evidence;
