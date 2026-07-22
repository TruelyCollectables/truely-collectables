import Link from "next/link";
import { redirect } from "next/navigation";
import AdminSubmitButton from "../AdminSubmitButton";
import {
  PLATFORM_DOMAIN,
  STORE_BRAND_NAME,
} from "../../../lib/legal";
import {
  adminStoreOperationalSettingsError,
  cleanAdminSettingsText,
  parseAdminEbayEnvironment,
  parseAdminSellerCommissionPercent,
  readableAdminStoreSettingsFailure,
} from "../../../lib/admin-store-settings";
import {
  getStoreSettings,
  type StoreOperationalSettings,
} from "../../../lib/store-settings";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PLATFORM_EMAIL_DOMAIN = PLATFORM_DOMAIN.toLowerCase();

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function optionalText(formData: FormData, key: string) {
  return cleanAdminSettingsText(formData.get(key));
}

function settingsErrorPath(message: string) {
  return `/admin/settings?settingsError=${encodeURIComponent(message.slice(0, 240))}`;
}

async function updateIntegrationSettings(formData: FormData) {
  "use server";

  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const ebaySyncEnabled = formData.get("ebay_sync_enabled") === "on";
  let saveFailure: string | null = null;

  try {
    const { data: existingSettings, error: readError } = await supabase
      .from("store_settings")
      .select("metadata")
      .eq("store_id", storeId)
      .maybeSingle();

    if (readError) {
      throw new Error(readError.message);
    }

    const metadata =
      existingSettings?.metadata && typeof existingSettings.metadata === "object"
        ? existingSettings.metadata
        : {};

    const { error } = await supabase.from("store_settings").upsert(
      {
        store_id: storeId,
        metadata: {
          ...metadata,
          ebay_sync_enabled: ebaySyncEnabled,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" },
    );

    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    saveFailure = readableAdminStoreSettingsFailure(
      error,
      "Could not save integration settings. Please try again.",
    );
  }

  if (saveFailure) {
    redirect(settingsErrorPath(saveFailure));
  }

  redirect("/admin/settings?saved=integrations");
}

async function updateOperationalSettings(formData: FormData) {
  "use server";

  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const primaryDomain = optionalText(formData, "primary_domain");
  const supportEmail = optionalText(formData, "support_email");
  const salesEmail = optionalText(formData, "sales_email");
  const offersEmail = optionalText(formData, "offers_email");
  const evidenceEmail = optionalText(formData, "evidence_email");
  const evidenceFromEmail = optionalText(formData, "evidence_from_email");
  const orderFromEmail = optionalText(formData, "order_from_email");
  const ebayEnvironment = optionalText(formData, "ebay_environment");
  const ebayAccountLabel = optionalText(formData, "ebay_account_label");
  const sellerCommissionInput = formData.get("seller_commission_percent");
  const validationError = adminStoreOperationalSettingsError({
    sellerCommissionPercent: sellerCommissionInput,
    ebayEnvironment,
    supportEmail,
    salesEmail,
    offersEmail,
    evidenceEmail,
    evidenceFromEmail,
    orderFromEmail,
  });

  if (validationError) {
    redirect(settingsErrorPath(validationError));
  }

  const sellerCommissionPercent =
    parseAdminSellerCommissionPercent(sellerCommissionInput) ?? 0;
  const normalizedEbayEnvironment =
    parseAdminEbayEnvironment(ebayEnvironment) || "production";
  let saveFailure: string | null = null;

  try {
    const { error: storeError } = await supabase
      .from("stores")
      .update({
        primary_domain: primaryDomain,
        updated_at: new Date().toISOString(),
      })
      .eq("id", storeId);

    if (storeError) {
      throw new Error(storeError.message);
    }

    const { error: settingsError } = await supabase.from("store_settings").upsert(
      {
        store_id: storeId,
        support_email: supportEmail,
        sales_email: salesEmail,
        offers_email: offersEmail,
        evidence_email: evidenceEmail,
        evidence_from_email: evidenceFromEmail,
        order_from_email: orderFromEmail,
        ebay_environment: normalizedEbayEnvironment,
        ebay_account_label: ebayAccountLabel,
        seller_commission_rate: sellerCommissionPercent / 100,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" },
    );

    if (settingsError) {
      throw new Error(settingsError.message);
    }
  } catch (error) {
    saveFailure = readableAdminStoreSettingsFailure(
      error,
      "Could not save store operations. Please try again.",
    );
  }

  if (saveFailure) {
    redirect(settingsErrorPath(saveFailure));
  }

  redirect("/admin/settings?saved=operations");
}

async function loadSettings(): Promise<StoreOperationalSettings> {
  const supabase = getSupabaseClient();
  return getStoreSettings(supabase, getActiveStoreId());
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ saved?: string; settingsError?: string }>;
}) {
  const params = await searchParams;
  const settings = await loadSettings();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#fff7ed_0,#f4f1ea_34%,#eef2ff_100%)] text-neutral-950">
      <section className="border-b border-white/10 bg-[#101418] text-white shadow-2xl shadow-neutral-950/20">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-300">
              Store Control Center
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Store Settings
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-300">
              Operational controls for {settings.displayName}. These are
              store-level settings, not global TCOS platform defaults.
            </p>
            <div className="mt-5 grid max-w-3xl gap-3 text-xs font-black uppercase tracking-[0.12em] text-neutral-200 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 shadow-inner shadow-white/5">
                Store identity
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 shadow-inner shadow-white/5">
                Email routing
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 shadow-inner shadow-white/5">
                eBay sync policy
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandLink href="/admin" label="Command Center" />
            <CommandLink href="/admin/ebay" label="eBay Health" />
            <CommandLink href="/admin/launch-readiness" label="Readiness" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {params?.saved ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 shadow-sm ring-1 ring-emerald-900/5"
          >
            {params.saved === "operations"
              ? "Store operations saved. Domain, email, eBay environment, account label, and seller commission settings were updated."
              : "Marketplace integration settings saved. eBay sync availability was updated for this store."}
          </div>
        ) : null}
        {params?.settingsError ? (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-800 shadow-sm ring-1 ring-rose-900/5"
          >
            Settings were not saved: {params.settingsError}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Store" value={settings.displayName} />
          <Metric label="Settings Source" value={settings.source} />
          <Metric label="eBay Environment" value={settings.ebayEnvironment} />
          <Metric
            label="eBay Sync"
            value={settings.ebaySyncEnabled ? "Enabled" : "Disabled"}
            tone={settings.ebaySyncEnabled ? "green" : "rose"}
          />
        </section>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/90 shadow-sm ring-1 ring-black/[0.02] backdrop-blur">
          <div className="border-b border-neutral-200 bg-white/70 p-5">
            <h2 className="text-2xl font-black">Store Operations</h2>
            <p className="mt-1 max-w-3xl text-sm text-neutral-600">
              Update the active store domain, contact emails, evidence delivery,
              marketplace environment, and commission settings used by launch
              readiness and store-facing operations.
            </p>
          </div>

          <form action={updateOperationalSettings} className="space-y-5 p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                label="Primary Domain"
                name="primary_domain"
                defaultValue={settings.primaryDomain || ""}
                placeholder="totallycollectibles.com"
              />
              <Field
                label="Seller Commission %"
                name="seller_commission_percent"
                defaultValue={(settings.sellerCommissionRate * 100).toFixed(2)}
                placeholder="8.00"
                inputMode="decimal"
                type="number"
                min="0"
                max="100"
                step="0.01"
              />
              <Field
                label="Support Email"
                name="support_email"
                defaultValue={settings.supportEmail}
                placeholder="support@totallycollectibles.com"
                type="email"
                inputMode="email"
              />
              <Field
                label="Sales Email"
                name="sales_email"
                defaultValue={settings.salesEmail}
                placeholder="sales@totallycollectibles.com"
                type="email"
                inputMode="email"
              />
              <Field
                label="Offers Email"
                name="offers_email"
                defaultValue={settings.offersEmail}
                placeholder="offers@totallycollectibles.com"
                type="email"
                inputMode="email"
              />
              <Field
                label="Evidence Email"
                name="evidence_email"
                defaultValue={settings.evidenceEmail || ""}
                placeholder="evidence@totallycollectibles.com"
                type="email"
                inputMode="email"
              />
              <Field
                label="Evidence From"
                name="evidence_from_email"
                defaultValue={settings.evidenceFromEmail}
                placeholder={`${STORE_BRAND_NAME} Evidence <evidence@${PLATFORM_EMAIL_DOMAIN}>`}
              />
              <Field
                label="Order From"
                name="order_from_email"
                defaultValue={settings.orderFromEmail}
                placeholder={`${STORE_BRAND_NAME} <sales@${PLATFORM_EMAIL_DOMAIN}>`}
              />
              <label className="text-sm font-bold text-neutral-700">
                eBay Environment
                <select
                  name="ebay_environment"
                  defaultValue={settings.ebayEnvironment}
                  className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 shadow-sm outline-none transition focus:border-neutral-950 focus:ring-2 focus:ring-amber-100"
                >
                  <option value="production">production</option>
                  <option value="sandbox">sandbox</option>
                </select>
              </label>
              <Field
                label="eBay Account Label"
                name="ebay_account_label"
                defaultValue={settings.ebayAccountLabel || ""}
                placeholder={`${STORE_BRAND_NAME} eBay`}
              />
            </div>

            <AdminSubmitButton
              className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-800 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
              pendingChildren="Saving operations..."
              title="Save domain, contact email, eBay environment, account label, and seller commission settings."
            >
              Save Store Operations
            </AdminSubmitButton>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/90 shadow-sm ring-1 ring-black/[0.02] backdrop-blur">
          <div className="border-b border-neutral-200 bg-white/70 p-5">
            <h2 className="text-2xl font-black">Marketplace Integrations</h2>
            <p className="mt-1 max-w-3xl text-sm text-neutral-600">
              Turn store-level marketplace sync on or off. Disabling eBay sync
              blocks imports, full sync, reconnect, and post-sale eBay quantity
              updates for this store.
            </p>
          </div>

          <form action={updateIntegrationSettings} className="space-y-5 p-5">
            <label className="flex items-start gap-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 shadow-sm ring-1 ring-black/[0.02]">
              <input
                type="checkbox"
                name="ebay_sync_enabled"
                defaultChecked={settings.ebaySyncEnabled}
                className="mt-1 h-5 w-5"
              />
              <span>
                <span className="block font-black">Enable eBay Sync</span>
                <span className="mt-1 block text-sm leading-6 text-neutral-600">
                  When enabled, this store can import eBay listings, run full
                  sync, reconnect OAuth, and push quantity changes to eBay after
                  a sale. Turn this off for TCOS or any store where eBay data
                  should not be synced.
                </span>
              </span>
            </label>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Info label="Account Label" value={settings.ebayAccountLabel || "Not set"} />
              <Info label="Environment" value={settings.ebayEnvironment} />
              <Info
                label="Current eBay Sync"
                value={
                  settings.ebaySyncEnabled
                    ? "Enabled: imports, reconnects, and post-sale quantity pushes are allowed."
                    : "Disabled: imports, reconnects, and eBay quantity pushes are blocked."
                }
              />
            </div>

            <AdminSubmitButton
              className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-800 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
              pendingChildren="Saving integration..."
              title="Save the eBay sync toggle for this store. Disabling it blocks imports, reconnects, and post-sale eBay quantity updates."
            >
              Save Integration Settings
            </AdminSubmitButton>
          </form>
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "rose";
}) {
  const toneClass =
    tone === "green"
      ? "text-emerald-700"
      : tone === "rose"
      ? "text-rose-700"
      : "text-neutral-950";

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white/90 p-5 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className={`mt-3 break-words text-2xl font-black ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm ring-1 ring-black/[0.02]">
      <dt className="text-xs font-bold uppercase text-neutral-500">{label}</dt>
      <dd className="mt-1 break-words font-black">{value}</dd>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  inputMode,
  type = "text",
  min,
  max,
  step,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder: string;
  inputMode?: "decimal" | "email" | "text";
  type?: "email" | "number" | "text";
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="text-sm font-bold text-neutral-700">
      {label}
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 shadow-sm outline-none transition focus:border-neutral-950 focus:ring-2 focus:ring-amber-100"
      />
    </label>
  );
}

function CommandLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-white/20 bg-white/[0.03] px-4 py-2 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-white/10 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
    >
      {label}
    </Link>
  );
}
