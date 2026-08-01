begin;

grant usage on schema public to service_role;
grant select on table public.collx_only_inventory_boundary_violations to service_role;

notify pgrst, 'reload schema';

commit;
