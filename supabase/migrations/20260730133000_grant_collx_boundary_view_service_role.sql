-- Restore the least-privilege runtime read required by the server inventory engine.
-- The public storefront uses the service role to exclude CollX-only inventory before
-- returning products. The view remains unavailable to public, anon, and authenticated.

begin;

do $$
begin
  if to_regclass('public.collx_only_inventory_boundary_violations') is null then
    raise exception 'COLLX_BOUNDARY_VIEW_MISSING';
  end if;
end;
$$;

revoke all on table public.collx_only_inventory_boundary_violations
  from public, anon, authenticated;

grant select on table public.collx_only_inventory_boundary_violations
  to service_role;

commit;
