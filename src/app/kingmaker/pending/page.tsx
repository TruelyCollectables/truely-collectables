import KingmakerPendingClient from "./PendingClient";

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

export default async function KingmakerPendingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) || {};
  const queue = resolvedSearchParams.queue === "listings" ? "listings" : "verification";
  void frontBackRoute;
  return (
    <KingmakerPendingClient
      initialQueue={queue}
      initialLoaded={false}
    />
  );
}
