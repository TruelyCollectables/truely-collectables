-- Additive indexes for the bounded InstaComp Checklist Registry lookup path.
-- The hot path starts from normalized card number, then expands only the small
-- set of matching card IDs into identities/players/teams.
create index if not exists checklist_cards_instacomp_number_lookup_idx
  on public.checklist_cards (normalized_card_number, version_id, release_id);

create index if not exists checklist_card_identities_instacomp_card_idx
  on public.checklist_card_identities (card_id);

create index if not exists checklist_card_players_instacomp_card_idx
  on public.checklist_card_players (card_id, display_order);

create index if not exists checklist_card_teams_instacomp_card_idx
  on public.checklist_card_teams (card_id, display_order);

create index if not exists checklist_sets_instacomp_id_lookup_idx
  on public.checklist_sets (id, release_id, version_id);

analyze public.checklist_cards;
analyze public.checklist_card_identities;
analyze public.checklist_card_players;
analyze public.checklist_card_teams;
