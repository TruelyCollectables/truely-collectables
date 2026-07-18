import Link from "next/link";
import { getActiveStoreId } from "../../../../lib/stores";
import { getStoreSettings } from "../../../../lib/store-settings";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import EbayImportRunner from "./EbayImportRunner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

export default async function EbayImportRunnerPage() {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const storeSettings = await getStoreSettings(supabase, storeId);
  const { data: ebayToken, error: tokenError } = await supabase
    .from("ebay_tokens")
    .select("id")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const hasEbayRefreshToken = Boolean(ebayToken);

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Marketplace Sync
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              eBay Import Runner
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Browser-driven batch import with live progress and auditable diagnostics.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandLink href="/admin/ebay" label="eBay Health" />
            <CommandLink href="/admin/inventory" label="Inventory Control" />
            <CommandLink href="/admin/inventory/category-review" label="Category Review" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {!storeSettings.ebaySyncEnabled ? (
          <section className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm font-black text-rose-800">
            eBay sync is disabled for this store. Enable it before importing.
          </section>
        ) : tokenError ? (
          <section className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm font-black text-rose-800">
            eBay token status could not be checked: {tokenError.message}
          </section>
        ) : !hasEbayRefreshToken ? (
          <section className="rounded-xl border-4 border-amber-300 bg-amber-50 p-6 text-amber-950">
            <h2 className="text-3xl font-black">Connect eBay first</h2>
            <p className="mt-2 text-sm font-bold">
              TCOS needs a saved eBay refresh token before it can import active
              listings.
            </p>
            <Link
              href="/api/ebay/auth"
              className="mt-4 inline-block rounded-xl bg-amber-300 px-6 py-4 text-base font-black uppercase tracking-[0.08em] text-neutral-950 hover:bg-amber-200"
            >
              Connect eBay First
            </Link>
          </section>
        ) : (
          <EbayImportRunner />
        )}
      </div>
    </main>
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
