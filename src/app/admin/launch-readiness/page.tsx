import Link from "next/link";
import {
  SOFTWARE_OWNER_NAME,
  STORE_LEGAL_NAME,
} from "../../../lib/legal";
import {
  getStoreSettings,
  resolveStoreSettings,
  type StoreOperationalSettings,
} from "../../../lib/store-settings";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { getShippingProviderReadiness } from "../../../lib/shipping-provider-readiness";
import { SHIPPING_SIMULATION_SUITE_VERSION } from "../../../lib/shipping-simulations";
import {
  getStripeLivePublishableKey,
  getStripeLiveSecretKey,
  getStripeLiveWebhookSecret,
  getStripeTestSecretKey,
  getStripeTestWebhookSecret,
} from "../../../lib/stripe-credentials";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReadinessStatus = "ready" | "warning" | "blocked";

type ReadinessItem = {
  label: string;
  status: ReadinessStatus;
  detail: string;
  action: string;
};

type DatabaseCapability = {
  label: string;
  table: string;
  select: string;
  migration: string;
  readyDetail: string;
};

function isConfigured(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function statusClass(status: ReadinessStatus) {
  if (status === "ready") return "border-green-200 bg-green-50 text-green-800";
  if (status === "warning") return "border-yellow-200 bg-yellow-50 text-yellow-800";
  return "border-red-200 bg-red-50 text-red-800";
}

function statusLabel(status: ReadinessStatus) {
  if (status === "ready") return "Ready";
  if (status === "warning") return "Needs Review";
  return "Blocked";
}

function getPaymentMode() {
  if (process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true") {
    return getStripeLiveSecretKey() && getStripeLivePublishableKey()
      ? "live"
      : "missing";
  }
  return getStripeTestSecretKey() ? "test" : "missing";
}

function configuredHttpsSiteUrl(
  siteUrl: string | undefined,
  primaryDomain: string | null | undefined,
) {
  if (isConfigured(siteUrl) && siteUrl!.startsWith("https://")) {
    return siteUrl!;
  }

  const trimmedDomain = primaryDomain?.trim();

  if (!trimmedDomain) return null;

  if (trimmedDomain.startsWith("https://")) {
    return trimmedDomain;
  }

  if (trimmedDomain.startsWith("http://")) {
    return null;
  }

  return `https://${trimmedDomain}`;
}

function buildReadinessItems(
  storeSettings: StoreOperationalSettings,
): ReadinessItem[] {
  const shippingProviderReadiness = getShippingProviderReadiness();
  const siteUrl = configuredHttpsSiteUrl(
    process.env.NEXT_PUBLIC_SITE_URL,
    storeSettings.primaryDomain || process.env.VERCEL_PROJECT_PRODUCTION_URL,
  );
  const paymentMode = getPaymentMode();
  const liveCredentialsStaged = Boolean(
    getStripeLiveSecretKey() && getStripeLivePublishableKey(),
  );
  const operationalWebhookConfigured = Boolean(
    paymentMode === "live"
      ? getStripeLiveWebhookSecret()
      : getStripeTestWebhookSecret(),
  );
  const identityRequired = process.env.IP_INTELLIGENCE_REQUIRED === "true";
  const evidenceEmailConfigured = isConfigured(storeSettings.evidenceEmail || undefined);
  const resendConfigured = isConfigured(process.env.RESEND_API_KEY);
  const ebayCredentialsConfigured =
    isConfigured(process.env.EBAY_CLIENT_ID) &&
    isConfigured(process.env.EBAY_CLIENT_SECRET);
  const stripeFinancialEventsVerified =
    paymentMode === "live"
      ? process.env.STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED === "true"
      : process.env.STRIPE_FINANCIAL_EVENTS_VERIFIED === "true";

  return [
    {
      label: "Public Site URL",
      status: siteUrl ? "ready" : "blocked",
      detail: siteUrl
        ? `The active store resolves to ${siteUrl}.`
        : "Neither NEXT_PUBLIC_SITE_URL nor the active store primary domain resolves to an HTTPS production URL.",
      action:
        "Set NEXT_PUBLIC_SITE_URL or the store primary domain to the final HTTPS production domain before accepting live payment.",
    },
    {
      label: "Supabase",
      status:
        isConfigured(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
        isConfigured(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
          ? "ready"
          : "blocked",
      detail: "Checkout, orders, offers, inventory, TOS, and evidence storage require Supabase.",
      action: "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    },
    {
      label: "Supabase Service Role",
      status: isConfigured(process.env.SUPABASE_SERVICE_ROLE_KEY)
        ? "ready"
        : "warning",
      detail: isConfigured(process.env.SUPABASE_SERVICE_ROLE_KEY)
        ? "SUPABASE_SERVICE_ROLE_KEY is configured for admin-only writes and webhook operations."
        : "Admin-only writes and webhook operations currently fall back to the public anon key.",
      action:
        "Set SUPABASE_SERVICE_ROLE_KEY before launch so admin settings, launch checks, and payment webhooks do not depend on public-key table permissions.",
    },
    {
      label: "Admin Access",
      status: isConfigured(process.env.ADMIN_PASSWORD)
        ? isConfigured(process.env.ADMIN_SESSION_SECRET)
          ? "ready"
          : "warning"
        : "blocked",
      detail: isConfigured(process.env.ADMIN_SESSION_SECRET)
        ? "Admin password and signed session secret are configured."
        : "Admin sessions fall back to ADMIN_PASSWORD when ADMIN_SESSION_SECRET is missing.",
      action: "Set ADMIN_PASSWORD and a separate strong ADMIN_SESSION_SECRET before launch.",
    },
    {
      label: "Stripe Key Mode",
      status:
        paymentMode === "live"
          ? "ready"
          : paymentMode === "test"
          ? "warning"
          : "blocked",
      detail:
        paymentMode === "live"
          ? "The operational Stripe mode is live with a matching staged live key pair."
          : paymentMode === "test"
          ? liveCredentialsStaged
            ? "Stripe test mode remains operational while the live key pair is staged separately."
            : "Stripe test mode is operational; the separate live key pair is not staged yet."
          : "The selected Stripe credential mode is missing.",
      action:
        "Stage STRIPE_LIVE_SECRET_KEY and NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY; do not replace the working test credentials.",
    },
    {
      label: "Stripe Webhook",
      status: operationalWebhookConfigured ? "ready" : "blocked",
      detail: operationalWebhookConfigured
        ? `The ${paymentMode} webhook signing secret is configured.`
        : `The ${paymentMode} webhook signing secret is missing.`,
      action:
        "Keep the test signing secret and save the live endpoint secret separately as STRIPE_LIVE_WEBHOOK_SECRET.",
    },
    {
      label: "Stripe Refund And Dispute Events",
      status: stripeFinancialEventsVerified ? "ready" : "warning",
      detail: stripeFinancialEventsVerified
        ? "The production Stripe endpoint is operator-verified for refund and dispute lifecycle events."
        : "TCOS cannot confirm from local configuration that Stripe is sending refund.created, refund.updated, refund.failed, and charge.dispute lifecycle events.",
      action:
        "Enable the required refund and charge.dispute events for /api/webhook in Stripe Workbench, test them, then set STRIPE_FINANCIAL_EVENTS_VERIFIED=true.",
    },
    {
      label: "Identity And VPN Blocking",
      status:
        identityRequired && isConfigured(process.env.IP_INTELLIGENCE_API_URL)
          ? "ready"
          : identityRequired
          ? "blocked"
          : "warning",
      detail:
        identityRequired && isConfigured(process.env.IP_INTELLIGENCE_API_URL)
          ? "IP intelligence is required and configured."
          : identityRequired
          ? "IP_INTELLIGENCE_REQUIRED is true, but IP_INTELLIGENCE_API_URL is missing."
          : "IP intelligence is not required.",
      action:
        "For launch, keep IP_INTELLIGENCE_REQUIRED=true and configure the provider URL/API key.",
    },
    {
      label: "Transaction Evidence Email",
      status:
        resendConfigured && evidenceEmailConfigured
          ? "ready"
          : "warning",
      detail: evidenceEmailConfigured
        ? `Evidence packet delivery resolves to ${storeSettings.evidenceEmail}. PDFs are still saved in admin files even if email delivery is unavailable.`
        : "No resolved evidence delivery email is configured for the active store. PDFs are still saved in admin files even if email delivery is unavailable.",
      action:
        "Set RESEND_API_KEY plus a store evidence email in store settings or TRANSACTION_EVIDENCE_EMAIL, and optionally configure the evidence/order from addresses.",
    },
    {
      label: "eBay Sync",
      status:
        !storeSettings.ebaySyncEnabled
          ? "warning"
          : ebayCredentialsConfigured &&
            storeSettings.ebayEnvironment === "production"
          ? "ready"
          : "warning",
      detail:
        !storeSettings.ebaySyncEnabled
          ? "The active store has eBay sync disabled in store settings."
          : storeSettings.ebayEnvironment === "production"
          ? "The active store resolves to eBay production mode."
          : `The active store resolves to eBay environment ${storeSettings.ebayEnvironment}.`,
      action:
        "Enable eBay sync for the active store and confirm EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and store-level production eBay environment before live inventory sync.",
    },
    ...shippingProviderReadiness.map((item) => ({
      label: item.label,
      status: item.status,
      detail: item.detail,
      action: item.action,
    })),
    {
      label: "Shipping Simulation Lab",
      status: "ready" as const,
      detail: `Shipping simulation suite ${SHIPPING_SIMULATION_SUITE_VERSION} is available for Standard Envelope routing, Ground Advantage fallback, seller coverage, adapter-profile, and dry-run provider purchase assertions.`,
      action:
        "Run /admin/shipping/simulations before enabling any live shipping provider purchase workflow.",
    },
    {
      label: "AI Product Helpers",
      status: isConfigured(process.env.OPENAI_API_KEY) ? "ready" : "warning",
      detail: isConfigured(process.env.OPENAI_API_KEY)
        ? "AI description helpers can run."
        : "AI description helpers will be unavailable without OPENAI_API_KEY.",
      action: "Set OPENAI_API_KEY when AI generated product descriptions are needed.",
    },
    {
      label: "Platform And Storefront Separation",
      status: "warning",
      detail:
        `The manual defines ${SOFTWARE_OWNER_NAME} as platform owner/admin, ${STORE_LEGAL_NAME} as the collectables storefront account, and Dag Danky Shoes as the footwear storefront account.`,
      action:
        "Before seller accounts, footwear operations, or third-party sellers go live, build separate logins, roles, audit trails, payout profiles, and seller/buyer account records.",
    },
  ];
}

function summarize(items: ReadinessItem[]) {
  return {
    ready: items.filter((item) => item.status === "ready").length,
    warning: items.filter((item) => item.status === "warning").length,
    blocked: items.filter((item) => item.status === "blocked").length,
  };
}

function getSupabaseClient() {
  try {
    return createSupabaseServerClient({ admin: true });
  } catch {
    return null;
  }
}

async function checkDatabaseCapability(
  capability: DatabaseCapability,
): Promise<ReadinessItem> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      label: capability.label,
      status: "blocked",
      detail: "Supabase is not configured, so this database capability cannot be checked.",
      action: "Set Supabase environment variables before checking database readiness.",
    };
  }

  const { error } = await supabase
    .from(capability.table)
    .select(capability.select)
    .limit(1);

  if (!error) {
    return {
      label: capability.label,
      status: "ready",
      detail: capability.readyDetail,
      action: "No action needed for this database capability.",
    };
  }

  return {
    label: capability.label,
    status: "blocked",
    detail: `${capability.label} is unavailable: ${error.message}`,
    action: `Apply supabase/migrations/${capability.migration} before relying on this feature.`,
  };
}

async function checkDatabaseReadiness(): Promise<ReadinessItem[]> {
  const capabilities: DatabaseCapability[] = [
    {
      label: "Stores Platform Layer",
      table: "stores",
      select: "id,slug,display_name,legal_name,store_type,status,platform_owner,primary_domain",
      migration: "20260628110000_create_tcos_stores.sql",
      readyDetail: "stores is available for Store #1 and future storefront separation.",
    },
    {
      label: "Store Settings",
      table: "store_settings",
      select:
        "store_id,support_email,sales_email,offers_email,evidence_email,stripe_mode,ebay_environment,seller_commission_rate,metadata",
      migration: "20260628113000_create_store_settings.sql",
      readyDetail: "store_settings is available for per-store operations.",
    },
    {
      label: "Inventory V2 Tables",
      table: "inventory_items",
      select: "id,store_id,legacy_product_id,sku,title,status,quantity,price",
      migration: "20260628114000_create_inventory_tables.sql",
      readyDetail: "inventory_items is available for the Universal Inventory Engine.",
    },
    {
      label: "eBay Sync Decisions",
      table: "ebay_sync_decision_events",
      select:
        "id,store_id,run_id,action,decision,reason,sku,ebay_item_id,created_at",
      migration: "20260630123000_create_ebay_sync_decision_events.sql",
      readyDetail:
        "ebay_sync_decision_events is available for TCOS policy decisions and sync-control summaries.",
    },
    {
      label: "Sales Comp Snapshots",
      table: "sales_comp_snapshots",
      select: "id,store_id,legacy_product_id,query,suggested_price,comps,created_at",
      migration: "20260627160000_create_sales_comp_snapshots.sql",
      readyDetail: "sales_comp_snapshots is available for pricing evidence.",
    },
    {
      label: "TOS Identity Evidence",
      table: "tos_acceptance_events",
      select: "id,store_id,context_type,tos_kind,tos_version,ip_address,ip_risk,created_at",
      migration: "20260627173000_add_tos_identity_evidence.sql",
      readyDetail: "tos_acceptance_events is available for TOS/IP audit evidence.",
    },
    {
      label: "Transaction Evidence Reports",
      table: "transaction_evidence_reports",
      select: "id,store_id,order_id,stripe_session_id,status,report_json,created_at",
      migration: "20260627180000_create_transaction_evidence_reports.sql",
      readyDetail: "transaction_evidence_reports is available for chargeback evidence PDFs.",
    },
    {
      label: "Stripe Webhook Event Journal",
      table: "stripe_webhook_events",
      select:
        "id,store_id,stripe_event_id,event_type,event_status,attempt_count,last_error,processed_at",
      migration: "20260710103000_create_stripe_webhook_events.sql",
      readyDetail:
        "stripe_webhook_events is available for signed receipt auditing, duplicate suppression, and retry-safe failures.",
    },
    {
      label: "Checkout Attempt Journal",
      table: "checkout_attempts",
      select:
        "id,store_id,checkout_attempt_id,request_fingerprint,stripe_idempotency_key,request_status,attempt_count,stripe_session_id,last_error",
      migration: "20260710113000_create_checkout_attempts.sql",
      readyDetail:
        "checkout_attempts is available for duplicate Checkout Session prevention and ambiguous-network retry recovery.",
    },
    {
      label: "Stripe Post-Payment Objects",
      table: "stripe_post_payment_objects",
      select:
        "id,store_id,object_type,provider_object_id,order_id,current_status,amount,currency,last_provider_event_id",
      migration: "20260710130000_create_stripe_financial_adjustments.sql",
      readyDetail:
        "stripe_post_payment_objects is available for refund and dispute lifecycle tracking without storing raw Stripe payloads.",
    },
    {
      label: "Immutable Financial Adjustments",
      table: "financial_adjustment_ledger_entries",
      select:
        "id,store_id,order_id,seller_account_id,provider_event_id,provider_object_id,economic_key,entry_type,ledger_account,balance_effect,amount,currency",
      migration: "20260710130000_create_stripe_financial_adjustments.sql",
      readyDetail:
        "financial_adjustment_ledger_entries is available for append-only refunds, 8% reversals, payout reversals, dispute holds, chargeback losses, and recovery requirements.",
    },
    {
      label: "Stripe Reconciliation Runs",
      table: "stripe_reconciliation_runs",
      select:
        "id,store_id,source,run_status,window_start,window_end,stripe_transaction_count,matched_count,unmatched_count,net_difference",
      migration: "20260710143000_create_stripe_reconciliation.sql",
      readyDetail:
        "stripe_reconciliation_runs is available for daily Stripe-versus-TCOS closeout totals and retry-safe run history.",
    },
    {
      label: "Unmatched Money Queue",
      table: "stripe_reconciliation_items",
      select:
        "id,run_id,store_id,item_status,severity,mismatch_type,transaction_category,stripe_source_id,internal_record_type,internal_record_id,difference_amount,resolution_note",
      migration: "20260710143000_create_stripe_reconciliation.sql",
      readyDetail:
        "stripe_reconciliation_items is available for operator-reviewed unmatched money alerts with mandatory resolution notes.",
    },
    {
      label: "Payment Simulation Runs",
      table: "payment_simulation_runs",
      select:
        "id,store_id,run_mode,run_status,suite_version,scenario_count,passed_count,failed_count,skipped_count,last_error,started_at,completed_at",
      migration: "20260710170000_create_payment_simulation_runs.sql",
      readyDetail:
        "payment_simulation_runs is available for auditable no-money and Stripe-test payment regression runs.",
    },
    {
      label: "Payment Simulation Scenarios",
      table: "payment_simulation_scenarios",
      select:
        "id,run_id,store_id,scenario_key,scenario_status,detail,assertions,provider_object_ids,created_at",
      migration: "20260710170000_create_payment_simulation_runs.sql",
      readyDetail:
        "payment_simulation_scenarios is available for scenario-level charge, decline, duplicate, refund, dispute, payout, and reconciliation assertions.",
    },
    {
      label: "Checkout E2E Isolation",
      table: "orders",
      select:
        "id,store_id,is_test,test_run_id,stripe_session_id,stripe_payment_intent_id,stripe_charge_id,payment_status,refund_status,amount_refunded",
      migration: "20260710180000_create_checkout_e2e_isolation.sql",
      readyDetail:
        "orders supports run-scoped test tagging so the disposable checkout-to-refund drill stays outside daily reconciliation and production financial totals.",
    },
    {
      label: "Shipping Label Records",
      table: "order_shipping_labels",
      select:
        "id,store_id,order_id,provider,provider_service,service_level,carrier,tracking_number,label_status,coverage_provider,coverage_status,coverage_amount,created_at",
      migration: "20260710190000_create_shipping_label_infrastructure.sql",
      readyDetail:
        "order_shipping_labels is available for planned/purchased labels, postage, tracking, and seller coverage audit records.",
    },
    {
      label: "Shipping Tracking Events",
      table: "order_shipping_tracking_events",
      select:
        "id,store_id,order_id,shipping_label_id,provider,carrier,tracking_number,event_type,event_status,occurred_at",
      migration: "20260710190000_create_shipping_label_infrastructure.sql",
      readyDetail:
        "order_shipping_tracking_events is available for manual and provider-fed shipment scan history.",
    },
    {
      label: "Shipping Coverage Claims",
      table: "order_shipping_coverage_claims",
      select:
        "id,store_id,order_id,shipping_label_id,provider,provider_claim_id,claim_status,claim_type,claim_amount,created_at",
      migration: "20260710190000_create_shipping_label_infrastructure.sql",
      readyDetail:
        "order_shipping_coverage_claims is available for seller protection loss/damage claim tracking.",
    },
    {
      label: "Seller Payout Accounts",
      table: "seller_payout_accounts",
      select:
        "id,account_id,store_id,provider,provider_account_id,onboarding_status,payouts_enabled,details_submitted",
      migration: "20260630103000_create_seller_payout_accounts.sql",
      readyDetail:
        "seller_payout_accounts is available for Stripe-hosted seller onboarding and payout eligibility.",
    },
    {
      label: "Seller Payable Ledger",
      table: "seller_payout_ledger_entries",
      select:
        "id,store_id,seller_account_id,order_id,order_item_id,source_type,platform_fee_amount,seller_payable_amount,payout_status",
      migration: "20260701210000_create_seller_payout_ledger.sql",
      readyDetail:
        "seller_payout_ledger_entries is available for 8% calculation, seller payable balances, and payout holds.",
    },
    {
      label: "Platform Fee Ledger",
      table: "platform_fee_ledger_entries",
      select:
        "id,store_id,order_id,order_item_id,source_type,platform_fee_rate,platform_fee_amount,fee_status",
      migration: "20260701211500_create_platform_fee_ledger.sql",
      readyDetail:
        "platform_fee_ledger_entries is available for Dag Danky Holdings LLC's 8% TCOS checkout fee audit trail.",
    },
    {
      label: "Seller Payout Requests",
      table: "seller_payout_requests",
      select:
        "id,store_id,seller_account_id,provider,requested_amount,status,final_processor_fee_amount,final_net_amount,provider_payout_reference",
      migration: "20260701213000_create_seller_payout_requests.sql",
      readyDetail:
        "seller_payout_requests is available for seller cash-out review, processor fees, final net amounts, and provider references.",
    },
    {
      label: "Admin Login Audit",
      table: "admin_login_attempts",
      select: "id,store_id,ip_address,success,failure_reason,lockout_until,created_at",
      migration: "20260628180000_create_admin_login_attempts.sql",
      readyDetail: "admin_login_attempts is available for admin audit and lockout storage.",
    },
    {
      label: "Public Endpoint Rate Limits",
      table: "public_endpoint_rate_limit_events",
      select:
        "id,store_id,endpoint_key,subject_key,ip_address,blocked,block_reason,created_at",
      migration: "20260630113000_create_public_endpoint_rate_limit_events.sql",
      readyDetail:
        "public_endpoint_rate_limit_events is available for checkout, offer, binding-offer, and seller-onboarding throttling.",
    },
    {
      label: "Security IP Investigations",
      table: "security_ip_investigations",
      select:
        "id,store_id,ip_address,status,severity,notes,updated_at,last_reviewed_at,resolved_at",
      migration: "20260630120000_create_security_ip_investigations.sql",
      readyDetail:
        "security_ip_investigations is available for watched IP cases, review status, severity, and internal notes.",
    },
    {
      label: "Order Review Cases",
      table: "order_review_cases",
      select:
        "id,store_id,order_id,seller_account_id,case_type,status,severity,title,opened_at,updated_at",
      migration: "20260701215000_create_order_review_cases.sql",
      readyDetail:
        "order_review_cases is available for chargebacks, returns, authenticity issues, shipping disputes, and seller payout holds.",
    },
    {
      label: "Order Review Case Events",
      table: "order_review_case_events",
      select:
        "id,store_id,case_id,order_id,event_type,previous_status,new_status,ip_address,created_at",
      migration: "20260701215000_create_order_review_cases.sql",
      readyDetail:
        "order_review_case_events is available for append-only case audit history and IP evidence.",
    },
    {
      label: "Order Review Case Packets",
      table: "order_review_case_packets",
      select:
        "id,store_id,case_id,order_id,status,provider_dispute_id,provider_evidence_status,provider_evidence_file_id,provider_evidence_due_by,provider_evidence_staged_at,provider_evidence_submitted_at,provider_evidence_error,created_at,updated_at",
      migration: "20260710160000_create_dispute_evidence_workflow.sql",
      readyDetail:
        "order_review_case_packets is available for automatic dispute packets, editable Stripe evidence staging, explicit final submission, and Admin Files audit history.",
    },
    {
      label: "Customer Account Profiles",
      table: "account_profiles",
      select: "id,email,display_name,account_status,default_account_type,tos_accepted,created_at",
      migration: "20260628190000_create_tcos_accounts.sql",
      readyDetail: "account_profiles is available for customer accounts.",
    },
    {
      label: "Account Billing Evidence",
      table: "account_profiles",
      select:
        "id,card_verified,card_verified_at,billing_line1,billing_city,billing_state,billing_country,billing_postal_code,card_verification_failure_reason,card_verification_checked_at",
      migration: "20260701074500_add_account_billing_address_evidence.sql",
      readyDetail:
        "account_profiles can store Stripe-safe US billing evidence and card-verification failure reasons.",
    },
    {
      label: "Account Store Memberships",
      table: "account_store_memberships",
      select: "id,account_id,store_id,role,status,created_at",
      migration: "20260628190000_create_tcos_accounts.sql",
      readyDetail: "account_store_memberships is available for buyer/seller/store role separation.",
    },
    {
      label: "Account Auth Lockouts",
      table: "account_auth_events",
      select: "id,account_id,store_id,email,event_type,success,failure_reason,lockout_until,created_at",
      migration: "20260628201500_add_account_auth_lockouts.sql",
      readyDetail: "account_auth_events supports failure reasons and customer auth lockouts.",
    },
    {
      label: "Order Account Links",
      table: "orders",
      select: "id,store_id,account_id,customer_email,total,status,created_at",
      migration: "20260628193000_link_accounts_to_orders_offers.sql",
      readyDetail: "orders has account_id for linked customer order history.",
    },
    {
      label: "Offer Account Links",
      table: "offers",
      select: "id,store_id,account_id,customer_email,offer_amount,status,created_at",
      migration: "20260628193000_link_accounts_to_orders_offers.sql",
      readyDetail: "offers has account_id for linked customer offer history.",
    },
    {
      label: "Sports Favorites",
      table: "account_sports_favorites",
      select:
        "id,account_id,store_id,sport_key,league_key,team_name,include_news,include_scores,include_schedule,include_odds",
      migration: "20260628213000_create_sports_dashboard_tables.sql",
      readyDetail: "account_sports_favorites is available for team dashboard preferences.",
    },
    {
      label: "Sports Data Snapshots",
      table: "sports_event_snapshots",
      select: "id,store_id,sport_key,league_key,external_event_id,event_status,event_start_at",
      migration: "20260628213000_create_sports_dashboard_tables.sql",
      readyDetail: "sports_event_snapshots is available for scores and schedules.",
    },
    {
      label: "Sports Odds Snapshots",
      table: "sports_odds_snapshots",
      select: "id,store_id,sport_key,league_key,source_key,bookmaker,market_type,fetched_at",
      migration: "20260628213000_create_sports_dashboard_tables.sql",
      readyDetail: "sports_odds_snapshots is available for provider-backed odds display.",
    },
    {
      label: "Market Watchlists",
      table: "account_market_watchlist_items",
      select: "id,account_id,store_id,asset_type,symbol,display_name,include_price,include_news",
      migration: "20260628213000_create_sports_dashboard_tables.sql",
      readyDetail: "account_market_watchlist_items is available for stocks, crypto, NFTs, and other assets.",
    },
    {
      label: "Market Price Snapshots",
      table: "market_price_snapshots",
      select: "id,store_id,asset_type,symbol,price,currency,fetched_at",
      migration: "20260628213000_create_sports_dashboard_tables.sql",
      readyDetail: "market_price_snapshots is available for provider-backed market pricing.",
    },
    {
      label: "Collection Shelf",
      table: "account_collection_items",
      select:
        "id,account_id,store_id,title,category,estimated_value,grade_company,grade_value,ownership_status,visibility,is_active",
      migration: "20260628220000_create_collector_dashboard_tables.sql",
      readyDetail: "account_collection_items is available for owned collection tracking.",
    },
    {
      label: "The Shelf And Want Ads",
      table: "account_wish_list_items",
      select:
        "id,account_id,store_id,wish_type,title,priority,status,visibility,expires_at,auto_renew",
      migration: "20260628220000_create_collector_dashboard_tables.sql",
      readyDetail: "account_wish_list_items is available for The Shelf, want ads, set needs, and trade targets.",
    },
    {
      label: "The Shelf Matches",
      table: "account_wish_list_matches",
      select: "id,wish_list_item_id,account_id,store_id,match_source,match_score,status",
      migration: "20260628220000_create_collector_dashboard_tables.sql",
      readyDetail: "account_wish_list_matches is available for future inventory matching and alerts.",
    },
    {
      label: "Collector Profiles",
      table: "account_collector_profiles",
      select:
        "id,account_id,store_id,collector_handle,bio,visibility,allow_messages,updated_at",
      migration: "20260628223000_create_collector_profiles_messaging_exports.sql",
      readyDetail: "account_collector_profiles is available for collector bios and social links.",
    },
    {
      label: "Collector Conversations",
      table: "account_conversations",
      select:
        "id,store_id,created_by_account_id,recipient_account_id,subject,status,last_message_at",
      migration: "20260628223000_create_collector_profiles_messaging_exports.sql",
      readyDetail: "account_conversations is available for collector messaging.",
    },
    {
      label: "Binding Offers",
      table: "account_binding_offers",
      select:
        "id,store_id,buyer_account_id,seller_account_id,offer_amount,total_amount,status,payment_requirement",
      migration: "20260628223000_create_collector_profiles_messaging_exports.sql",
      readyDetail: "account_binding_offers is available for card-required binding offer records.",
    },
    {
      label: "Collection Export Jobs",
      table: "account_collection_export_jobs",
      select: "id,account_id,store_id,export_type,status,file_name,item_count,created_at",
      migration: "20260628223000_create_collector_profiles_messaging_exports.sql",
      readyDetail: "account_collection_export_jobs is available for CSV and catalog export audit logs.",
    },
  ];

  return Promise.all(capabilities.map(checkDatabaseCapability));
}

async function loadStoreSettings(): Promise<StoreOperationalSettings> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return resolveStoreSettings({ source: "fallback" });
  }

  return getStoreSettings(supabase, getActiveStoreId());
}

