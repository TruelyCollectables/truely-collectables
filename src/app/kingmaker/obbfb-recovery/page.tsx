import Link from "next/link";
import { headers } from "next/headers";
import RecoveryHeldScans from "./RecoveryHeldScans";
import { getAuthenticatedAccountFromRequest } from "../../../lib/kingmaker-local-auth";
import RecoveryDrafts from "./RecoveryDrafts";
import { marketVariantMismatch, normalizeDirectIdentity } from "../../../lib/obbfb-intake-rules";
import { getMacMasterListingRows, kingmakerScanImageUrl, listMacMasterListingRows, macRecoveryScans, type MacRecoveryScan } from "../../../lib/kingmaker-mac-scan-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type JsonRecord = Record<string, unknown>;
const record = (x: unknown): JsonRecord =>
  x && typeof x === "object" && !Array.isArray(x) ? x as JsonRecord : {};
const text = (x: unknown) => String(x ?? "").trim();

export default async function OBBFBRecoveryPage() {
  const account = await getAuthenticatedAccountFromRequest(new Request("https://truelycollectables.com", { headers: await headers() }));
  let held: MacRecoveryScan[] = [];
  let rows: JsonRecord[] = [];
  let error: string | null = null;
  try {
    const scans = account ? await macRecoveryScans("list", account.id) : [];
    rows = await listMacMasterListingRows({ folder: "pending", pendingQueue: "listings", compact: false, timeoutMs: 25_000 }) as JsonRecord[];
    const uniqueScans = [...new Map(scans.slice().reverse().map(scan => [scan.card_uuid, scan])).values()].reverse();
    for (let index = 0; index < uniqueScans.length; index += 50) {
      const group = uniqueScans.slice(index, index + 50);
      const existing = new Set((await getMacMasterListingRows(group.map(scan => scan.card_uuid), 12_000))
        .map(row => row.inventoryItemId || row.id));
      held.push(...group.filter(scan => !existing.has(scan.card_uuid)));
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Mac inventory could not be reached.";
  }
  const archived = rows.filter((row) => {
    const meta = record(row.metadata);
    const info = record(meta.instacomp);
    return info.intakeEngine === "obbfb_direct_vision_v1"
      && info.humanVerified !== true
      && info.manualIdentityLocked !== true
      && info.sellerPriceOverride !== true
      && text(row.status) === "draft"
      && text(info.scanId).length > 0;
  });
  return (
    <main className="mx-auto max-w-6xl p-6 text-white">
      <h1 className="text-3xl font-black text-emerald-300">OBBFB — Recover Saved Scans</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
        These card fronts and backs were already saved on your Mac. Retry both sides with
        Gemini vision with Cloudflare backup. No photography or uploads are needed.
        Scans waiting on identification stay here. Identified cards move to Resale Pending, where you can review pricing.
      </p>
      <p className="mt-4 font-bold text-sky-200">{archived.length} unverified OBBFB scans saved</p>
      {error ? <p className="mt-4 rounded-xl border border-red-700 bg-red-950/50 p-4 text-red-200">{error}</p> : null}
      {!error && !archived.length && !held.length ? (
        <p className="mt-5 rounded-xl border border-slate-700 p-4 text-slate-300">
          No scans are waiting for recovery.
        </p>
      ) : null}
      <RecoveryHeldScans scans={held.map(scan => ({
        id: scan.scan_id, title: scan.title || "Archived card",
        identified: Boolean(scan.identity), finish: normalizeDirectIdentity(scan.identity || {}).parallel,
        front: `${kingmakerScanImageUrl(scan.scan_id, "front")}&view=upright`, back: kingmakerScanImageUrl(scan.scan_id, "back"),
      }))} />
      <RecoveryDrafts drafts={archived.map((row) => {
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
      <Link href="/kingmaker/scan" className="mt-6 inline-flex rounded-lg border border-slate-500 px-4 py-2 font-bold text-slate-200">
        Return to InstaComp Intake
      </Link>
    </main>
  );
}
