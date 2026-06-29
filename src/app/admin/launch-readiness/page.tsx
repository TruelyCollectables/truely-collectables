import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import {
  getStoreSettings,
  resolveStoreSettings,
  type StoreOperationalSettings,
} from "../../../lib/store-settings";
import { getActiveStoreId } from "../../../lib/stores";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReadinessStatus = "ready" | "warning" | "blocked";

type ReadinessItem = {
  label: string;
  status: ReadinessStatus;
  detail: string;
  action: string;
};

function isConfigured(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function keyMode(value: string | undefined, livePrefix: string, testPrefix: string) {
  if (!isConfigured(value)) return "missing";
  if (value!.startsWith(livePrefix)) return "live";
  if (value!.startsWith(testPrefix)) return "test";
  return "unknown";
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
  const secretMode = keyMode(process.env.STRIPE_SECRET_KEY, "sk_live_", "sk_test_");
  const publishableMode = keyMode(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    "pk_live_",
    "pk_test_",
  );

  if (secretMode === "live" && publishableMode === "live") return "live";
  if (secretMode === "test" && publishableMode === "test") return "test";
  if (secretMode === "missing" || publishableMode === "missing") return "missing";
  return "mixed";
}

function buildReadinessItems(): ReadinessItem[] {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const paymentMode = getPaymentMode();
  const stripeSecretMode = keyMode(process.env.STRIPE_SECRET_KEY, "sk_live_", "sk_test_");
  const stripePublishableMode = keyMode(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    "pk_live_",
    "pk_test_",
  );
  const identityRequired = process.env.IP_INTELLIGENCE_REQUIRED === "true";

  return [
    {
      label: "Public Site URL",
      status:
        isConfigured(siteUrl) && siteUrl!.startsWith("https://")
          ? "ready"
          : "blocked",
      detail: isConfigured(siteUrl)
        ? "NEXT_PUBLIC_SITE_URL is configured."
        : "NEXT_PUBLIC_SITE_URL is missing.",
      action: "Use the final HTTPS production domain before accepting live payment.",
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
          ? "Stripe secret and publishable keys are both live keys."
          : paymentMode === "test"
          ? "Stripe keys are still in test mode."
          : paymentMode === "mixed"
          ? `Stripe key modes do not match. Secret: ${stripeSecretMode}. Publishable: ${stripePublishableMode}.`
          : "One or more Stripe keys are missing.",
      action:
        "Use matching live STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY only when ready for real charges.",
    },
    {
      label: "Stripe Webhook",
      status: isConfigured(process.env.STRIPE_WEBHOOK_SECRET) ? "ready" : "blocked",
      detail: isConfigured(process.env.STRIPE_WEBHOOK_SECRET)
        ? "STRIPE_WEBHOOK_SECRET is configured."
        : "STRIPE_WEBHOOK_SECRET is missing.",
      action:
        "Create a live Stripe webhook for /api/webhook and save its signing secret.",
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
        isConfigured(process.env.RESEND_API_KEY) &&
        isConfigured(process.env.TRANSACTION_EVIDENCE_EMAIL)
          ? "ready"
          : "warning",
      detail:
        "Evidence PDFs are still saved in admin files even if email delivery is not configured.",
      action:
        "Set RESEND_API_KEY, TRANSACTION_EVIDENCE_EMAIL, and optionally TRANSACTION_EVIDENCE_FROM.",
    },
    {
      label: "eBay Sync",
      status:
        isConfigured(process.env.EBAY_CLIENT_ID) &&
        isConfigured(process.env.EBAY_CLIENT_SECRET) &&
        process.env.EBAY_ENVIRONMENT === "production"
          ? "ready"
          : "warning",
      detail:
        process.env.EBAY_ENVIRONMENT === "production"
          ? "eBay environment is set to production."
          : "eBay production mode is not confirmed.",
      action:
        "Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_ENVIRONMENT=production for live inventory sync.",
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
        "The manual defines Dag Danky Holdings LLC as platform owner/admin, Truely Collectables LLC as the collectables storefront account, and Dag Danky Shoes as the footwear storefront account.",
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

async function checkAdminLoginAuditTable(): Promise<ReadinessItem> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      label: "Admin Login Audit",
      status: "blocked",
      detail: "Supabase is not configured, so admin login audit storage cannot be checked.",
      action:
        "Set Supabase environment variables and apply the admin login attempts migration.",
    };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { error } = await supabase
    .from("admin_login_attempts")
    .select("id")
    .limit(1);

  if (!error) {
    return {
      label: "Admin Login Audit",
      status: "ready",
      detail: "admin_login_attempts is available for login audit and lockout storage.",
      action: "Review recent activity in /admin/security before launch.",
    };
  }

  return {
    label: "Admin Login Audit",
    status: "blocked",
    detail: `Admin login audit storage is unavailable: ${error.message}`,
    action:
      "Apply supabase/migrations/20260628180000_create_admin_login_attempts.sql before launch.",
  };
}

async function loadStoreSettings(): Promise<StoreOperationalSettings> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return resolveStoreSettings({ source: "fallback" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  return getStoreSettings(supabase, getActiveStoreId());
}

export default async function LaunchReadinessPage() {
  const baseItems = buildReadinessItems();
  const [storeSettings, adminLoginAuditItem] = await Promise.all([
    loadStoreSettings(),
    checkAdminLoginAuditTable(),
  ]);
  const items = [...baseItems, adminLoginAuditItem];
  const summary = summarize(items);
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
