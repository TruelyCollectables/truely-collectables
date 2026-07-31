begin;

do $$
begin
  if to_regclass('public.collx_only_inventory_boundary_violations') is null then
    raise exception
      'Required storefront boundary view public.collx_only_inventory_boundary_violations is missing';
  end if;

  execute 'grant select on public.collx_only_inventory_boundary_violations to service_role';
end;
$$;

commit;
