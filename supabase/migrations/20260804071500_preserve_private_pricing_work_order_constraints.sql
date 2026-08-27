-- Repair the merged work-order reconciliation constraint migration without
-- repeating its broad catalog scan. Only the four known lifecycle constraints
-- are replaced. Unrelated single-column or multi-column integrity constraints
-- must remain untouched.

begin;

alter table public.tcos_kingmaker_private_pricing_work_orders
  drop constraint if exists tcos_kingmaker_private_pricing_work_orders_status_check,
  drop constraint if exists tcos_km_work_order_status_check;

alter table public.tcos_kingmaker_private_pricing_work_order_audit
  drop constraint if exists tcos_kingmaker_private_pricing_work_order_audit_action_check,
  drop constraint if exists tcos_km_work_order_audit_action_check,
  drop constraint if exists tcos_kingmaker_private_pricing_work_order_audit_status_check,
  drop constraint if exists tcos_km_work_order_audit_status_check,
  drop constraint if exists tcos_kingmaker_private_pricing_work_order_audit_actor_type_check,
  drop constraint if exists tcos_km_work_order_audit_actor_check;

alter table public.tcos_kingmaker_private_pricing_work_orders
  add constraint tcos_km_work_order_status_check
  check (status in (
    'queued','in_progress','blocked','resolved','completed','dismissed'
  ));

alter table public.tcos_kingmaker_private_pricing_work_order_audit
  add constraint tcos_km_work_order_audit_action_check
  check (action in (
    'created','updated','auto_resolved','auto_reopened',
    'review_scheduled','review_cleared'
  )),
  add constraint tcos_km_work_order_audit_status_check
  check (status in (
    'queued','in_progress','blocked','resolved','completed','dismissed'
  )),
  add constraint tcos_km_work_order_audit_actor_check
  check (actor_type in ('admin','system'));

comment on constraint tcos_km_work_order_status_check
  on public.tcos_kingmaker_private_pricing_work_orders
  is 'Pinned KINGMAKER work-order lifecycle values. Replace by exact name only.';
comment on constraint tcos_km_work_order_audit_action_check
  on public.tcos_kingmaker_private_pricing_work_order_audit
  is 'Pinned KINGMAKER work-order audit actions, including private review scheduling. Replace by exact name only.';
comment on constraint tcos_km_work_order_audit_status_check
  on public.tcos_kingmaker_private_pricing_work_order_audit
  is 'Pinned KINGMAKER work-order audit lifecycle values. Replace by exact name only.';
comment on constraint tcos_km_work_order_audit_actor_check
  on public.tcos_kingmaker_private_pricing_work_order_audit
  is 'Pinned KINGMAKER work-order audit actor types. Replace by exact name only.';

commit;
