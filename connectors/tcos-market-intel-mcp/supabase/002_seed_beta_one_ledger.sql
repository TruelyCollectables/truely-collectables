-- RETIRED — DO NOT APPLY AS PORTFOLIO DATA.
--
-- The former 2026-07-23 Beta One snapshot contained 15 lots / 286 cards and is
-- no longer authoritative. It has intentionally been reduced to a no-op so a
-- connector deployment cannot overwrite current LedgerLock purchase, receipt,
-- inventory, or basis records.
--
-- Current portfolio state must be imported from the authoritative TCOS
-- Purchase Ledger through an explicit evidence-backed reconciliation process.
select 1 as retired_beta_one_seed;
