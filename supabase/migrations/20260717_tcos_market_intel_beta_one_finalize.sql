-- TCOS Market Intel™ Beta One
-- Final safeguards for purchase conversion, private reporting, and server access.

create unique index if not exists tcos_mi_purchase_lots_source_listing_unique
  on public.tcos_mi_purchase_lots(source_listing_id)
  where source_listing_id is not null;

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

-- These tables are created by the alerts/reports migration. Grant only when present.
do $$
begin
  if to_regclass('public.tcos_mi_alerts') is not null then
    execute 'grant select, insert, update, delete on table public.tcos_mi_alerts to service_role';
  end if;

  if to_regclass('public.tcos_mi_report_runs') is not null then
    execute 'grant select, insert, update, delete on table public.tcos_mi_report_runs to service_role';
  end if;
end
$$;
