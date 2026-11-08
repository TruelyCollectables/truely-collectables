begin;

do $$
begin
  if to_regclass('public.financial_adjustment_ledger_entries') is not null then
    alter table public.financial_adjustment_ledger_entries
      drop constraint if exists financial_adjustment_provider_check;

    alter table public.financial_adjustment_ledger_entries
      add constraint financial_adjustment_provider_check
      check (provider in ('stripe', 'tcos_internal'));

    alter table public.financial_adjustment_ledger_entries
      drop constraint if exists financial_adjustment_entry_type_check;

    alter table public.financial_adjustment_ledger_entries
      add constraint financial_adjustment_entry_type_check
      check (entry_type in (
        'customer_refund',
        'platform_fee_reversal',
        'seller_payable_reversal',
        'seller_recovery_required',
        'dispute_hold',
        'dispute_funds_withdrawn',
        'dispute_funds_reinstated',
        'chargeback_loss',
        'dispute_won',
        'seller_protection_reimbursement'
      ));
  end if;
end $$;

commit;
