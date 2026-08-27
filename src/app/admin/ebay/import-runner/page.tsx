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

function safeErrorMessage(error: { message?: string } | string | null | undefined) {
  const message =
    typeof error === "string"
      ? error
      : error?.message || "Unknown eBay token status error.";

  return String(message).replace(/\s+/g, " ").trim().slice(0, 220);
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
  const ebayTokenStatusUnavailable = Boolean(tokenError);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.15),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="flex flex-col gap-5 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.22),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:flex-row lg:items-end lg:justify-between lg:p-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Marketplace Sync
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              eBay Import Runner
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-300">
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

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        {!storeSettings.ebaySyncEnabled ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-black text-rose-800 shadow-sm ring-1 ring-rose-950/5">
            eBay sync is disabled for this store. Enable it before importing.
          </section>
        ) : ebayTokenStatusUnavailable ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-800 shadow-sm ring-1 ring-rose-950/5">
            <h2 className="text-xl font-black text-rose-950">
              eBay token status unavailable
            </h2>
            <p className="mt-2 max-w-3xl leading-6">
              TCOS could not confirm whether a saved eBay refresh token exists,
              so the browser import runner is paused instead of assuming eBay is
              disconnected or safe to import.
            </p>
            <p className="mt-3 rounded-2xl border border-rose-200 bg-white/70 px-3 py-2 text-xs font-black text-rose-950 shadow-sm ring-1 ring-rose-950/5">
              Diagnostic: {safeErrorMessage(tokenError)}
            </p>
          </section>
        ) : !hasEbayRefreshToken ? (
          <section className="rounded-3xl border border-amber-300 bg-amber-50 p-6 text-amber-950 shadow-sm ring-1 ring-amber-950/5">
            <h2 className="text-3xl font-black">Connect eBay first</h2>
            <p className="mt-2 text-sm font-bold">
              TCOS needs a saved eBay refresh token before it can import active
              listings.
            </p>
            <Link
              href="/api/ebay/auth"
              className="mt-4 inline-block rounded-2xl bg-amber-300 px-6 py-4 text-base font-black uppercase tracking-[0.08em] text-neutral-950 shadow-sm transition hover:bg-amber-200"
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
      className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15"
    >
      {label}
    </Link>
  );
}
