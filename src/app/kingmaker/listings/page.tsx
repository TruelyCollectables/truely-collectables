import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The old /kingmaker/listings route can get stranded on its streamed loading
// shell even after the inventory API has returned the full Pending Resale
// queue. /kingmaker/pending renders the same workspace with browser hydration.
// Route every legacy listing link to the working page, preserving its view.
export default async function KingmakerListingsRedirect({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = (await searchParams) || {};
  const queue = query.queue === "verification" ? "verification" : "listings";
  const supportedFolders = new Set([
    "pending", "receipt", "website", "ebay", "mercari", "both",
    "website_mercari", "ebay_mercari", "all3", "investment",
  ]);
  const folder =
    typeof query.folder === "string" && supportedFolders.has(query.folder)
      ? query.folder
      : "pending";
  const params = new URLSearchParams({ queue, folder });
  for (const key of ["batch", "focus"] as const) {
    const value = query[key];
    if (typeof value === "string" && value.trim() && value.length <= 128) {
      params.set(key, value.trim());
    }
  }
  redirect(`/kingmaker/pending?${params.toString()}`);
}
