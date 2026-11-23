import Link from "next/link";
import { headers } from "next/headers";
import PendingScanReview from "./PendingScanReview";
import { getAuthenticatedAccountFromRequest } from "../../../../lib/kingmaker-local-auth";
import { marketVariantMismatch, normalizeDirectIdentity } from "../../../../lib/obbfb-intake-rules";
import { listMacMasterListingRows } from "../../../../lib/kingmaker-mac-scan-server";

export const dynamic = "force-dynamic";
type JsonRecord = Record<string, unknown>;
const record = (x: unknown): JsonRecord =>
  x && typeof x === "object" && !Array.isArray(x) ? x as JsonRecord : {};
const text = (x: unknown) => String(x ?? "").trim();

export default async function PendingScanReviewPage() {
  const account = await getAuthenticatedAccountFromRequest(new Request("https://truelycollectables.com", { headers: await headers() }));
  let rows: JsonRecord[] = [];
  let error: string | null = null;
  try {
    if (account) rows = await listMacMasterListingRows({ folder: "pending", pendingQueue: "listings", compact: false });
  } catch (failure) {
    error = failure instanceof Error ? failure.message : "Resale Pending could not be loaded.";
  }
  const drafts = rows.filter((row) => {
    const meta = record(row.metadata);
    const info = record(meta.instacomp);
    return meta.obbfbSellerAccountId === account?.id && info.intakeEngine === "obbfb_direct_vision_v1"
      && info.humanVerified !== true
      && info.manualIdentityLocked !== true
      && info.sellerPriceOverride !== true
      && text(row.status) === "draft"
      && text(info.scanId).length > 0;
  });
  return (
    <main className="mx-auto max-w-6xl p-6 text-white">
      <Link href="/kingmaker/pending?folder=pending" className="text-sm font-semibold text-sky-200 underline">
        Back to Resale Pending
      </Link>
      <h1 className="mt-4 text-3xl font-black text-emerald-300">Review scans and pricing</h1>
      {error ? <p role="alert" className="mt-4 text-red-200">{error}</p> : null}
      {!error && !drafts.length ? <p className="mt-4 text-slate-300">No drafts are awaiting scan and price review.</p> : null}
      <PendingScanReview drafts={drafts.map((row) => {
        const info = record(record(row.metadata).instacomp);
        const identity = record(info.ai);
        const sold = Array.isArray(info.soldCompEvidence) ? info.soldCompEvidence.map(record) : [];
        const exact = normalizeDirectIdentity(identity);
        const priceNeedsRecomp = sold.some(sale => marketVariantMismatch(text(sale.title), exact));
        const price = Number(info.suggestedPrice ?? row.price);
        return {
          id: text(row.inventoryItemId || row.id || row.card_uuid),
          title: text(row.title) || "Unidentified archived card",
          description: text(row.description),
          identity,
          suggestedPrice: !priceNeedsRecomp && Number.isFinite(price) && price > 0 ? price : null,
          pricingStatus: text(info.pricingStatus),
          front: text(info.frontImageUrl),
          back: text(info.backImageUrl),
          visualFailure: text(info.visualFailure),
          priceNeedsRecomp,
          marketEvidence: {
            soldCompEvidence: sold,
            rejectedSoldComps: Array.isArray(info.rejectedSoldComps)
              ? info.rejectedSoldComps.map(record).map(row => ({ sale: record(row.sale), reason: row.reason })) : [],
            activeCompetition: Array.isArray(info.activeCompetition) ? info.activeCompetition.map(record) : [],
          },
        };
      })} />
    </main>
  );
}
