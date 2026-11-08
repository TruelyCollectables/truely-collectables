alter table if exists public.inventory_items
  add column if not exists metadata jsonb not null default '{}'::jsonb;