export default async function LaunchReadinessPage() {
  const [storeSettings, databaseItems] = await Promise.all([
    loadStoreSettings(),
    checkDatabaseReadiness(),
  ]);
  const baseItems = buildReadinessItems(storeSettings);
  const items = [...baseItems, ...databaseItems];
  const summary = summarize(items);
  const databaseSummary = summarize(databaseItems);
  const paymentMode = getPaymentMode();
  const canAcceptLivePayment = paymentMode === "live" && summary.blocked === 0;

  return (
    <main className="min-h-screen bg-neutral-50 p-8 text-neutral-950">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold">Launch Readiness</h1>
          <p className="mt-2 max-w-3xl text-neutral-600">
            Production checklist for live buyer payments, order capture,
            transaction evidence, eBay inventory sync, and admin security.
          </p>
        </div>

        <div className="flex gap-3">
          <Link href="/admin" className="rounded border bg-white px-4 py-2">
            Dashboard
          </Link>
          <Link href="/admin/orders" className="rounded border bg-white px-4 py-2">
            Orders
          </Link>
          <Link href="/admin/files" className="rounded border bg-white px-4 py-2">
            Files
          </Link>
          <Link href="/admin/security" className="rounded border bg-white px-4 py-2">
            Security
          </Link>
          <Link href="/admin/live-payment-launch" className="rounded border bg-white px-4 py-2">
            Live Payment Gate
          </Link>
          <Link href="/admin/shipping/simulations" className="rounded border bg-white px-4 py-2">
            Shipping Simulations
          </Link>
          <a href="#database-readiness" className="rounded border bg-white px-4 py-2">
            Database
          </a>
        </div>
      </div>

      <section className="mb-8 rounded border bg-white p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <SummaryCard label="Ready" value={summary.ready} tone="green" />
          <SummaryCard label="Needs Review" value={summary.warning} tone="yellow" />
          <SummaryCard label="Blocked" value={summary.blocked} tone="red" />
          <SummaryCard
            label="Payment Mode"
            value={paymentMode.toUpperCase()}
            tone={paymentMode === "live" ? "green" : paymentMode === "test" ? "yellow" : "red"}
          />
        </div>

        <div
          className={`mt-6 rounded border p-4 ${
            canAcceptLivePayment
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <p className="font-bold">
            {canAcceptLivePayment
              ? "Live buyer payments are configuration-ready."
              : "Do not open live buyer payments yet."}
          </p>
          <p className="mt-1 text-sm">
            Before launch, run a real low-dollar purchase, confirm the order,
            confirm the evidence PDF, confirm eBay quantity sync, then refund
            that transaction in Stripe.
          </p>
        </div>
      </section>

      <section
        id="database-readiness"
        className="mb-8 rounded border bg-white p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">Database Readiness</h2>
            <p className="mt-1 max-w-3xl text-sm text-neutral-600">
              Live Supabase capability checks for TCOS tables and columns. If a
              row is blocked, the feature may compile but fail at runtime until
              its migration is applied.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <MiniCount label="Ready" value={databaseSummary.ready} tone="green" />
            <MiniCount label="Review" value={databaseSummary.warning} tone="yellow" />
            <MiniCount label="Blocked" value={databaseSummary.blocked} tone="red" />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {databaseItems.map((item) => (
            <section
              key={item.label}
              className="rounded border border-neutral-200 bg-neutral-50 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold">{item.label}</h3>
                  <p className="mt-1 text-sm text-neutral-600">{item.detail}</p>
                </div>
                <span
                  className={`shrink-0 rounded border px-2 py-1 text-xs font-bold ${statusClass(
                    item.status,
                  )}`}
                >
                  {statusLabel(item.status)}
                </span>
              </div>
              {item.status !== "ready" ? (
                <p className="mt-3 text-sm font-semibold text-neutral-700">
                  {item.action}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      </section>

      <section className="mb-8 rounded border bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">Active Store</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Store settings currently resolved for this TCOS admin session.
            </p>
          </div>
          <span
            className={`rounded border px-3 py-1 text-sm font-bold ${
              storeSettings.source === "database"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-yellow-200 bg-yellow-50 text-yellow-800"
            }`}
          >
            {storeSettings.source === "database" ? "Database Settings" : "Fallback Settings"}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <StoreSetting label="Store" value={storeSettings.displayName} />
          <StoreSetting label="Legal Name" value={storeSettings.legalName || "Not set"} />
          <StoreSetting label="Status" value={storeSettings.status} />
          <StoreSetting label="Slug" value={storeSettings.slug} />
          <StoreSetting label="Primary Domain" value={storeSettings.primaryDomain || "Not set"} />
          <StoreSetting label="Support Email" value={storeSettings.supportEmail} />
          <StoreSetting label="Sales Email" value={storeSettings.salesEmail} />
          <StoreSetting label="Offers Email" value={storeSettings.offersEmail} />
          <StoreSetting
            label="Evidence Email"
            value={storeSettings.evidenceEmail || "Uses env / not configured"}
          />
          <StoreSetting label="Stripe Mode" value={storeSettings.stripeMode} />
          <StoreSetting label="eBay Environment" value={storeSettings.ebayEnvironment} />
          <StoreSetting
            label="Seller Commission"
            value={`${(storeSettings.sellerCommissionRate * 100).toFixed(2)}%`}
          />
        </div>
      </section>

      <div className="space-y-4">
        {items.map((item) => (
          <section key={item.label} className="rounded border bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{item.label}</h2>
                <p className="mt-1 text-sm text-neutral-600">{item.detail}</p>
              </div>
              <span
                className={`rounded border px-3 py-1 text-sm font-bold ${statusClass(
                  item.status,
                )}`}
              >
                {statusLabel(item.status)}
              </span>
            </div>
            <p className="mt-4 text-sm text-neutral-700">{item.action}</p>
          </section>
        ))}
      </div>
    </main>
  );
}

function StoreSetting({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-neutral-50 p-4">
      <p className="text-sm font-medium text-neutral-500">{label}</p>
      <p className="mt-2 break-words text-lg font-bold text-neutral-900">
        {value}
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "green" | "yellow" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "text-green-700"
      : tone === "yellow"
      ? "text-yellow-700"
      : "text-red-700";

  return (
    <div className="rounded border bg-neutral-50 p-4">
      <p className="text-sm font-medium text-neutral-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function MiniCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "yellow" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "text-green-700"
      : tone === "yellow"
      ? "text-yellow-700"
      : "text-red-700";

  return (
    <div className="rounded border bg-white px-3 py-2">
      <p className={`text-xl font-black ${toneClass}`}>{value}</p>
      <p className="text-xs font-bold uppercase text-neutral-500">{label}</p>
    </div>
  );
}
