begin;

alter table public.payment_simulation_runs
  drop constraint if exists payment_simulation_runs_mode_check;

alter table public.payment_simulation_runs
  add constraint payment_simulation_runs_mode_check
  check (run_mode in ('deterministic', 'stripe_test', 'checkout_e2e'));

alter table public.orders
  add column if not exists is_test boolean not null default false,
  add column if not exists test_run_id uuid
    references public.payment_simulation_runs(id) on delete set null;

alter table public.order_items
  add column if not exists is_test boolean not null default false,
  add column if not exists test_run_id uuid
    references public.payment_simulation_runs(id) on delete set null;

create index if not exists orders_store_test_run_idx
  on public.orders(store_id, test_run_id)
  where is_test = true;

create index if not exists order_items_store_test_run_idx
  on public.order_items(store_id, test_run_id)
  where is_test = true;

create or replace function public.tcos_cleanup_checkout_e2e(
  p_store_id uuid,
  p_test_run_id uuid,
  p_product_id bigint,
  p_checkout_attempt_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_ids bigint[];
  v_orders_deleted integer := 0;
  v_products_deleted integer := 0;
begin
  select coalesce(array_agg(id), '{}'::bigint[])
    into v_order_ids
    from public.orders
   where store_id = p_store_id
     and is_test = true
     and test_run_id = p_test_run_id;

  delete from public.order_review_case_packets
   where store_id = p_store_id
     and order_id = any(v_order_ids);

  delete from public.order_review_case_events
   where store_id = p_store_id
     and order_id = any(v_order_ids);

  delete from public.order_review_cases
   where store_id = p_store_id
     and order_id = any(v_order_ids);

  delete from public.financial_adjustment_ledger_entries
   where store_id = p_store_id
     and order_id = any(v_order_ids);

  delete from public.stripe_post_payment_objects
   where store_id = p_store_id
     and order_id = any(v_order_ids);

  delete from public.transaction_evidence_reports
   where store_id = p_store_id
     and order_id = any(v_order_ids);

  delete from public.orders
   where store_id = p_store_id
     and is_test = true
     and test_run_id = p_test_run_id;
  get diagnostics v_orders_deleted = row_count;

  delete from public.inventory_items
   where store_id = p_store_id
     and legacy_product_id = p_product_id;

  delete from public.products
   where store_id = p_store_id
     and id = p_product_id
     and ebay_item_id is null
     and title like '[TCOS TEST]%';
  get diagnostics v_products_deleted = row_count;

  delete from public.checkout_attempts
   where store_id = p_store_id
     and checkout_attempt_id = p_checkout_attempt_id;

  delete from public.tos_acceptance_events
   where store_id = p_store_id
     and context_type = 'checkout'
     and context_id = p_checkout_attempt_id;

  return jsonb_build_object(
    'orders_deleted', v_orders_deleted,
    'products_deleted', v_products_deleted
  );
end;
$$;

revoke all on function public.tcos_cleanup_checkout_e2e(uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.tcos_cleanup_checkout_e2e(uuid, uuid, bigint, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
