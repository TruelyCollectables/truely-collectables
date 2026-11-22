import Link from "next/link";
import OBBFBOperatorForm from "../OBBFBOperatorForm";
import { listMacMasterListingRows } from "../../../lib/kingmaker-mac-scan-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type JsonRecord = Record<string, unknown>;
const record = (x: unknown): JsonRecord =>
  x && typeof x === "object" && !Array.isArray(x) ? x as JsonRecord : {};
const text = (x: unknown) => String(x ?? "").trim();

export default async function OBBFBRecoveryPage() {
  let rows: JsonRecord[] = [];
  let error: string | null = null;
  try {
    rows = await listMacMasterListingRows({ folder: "pending", pendingQueue: "listings", compact: false, timeoutMs: 25_000 }) as JsonRecord[];
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
        Cards remain private in Resale Pending. Inspect the identity, serial and price
        before using Save &amp; Lock — No Publish.
      </p>
      <p className="mt-4 font-bold text-sky-200">{archived.length} unverified OBBFB scans saved</p>
      {error ? <p className="mt-4 rounded-xl border border-red-700 bg-red-950/50 p-4 text-red-200">{error}</p> : null}
      {!error && !archived.length ? (
        <p className="mt-5 rounded-xl border border-slate-700 p-4 text-slate-300">
          No unverified OBBFB scans remain in Resale Pending.
        </p>
      ) : null}
      <div className="mt-6 space-y-6">
        {archived.map((row) => {
          const meta = record(row.metadata);
          const info = record(meta.instacomp);
          const id = text(row.inventoryItemId || row.id || row.card_uuid);
          const identity = record(info.ai);
          const title = text(row.title) || "Unidentified archived card";
          const price = Number(info.suggestedPrice || row.price);
          return (
            <article key={id} className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
              <h2 className="text-xl font-black">{title}</h2>
              <p className="mt-1 text-xs text-slate-400">Private draft ID: {id}</p>
              <div className="mt-4 flex flex-wrap gap-4">
                {(["frontImageUrl", "backImageUrl"] as const).map((key, index) => {
                  const src = text(info[key]);
                  return src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={key} src={src} alt={index ? "Archived back" : "Archived front"}
                      className="h-52 w-36 rounded-lg border border-slate-600 bg-slate-950 object-contain" />
                  ) : null;
                })}
              </div>
              {info.visualFailure ? (
                <p className="mt-4 rounded-lg border border-amber-600/40 bg-amber-950/30 p-3 text-sm text-amber-200">
                  Previous vision error: {text(info.visualFailure)}
                </p>
              ) : null}
              <OBBFBOperatorForm
                key={id} inventoryItemId={id} identity={identity}
                originalTitle={title}
                originalDescription={text(row.description)}
                suggestedPrice={Number.isFinite(price) && price > 0 ? price : null}
                pricingStatus={text(info.pricingStatus)}
              />
            </article>
          );
        })}
      </div>
      <Link href="/kingmaker/scan" className="mt-6 inline-flex rounded-lg border border-slate-500 px-4 py-2 font-bold text-slate-200">
        Return to InstaComp Intake
      </Link>
    </main>
  );
}
