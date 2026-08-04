begin;

set local role postgres;

alter table public.tcos_kingmaker_private_pricing_work_orders
  drop constraint if exists tcos_km_work_order_sentinel_check;
alter table public.tcos_kingmaker_private_pricing_work_order_audit
  drop constraint if exists tcos_km_work_order_audit_sentinel_check;

alter table public.tcos_kingmaker_private_pricing_work_orders
  add constraint tcos_km_work_order_sentinel_check
  check (
    status <> 'blocked'
    or blocked_at is not null
    or notes = ''
  );

alter table public.tcos_kingmaker_private_pricing_work_order_audit
  add constraint tcos_km_work_order_audit_sentinel_check
  check (
    actor_type <> 'system'
    or action in ('auto_resolved','auto_reopened')
  );

\ir ../supabase/migrations/20260804071500_preserve_private_pricing_work_order_constraints.sql

DO $regression$
DECLARE
  work_status_definition text;
  audit_action_definition text;
  audit_status_definition text;
  audit_actor_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tcos_kingmaker_private_pricing_work_orders'::regclass
      AND conname = 'tcos_km_work_order_sentinel_check'
  ) THEN
    RAISE EXCEPTION 'Safe repair dropped an unrelated work-order check constraint.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tcos_kingmaker_private_pricing_work_order_audit'::regclass
      AND conname = 'tcos_km_work_order_audit_sentinel_check'
  ) THEN
    RAISE EXCEPTION 'Safe repair dropped an unrelated audit check constraint.';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO work_status_definition
  FROM pg_constraint
  WHERE conrelid = 'public.tcos_kingmaker_private_pricing_work_orders'::regclass
    AND conname = 'tcos_km_work_order_status_check';

  SELECT pg_get_constraintdef(oid) INTO audit_action_definition
  FROM pg_constraint
  WHERE conrelid = 'public.tcos_kingmaker_private_pricing_work_order_audit'::regclass
    AND conname = 'tcos_km_work_order_audit_action_check';

  SELECT pg_get_constraintdef(oid) INTO audit_status_definition
  FROM pg_constraint
  WHERE conrelid = 'public.tcos_kingmaker_private_pricing_work_order_audit'::regclass
    AND conname = 'tcos_km_work_order_audit_status_check';

  SELECT pg_get_constraintdef(oid) INTO audit_actor_definition
  FROM pg_constraint
  WHERE conrelid = 'public.tcos_kingmaker_private_pricing_work_order_audit'::regclass
    AND conname = 'tcos_km_work_order_audit_actor_check';

  IF work_status_definition IS NULL
     OR position('resolved' in lower(work_status_definition)) = 0 THEN
    RAISE EXCEPTION 'Pinned work-order status constraint is missing resolved.';
  END IF;

  IF audit_action_definition IS NULL
     OR position('auto_resolved' in lower(audit_action_definition)) = 0
     OR position('auto_reopened' in lower(audit_action_definition)) = 0 THEN
    RAISE EXCEPTION 'Pinned audit action constraint is incomplete.';
  END IF;

  IF audit_status_definition IS NULL
     OR position('resolved' in lower(audit_status_definition)) = 0 THEN
    RAISE EXCEPTION 'Pinned audit status constraint is incomplete.';
  END IF;

  IF audit_actor_definition IS NULL
     OR position('system' in lower(audit_actor_definition)) = 0 THEN
    RAISE EXCEPTION 'Pinned audit actor constraint is incomplete.';
  END IF;
END;
$regression$;

rollback;
