grant usage on schema public to service_role;

grant select, insert
  on table public.instacomp_scans
  to service_role;

grant select, insert, update
  on table public.instacomp_search_cache
  to service_role;

grant select, insert, update
  on table
    public.account_profiles,
    public.account_store_memberships,
    public.products,
    public.inventory_items,
    public.inventory_images
  to service_role;

grant insert
  on table public.account_auth_events
  to service_role;

grant usage, select
  on sequence public.products_id_seq
  to service_role;
