import Link from "next/link";
import ResaleReadyWorkspace from "./ResaleReadyWorkspace";
import { listMacKingmakerInventory } from "../../../lib/kingmaker-mac-scan-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function money(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";
}

export default async function KingmakerResaleReadyPage() {
  const data = await listMacKingmakerInventory(30_000);
  const cards = (data.items || [])
    .filter((item: any) => {
      const metadata = record(item?.metadata);
      const instacomp = record(metadata.instacomp);
      const workflow = record(metadata.listingWorkflow);
      return (
        item?.status === "draft" &&
        workflow.queue === "resale_ready" &&
        workflow.readyToList === true &&
        instacomp.pricingStatus === "priced_from_exact_sold_market" &&
        Number(item?.price || 0) > 0
      );
    })
    .sort((a: any, b: any) =>
      String(a?.title || "").localeCompare(String(b?.title || "")),
    );

  const fullyCertified = cards.filter((item: any) => {
    const metadata = record(item?.metadata);
    const instacomp = record(metadata.instacomp);
    const identity = record(instacomp.checklistIdentity);
    const orientation = record(instacomp.imageOrientation);
    const front = String(instacomp.frontImageUrl || "");
    const back = String(instacomp.backImageUrl || "");
    const exact =
      instacomp.identityComplete === true &&
      instacomp.trustedForIdentity === true &&
      identity.status === "exact_match" &&
      Boolean(identity.identityId) &&
      Boolean(identity.fingerprintSha256);
    const distinctPair = Boolean(front && back && front !== back);
    const oriented =
      orientation.status === "completed" &&
      instacomp.imageOrientationPersisted === true &&
      (instacomp.imagePersistenceVerified === true || distinctPair);
    return exact && oriented;
  }).length;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
              KINGMAKER / Resale Ready
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Resale Ready</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold text-slate-400">
              Comp-priced cards you moved out of Pending Listings and into seller review.
              Nothing on this page publishes automatically.
            </p>
          </div>
          <Link
            href="/kingmaker/listings"
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-black text-slate-200 hover:bg-slate-800"
          >
            Master Listings
          </Link>
        </div>

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-emerald-800 bg-emerald-950/30 p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-300">Resale Ready</p>
            <p className="mt-2 text-4xl font-black">{cards.length}</p>
          </div>
          <div className="rounded-2xl border border-blue-800 bg-blue-950/30 p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-300">Fully Certified</p>
            <p className="mt-2 text-4xl font-black">{fullyCertified}</p>
          </div>
          <div className="rounded-2xl border border-amber-800 bg-amber-950/30 p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-300">Needs Image Review</p>
            <p className="mt-2 text-4xl font-black">{Math.max(0, cards.length - fullyCertified)}</p>
          </div>
        </section>

        {cards.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-300">No cards are currently in Resale Ready.</div>
        ) : (
          <ResaleReadyWorkspace cards={cards.map((item: any) => {
            const metadata=record(item?.metadata), instacomp=record(metadata.instacomp), ai=record(instacomp.ai), identity=record(instacomp.checklistIdentity), orientation=record(instacomp.imageOrientation);
            const front=String(instacomp.frontImageUrl||""), back=String(instacomp.backImageUrl||"");
            return { id:String(item.inventoryItemId), title:String(item.title||"Untitled card"), subtitle:[ai.player,ai.year,ai.cardNumber?"#"+ai.cardNumber:null,ai.parallel].filter(Boolean).join(" · "), imageUrl:String(instacomp.frontImageUrl||item?.imageUrl||item?.image_url||"")||null, comp:Number(instacomp.suggestedPrice||instacomp.compBasePrice||0), price:Number(item.price||0), ebayPrice:Number(record(record(metadata.dual_marketplace).ebay).price||0), certified:instacomp.identityComplete===true&&instacomp.trustedForIdentity===true&&identity.status==="exact_match"&&Boolean(identity.identityId)&&Boolean(identity.fingerprintSha256)&&orientation.status==="completed"&&instacomp.imageOrientationPersisted===true&&(instacomp.imagePersistenceVerified===true||Boolean(front&&back&&front!==back)) };
          })} />
        )}
      </div>
    </main>
  );
}
