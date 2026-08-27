-- TCOS Market Intel™ Beta One
-- Hotfix 002: grant private server-side access

grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.tcos_mi_subjects,
  public.tcos_mi_marketplaces,
  public.tcos_mi_collectible_identities,
  public.tcos_mi_watchlist,
  public.tcos_mi_listings,
  public.tcos_mi_sold_comps,
  public.tcos_mi_market_values,
  public.tcos_mi_deal_scores,
  public.tcos_mi_purchase_lots,
  public.tcos_mi_inventory_sales
to service_role;

grant select on public.tcos_mi_purchase_performance to service_role;

grant usage, select on sequence
  public.tcos_mi_purchase_lots_purchase_number_seq
to service_role;
