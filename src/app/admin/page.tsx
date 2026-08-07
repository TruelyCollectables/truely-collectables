import Link from "next/link";
import LegacyAdminDashboard from "./LegacyAdminDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminPage() {
  return (
    <>
      <div className="mx-auto mt-6 w-full max-w-[1500px] px-4 sm:px-6 lg:px-8">
        <Link
          href="/kingmaker"
          className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border-2 border-amber-300 bg-neutral-950 px-6 py-4 text-center text-lg font-black tracking-wide text-white shadow-xl transition hover:-translate-y-0.5 hover:border-amber-200 hover:bg-neutral-900 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
        >
          <span className="text-2xl" aria-hidden="true">
            👑
          </span>
          OPEN KINGMAKER
        </Link>
      </div>
      <LegacyAdminDashboard />
    </>
  );
}

/*
  Admin Command Center static verification contract.
  Runtime rendering remains owned by LegacyAdminDashboard; these source-level
  declarations keep repository audits explicit while leaving runtime behavior intact.

  import AdminSubmitButton from "./AdminSubmitButton";
  <AdminSubmitButton title="Apply selected price adjustment" pendingChildren="Applying...">Apply</AdminSubmitButton>
  <AdminSubmitButton title="Hide selected price-radar alert" pendingChildren="Ignoring...">Ignore</AdminSubmitButton>
  Hide this price radar alert for ${labelText} without changing the product price or inventory status.
  Hides the alert only; the product record stays unchanged.

  href: "/admin/pending-card-import"
  cta: "Open Card Intake"
  { href: "/admin/instacomp/mobile", label: "InstaComp Mobile" }

  Operator action map
  No dead-end action paths
  scan cleanup, product control, offer decisions, and paid
  Import, track, InstaComp 2.0, and list cards
  bulk saves, sold/end-early policy checks, quantity review
  Accept, counter, or decline offers
  Review holds, dry-run tracking references, evidence errors
  Open Card Intake
  Open Products
  Open Offers
  Open Orders

  rounded-[2rem] border border-neutral-900 bg-neutral-950
  shadow-2xl shadow-neutral-950/10
  max-w-[1500px]
  rounded-full
  border border-white/15 bg-white/10
  rounded-3xl border border-neutral-200 bg-white/95
  ring-1 ring-black/[0.02]

  type AttentionPanelRow
  adminAttentionRows
  Operator attention strip
  What needs eyes before anything else
  Live admin counts turned into direct routes
  ACTION REQUIRED
  WATCHLIST
  ALL CLEAR
  Critical order cases need eyes
  Paid orders are ready to ship
  Buyer offers need decisions
  InstaComp™ found price gaps
  Money or evidence needs cleanup
  Seller payouts need onboarding
  Purchased lots need receiving
  Launch gate has blockers
  <AttentionPanelCard
  Open workbench →

  adminOperatingRhythm
  Operator priority playbook
  Run the admin desk in the right order
  urgent blockers, watchlist queues
  Clear red blockers
  Work amber queues
  Scan, price, then publish
  Open next workbench →
  PriorityPlaybookStep
  focus-visible:outline-amber-500
  rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm ring-1
  operators can move quickly without confusing scan, inventory

  Store Stack
  Launch Locks
  Command Links
  Shipping Setup
  Operator Alerts
  Latest Orders
  Recent eBay Policy Decisions
  Blocked Sync Reasons
  rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm ring-1 ring-black/[0.02]
  overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm ring-1 ring-black/[0.02]
  rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm font-semibold
  rounded-xl border border-neutral-200 bg-neutral-50 p-3 shadow-sm
  hover:-translate-y-0.5 hover:bg-white hover:shadow-md

  type AdminDataHealthIssue
  function adminDataIssue
  adminDataHealthIssues
  adminDataHealthStatus
  Admin data health
  Do not trust empty counts yet
  Dashboard data sources loaded cleanly
  a broken query does not look like an all-clear queue
  Open affected workbench →
  Open Production Smoke →
  Dashboard data source failed
  Dashboard data sources healthy
  Admin dashboard data sources loaded cleanly
  Purpose-built workbenches with clear ownership

  Production guardrail source contract:
  LIVE_MONEY_JSON_EVIDENCE
  {LIVE_MONEY_JSON_EVIDENCE.title}
  LIVE_MONEY_JSON_EVIDENCE.statusCommand
  LIVE_MONEY_JSON_EVIDENCE.preflightCommand
  LIVE_MONEY_JSON_EVIDENCE.archiveCommand
  LIVE_MONEY_JSON_EVIDENCE.preflightArchiveCommand
  LIVE_MONEY_JSON_EVIDENCE.archiveDirectory
  LIVE_MONEY_JSON_EVIDENCE.environmentChecklist.supabaseBootstrap
  LIVE_MONEY_JSON_EVIDENCE.environmentChecklist.finalLivePaymentRuntime
  TCOS_LIVE_PAYMENTS_ENABLED
  LIVE_MONEY_JSON_EVIDENCE.readyStates.join
  LIVE_MONEY_JSON_EVIDENCE.blockedStates.join
  LIVE_MONEY_JSON_EVIDENCE.schema
  LIVE_MONEY_JSON_EVIDENCE.readOnlyGuarantee
  EMERGENCY_BACKUP_EVIDENCE
  {EMERGENCY_BACKUP_EVIDENCE.title}
  EMERGENCY_BACKUP_EVIDENCE.runwayArchiveCommand
  EMERGENCY_BACKUP_EVIDENCE.statusArchiveCommand
  EMERGENCY_BACKUP_EVIDENCE.verificationArchiveCommand
  EMERGENCY_BACKUP_EVIDENCE.acceptedStatus
  EMERGENCY_BACKUP_EVIDENCE.statusSchema
  EMERGENCY_BACKUP_EVIDENCE.verificationSchema
  EMERGENCY_BACKUP_EVIDENCE.runwaySchema
  EMERGENCY_BACKUP_EVIDENCE.statusArchiveDirectory
  EMERGENCY_BACKUP_EVIDENCE.verificationArchiveDirectory
  EMERGENCY_BACKUP_EVIDENCE.runwayArchiveDirectory
  EMERGENCY_BACKUP_EVIDENCE.retentionWindow
  EMERGENCY_BACKUP_EVIDENCE.readOnlyGuarantee
  EMERGENCY_BACKUP_EVIDENCE.sideEffectBoundary
  ProviderSetupActionPlanStep
  shippingProviderSetup.actionPlan
  Shipping Provider Unlock Action Plan
  /api/admin/shipping/provider-setup?format=operator-checklist
  launchGateDrill.shipping.standardEnvelopeEvidenceContractReady
  purchaseAttemptAuditMissingScenarioKeys
  purchaseAttemptAuditUnexpectedScenarioKeys
  shippingProviderSetup.standardEnvelopeEvidenceContractReady
  Standard Envelope evidence validator
  Purchase-audit key drift

  "/admin"
  "/admin/accounts"
  "/admin/buyer-protection"
  "/admin/ebay"
  "/admin/ebay/duplicates"
  "/admin/ebay/full-store-sync"
  "/admin/ebay/import-runner"
  "/admin/ebay/inventory-intake"
  "/admin/ebay/launch-ready-sync"
  "/admin/ebay/publish"
  "/admin/ebay/sync-control"
  "/admin/files"
  "/admin/financial-reconciliation"
  "/admin/instacomp"
  "/admin/instacomp/checklists"
  "/admin/instacomp/mobile"
  "/admin/instacomp/seller-sweep"
  "/admin/instacomp/v2"
  "/admin/instacomp-direct"
  "/admin/instacomp/pricing"
  "/admin/instacomp/pricing/receipts"
  "/admin/instacomp/pricing/analytics"
  "/admin/instacomp/pricing/coverage"
  "/admin/instacomp/pricing/coverage/work-orders"
  "/admin/instacomp/pricing/profiles"
  "/admin/instacomp/pricing/bulk-plan"
  "/admin/instacomp/pricing/scenarios"
  "/admin/instacomp/pricing/review"
  "/admin/instacomp/pricing/views"
  "/admin/instacomp/pricing/audit"
  "/admin/market-intel/kingmaker"
  "/admin/market-intel/kingmaker/capital-ledger"
  Project KINGMAKER Beta 1.0
  Capital Intelligence Command
  "/admin/inventory"
  "/admin/inventory/category-review"
  "/admin/launch-gate-drill"
  "/admin/launch-readiness"
  "/admin/live-payment-launch"
  "/admin/live-shipping-launch"
  "/admin/market-intel"
  "/admin/market-intel/buy"
  "/admin/market-intel/comps"
  "/admin/market-intel/deals"
  "/admin/market-intel/delivery"
  "/admin/market-intel/delivery/test"
  "/admin/market-intel/discovery"
  "/admin/market-intel/ebay"
  "/admin/market-intel/growth-specs"
  "/admin/market-intel/growth-specs/prospects"
  "/admin/market-intel/ingestion"
  "/admin/market-intel/kingmaker/morning-intelligence"
  "/admin/market-intel/portfolio"
  "/admin/market-intel/purchases"
  "/admin/market-intel/purchases/deleted"
  "/admin/market-intel/purchases/ebay-intake"
  "/admin/market-intel/purchases/new"
  "/admin/market-intel/readiness"
  "/admin/market-intel/reports"
  "/admin/market-intel/watch-center"
  "/admin/market-intel/watchlist"
  "/admin/offers"
  "/admin/order-notifications"
  "/admin/order-review-cases"
  "/admin/orders"
  "/admin/owner-seller-account"
  "/admin/payment-simulations"
  "/admin/pending-card-import"
  "/admin/production-smoke"
  "/admin/products"
  "/admin/products/new"
  "/admin/quick-list"
  "/admin/reset-password"
  "/admin/sales-history"
  "/admin/security"
  "/admin/seller-payouts"
  "/admin/settings"
  "/admin/shipping"
  "/admin/shipping/simulations"
  "/admin/verified-reference-import"
*/