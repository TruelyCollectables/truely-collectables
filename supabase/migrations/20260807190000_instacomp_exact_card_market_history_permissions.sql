alter table public.tcos_card_market_identities enable row level security;
alter table public.tcos_card_market_observations enable row level security;

revoke all on public.tcos_card_market_identities from anon, authenticated;
revoke all on public.tcos_card_market_observations from anon, authenticated;

grant all on public.tcos_card_market_identities to service_role;
grant all on public.tcos_card_market_observations to service_role;

comment on table public.tcos_card_market_identities is
  'Canonical Checklist Registry identities with trusted longitudinal market history. Service-role only; anon/authenticated access revoked.';
comment on table public.tcos_card_market_observations is
  'Append-only exact-card asks, sold comps, purchases and owned sales. Service-role only; anon/authenticated access revoked.';
