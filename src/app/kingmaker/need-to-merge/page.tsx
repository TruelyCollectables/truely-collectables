import Link from "next/link";
import { listMacMasterListingRows } from "../../../lib/kingmaker-mac-scan-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord : {};
}
function str(value: unknown) { return String(value ?? "").trim(); }
function money(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n) : "Unpriced";
}
export default async function KingmakerOBBFBNeedToMerge() {
  let rows: Array<Record<string, unknown>> = [];
  let error: string | null = null;
  try {
    rows = (await listMacMasterListingRows({ folder: "pending", pendingQueue: "need_to_merge", timeoutMs: 30_000 })) as unknown as Array<Record<string, unknown>>;
  } catch (err) {
    error = err instanceof Error ? err.message : "The Mac-local inventory is unreachable.";
  }
  const flagged = rows.filter(row => {
    const meta = record(row.metadata);
    const instacomp = record(meta.instacomp);
    const workflow = record(meta.listingWorkflow);
    return instacomp.intakeEngine === "obbfb_direct_vision_v1"
      && workflow.queue === "need_to_merge";
  });
  return (
    <main className="mx-auto max-w-6xl p-6 text-white">
      <h1 className="text-3xl font-black">NEED TO MERGE</h1>
      <p className="mt-2 text-sm text-slate-300">
        OBBFB flagged incoming photographs that may match currently active stock.
        Nothing has been combined, published or had its quantity increased.
        A seller must confirm whether this is another physical copy.
      </p>
      <p className="mt-5 text-xl font-bold text-amber-300">{flagged.length} awaiting seller review</p>
      {error ? <div className="mt-4 rounded-xl border border-red-700 bg-red-950/50 p-4 text-red-200">{error}</div> : null}
      {flagged.length === 0 && !error ? (
        <p className="mt-5 rounded-xl border border-slate-700 p-5 text-slate-300">No OBBFB duplicates require review.</p>
      ) : null}
      <div className="mt-5 space-y-4">
        {flagged.map(row => {
          const meta = record(row.metadata);
          const instacomp = record(meta.instacomp);
          const merge = record(meta.merge);
          const id = str(row.inventoryItemId || row.id);
          return (
            <article key={id} className="rounded-2xl border border-amber-800/60 bg-slate-900 p-5">
              <h2 className="font-black text-xl text-white">{str(row.title) || "Unidentified card"}</h2>
              <p className="mt-1 text-xs text-slate-400">Incoming card ID: {id}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {["frontImageUrl", "backImageUrl"].map((key, index) => {
                  const src = str(instacomp[key]);
                  return src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={key} src={src} className="h-36 w-24 rounded-lg border border-slate-700 object-contain" alt={index ? "Card back" : "Card front"} />
                  ) : null;
                })}
              </div>
              <p className="mt-3 text-sm">Incoming suggested price: {money(row.price)}</p>
              <p className="mt-2 text-sm text-amber-200">
                Possible existing active listing: {str(merge.existingTitle) || "Review required"}
              </p>
              <p className="mt-1 text-xs text-slate-400">Existing inventory ID: {str(merge.existingInventoryItemId) || "Unknown"}</p>
              <p className="mt-2 text-xs text-slate-400">You can resolve this through Master Listings after physically confirming whether it is a distinct copy.</p>
              <Link href={"/kingmaker/listings?folder=pending&focus=" + encodeURIComponent(id)}
                className="mt-4 inline-flex rounded-lg bg-amber-300 px-4 py-2 font-black text-slate-950">
                Review incoming card in Master Listings
              </Link>
            </article>
          );
        })}
      </div>
    </main>
  );
}
