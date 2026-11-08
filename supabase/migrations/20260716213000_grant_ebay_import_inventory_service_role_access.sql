grant usage on schema public to service_role;

grant select, insert, update, delete on table public.products
  to service_role;

grant select, insert, update, delete on table public.inventory_items
  to service_role;

grant select, insert, update, delete on table public.inventory_images
  to service_role;

grant select, insert, update, delete on table public.inventory_attributes
  to service_role;

do $$
begin
  if to_regclass('public.products_id_seq') is not null then
    grant usage, select, update on sequence public.products_id_seq
      to service_role;
  end if;
end $$;

drop policy if exists products_service_role_all on public.products;
create policy products_service_role_all
  on public.products
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists inventory_items_service_role_all on public.inventory_items;
create policy inventory_items_service_role_all
  on public.inventory_items
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists inventory_images_service_role_all on public.inventory_images;
create policy inventory_images_service_role_all
  on public.inventory_images
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists inventory_attributes_service_role_all on public.inventory_attributes;
create policy inventory_attributes_service_role_all
  on public.inventory_attributes
  for all
  to service_role
  using (true)
  with check (true);
