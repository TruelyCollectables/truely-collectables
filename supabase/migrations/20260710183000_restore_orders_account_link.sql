begin;

alter table public.orders
  add column if not exists account_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'orders_account_id_fkey'
       and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_account_id_fkey
      foreign key (account_id)
      references public.account_profiles(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists orders_store_account_created_at_idx
  on public.orders(store_id, account_id, created_at desc)
  where account_id is not null;

notify pgrst, 'reload schema';

commit;
