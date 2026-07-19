"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";

export default function EbayPurchaseCompSyncEnhancer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [target, setTarget] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (pathname !== "/admin/market-intel/purchases/ebay-intake") return;
    const content = document.querySelector<HTMLElement>("main > div.mx-auto");
    if (!content) return;
    const mount = document.createElement("div");
    mount.dataset.ebayPurchaseCompSync = "1";
    content.prepend(mount);
    setTarget(mount);
    return () => {
      setTarget(null);
      mount.remove();
    };
  }, [pathname]);

  if (pathname !== "/admin/market-intel/purchases/ebay-intake" || !target) {
    return null;
  }

  const handoff = searchParams.get("admin_handoff");
  const action = handoff
    ? `/api/admin/market-intel/purchases/ebay-intake/comp-sync?admin_handoff=${encodeURIComponent(handoff)}`
    : "/api/admin/market-intel/purchases/ebay-intake/comp-sync";
  const completed = searchParams.get("compSync") === "1";
  const created = Number(searchParams.get("compCreated") || 0);
  const updated = Number(searchParams.get("compUpdated") || 0);
  const skipped = Number(searchParams.get("compSkipped") || 0);
  const errors = Number(searchParams.get("compErrors") || 0);
  const firstError = searchParams.get("compError");

  return createPortal(
    <section className="rounded-xl border border-cyan-300 bg-cyan-50 p-5 text-cyan-950 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-800">
            eBay receipt intelligence
          </p>
          <h2 className="mt-1 text-2xl font-black">
            Completed eBay buys now strengthen InstaComp™
          </h2>
          <p className="mt-2 max-w-4xl text-sm font-semibold leading-6">
            New Purchase Inbox records automatically create or refresh one deduplicated,
            verified sold comp after exact-card approval. Sales tax and unrelated acquisition
            costs stay in ledger metadata and do not distort the comparable market price.
          </p>
          {completed ? (
            <p
              role={errors > 0 ? "alert" : "status"}
              className={`mt-3 rounded-md border px-3 py-2 text-sm font-black ${
                errors > 0
                  ? "border-amber-400 bg-amber-50 text-amber-950"
                  : "border-emerald-300 bg-emerald-50 text-emerald-950"
              }`}
            >
              Comp sync complete: {created} created · {updated} refreshed · {skipped} skipped
              {errors > 0 ? ` · ${errors} errors` : ""}.
              {firstError ? ` First issue: ${firstError}` : ""}
            </p>
          ) : null}
        </div>
        <form method="post" action={action} className="shrink-0">
          <button
            type="submit"
            className="rounded-md bg-cyan-900 px-5 py-3 font-black text-white hover:bg-cyan-800"
            title="Backfill recorded eBay Purchase Inbox transactions into verified exact-card sold comps. The operation is deduplicated and safe to run again."
          >
            Sync Recorded eBay Buys to InstaComp™
          </button>
          <p className="mt-2 max-w-xs text-xs font-bold text-cyan-900">
            One-time repair for older ledger records. Safe to rerun; matching receipts are refreshed,
            not duplicated.
          </p>
        </form>
      </div>
    </section>,
    target,
  );
}
