import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  getStoreSettings,
  type StoreOperationalSettings,
} from "../../../lib/store-settings";
import { getActiveStoreId } from "../../../lib/stores";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

async function updateIntegrationSettings(formData: FormData) {
  "use server";

  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const ebaySyncEnabled = formData.get("ebay_sync_enabled") === "on";

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

  redirect("/admin/settings?saved=integrations");
}

async function loadSettings(): Promise<StoreOperationalSettings> {
  const supabase = getSupabaseClient();
  return getStoreSettings(supabase, getActiveStoreId());
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ saved?: string }>;
}) {
  const params = await searchParams;
  const settings = await loadSettings();

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Store Controls
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Store Settings
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Operational controls for {settings.displayName}. These are
              store-level settings, not global TCOS platform defaults.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandLink href="/admin" label="Command Center" />
            <CommandLink href="/admin/ebay" label="eBay Health" />
            <CommandLink href="/admin/launch-readiness" label="Readiness" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {params?.saved ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            Store settings saved.
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

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Marketplace Integrations</h2>
            <p className="mt-1 max-w-3xl text-sm text-neutral-600">
              Turn store-level marketplace sync on or off. Disabling eBay sync
              blocks imports, full sync, reconnect, and post-sale eBay quantity
              updates for this store.
            </p>
          </div>

          <form action={updateIntegrationSettings} className="space-y-5 p-5">
            <label className="flex items-start gap-4 rounded-md border border-neutral-200 bg-neutral-50 p-4">
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
            </div>

            <button
              type="submit"
              className="rounded-md bg-neutral-950 px-5 py-3 text-sm font-black text-white hover:bg-neutral-800"
            >
              Save Integration Settings
            </button>
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
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className={`mt-3 break-words text-2xl font-black ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-4 py-3">
      <dt className="text-xs font-bold uppercase text-neutral-500">{label}</dt>
      <dd className="mt-1 break-words font-black">{value}</dd>
    </div>
  );
}

function CommandLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
    >
      {label}
    </Link>
  );
}
