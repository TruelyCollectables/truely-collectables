drop policy if exists inventory_items_app_select on public.inventory_items;
drop policy if exists inventory_items_app_insert on public.inventory_items;
drop policy if exists inventory_items_app_update on public.inventory_items;
drop policy if exists inventory_items_app_delete on public.inventory_items;

create policy inventory_items_app_select
  on public.inventory_items
  for select
  to anon, authenticated
  using (true);

create policy inventory_items_app_insert
  on public.inventory_items
  for insert
  to anon, authenticated
  with check (true);

create policy inventory_items_app_update
  on public.inventory_items
  for update
  to anon, authenticated
  using (true)
  with check (true);

create policy inventory_items_app_delete
  on public.inventory_items
  for delete
  to anon, authenticated
  using (true);

drop policy if exists inventory_images_app_select on public.inventory_images;
drop policy if exists inventory_images_app_insert on public.inventory_images;
drop policy if exists inventory_images_app_update on public.inventory_images;
drop policy if exists inventory_images_app_delete on public.inventory_images;

create policy inventory_images_app_select
  on public.inventory_images
  for select
  to anon, authenticated
  using (true);

create policy inventory_images_app_insert
  on public.inventory_images
  for insert
  to anon, authenticated
  with check (true);

create policy inventory_images_app_update
  on public.inventory_images
  for update
  to anon, authenticated
  using (true)
  with check (true);

create policy inventory_images_app_delete
  on public.inventory_images
  for delete
  to anon, authenticated
  using (true);

drop policy if exists inventory_attributes_app_select on public.inventory_attributes;
drop policy if exists inventory_attributes_app_insert on public.inventory_attributes;
drop policy if exists inventory_attributes_app_update on public.inventory_attributes;
drop policy if exists inventory_attributes_app_delete on public.inventory_attributes;

create policy inventory_attributes_app_select
  on public.inventory_attributes
  for select
  to anon, authenticated
  using (true);

create policy inventory_attributes_app_insert
  on public.inventory_attributes
  for insert
  to anon, authenticated
  with check (true);

create policy inventory_attributes_app_update
  on public.inventory_attributes
  for update
  to anon, authenticated
  using (true)
  with check (true);

create policy inventory_attributes_app_delete
  on public.inventory_attributes
  for delete
  to anon, authenticated
  using (true);
