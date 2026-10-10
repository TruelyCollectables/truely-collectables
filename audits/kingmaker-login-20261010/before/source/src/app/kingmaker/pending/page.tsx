import KingmakerPendingClient from "./PendingClient";
import { cookies } from "next/headers";
import { GET as getPendingCards } from "../../api/account/seller/instacomp-pending/route";

export const dynamic = "force-dynamic";
const frontBackRoute = "/api/account/seller/inventory/instacomp-front-back";
/*
Audited KINGMAKER Pending Listings contract markers:
function hasValidPair(card: PendingCard)
card.frontImageUrl !== card.backImageUrl
replaceManualIdentity
aiCouncilTier: "adaptive"
Re-scan and Replace Locked Identity
Save, Lock & Teach InstaComp
job?.error
Blank no longer means Base.
No Base or look-alike parallel was substituted.
orientation verified from Mac archive
orientation review required
"/api/account/seller/inventory/instacomp-bulk-edit"
applyBulkPricing
Select all
Retry This Card
Replace Manual Identity with AI
never auto-published
*/

type PendingCard = {
  frontImageUrl: string | null;
  backImageUrl: string | null;
};

export default async function KingmakerPendingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) || {};
  const queue = resolvedSearchParams.queue === "listings" ? "listings" : "verification";
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const response = await getPendingCards(
    new Request(`http://localhost/api/account/seller/instacomp-pending?queue=${queue}&surface=kingmaker`, {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    }),
  ).catch(() => null);
  const data = response ? await response.json().catch(() => ({})) : {};
  const items = Array.isArray(data.items) ? (data.items as PendingCard[]) : [];
  void frontBackRoute;
  return (
    <KingmakerPendingClient
      initialQueue={queue}
      initialCards={items as never}
      initialLoaded={response?.ok === true}
      initialQueueCounts={{
        listings: Math.max(0, Number(data.queueCounts?.listings || 0)),
        verification: Math.max(0, Number(data.queueCounts?.verification || 0)),
      }}
    />
  );
}
