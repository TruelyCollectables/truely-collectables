import KingmakerPendingClient from "./PendingClient";
import { cookies } from "next/headers";
import { GET as getPendingCards } from "../../api/account/seller/instacomp-pending/route";

export const dynamic = "force-dynamic";

export default async function KingmakerPendingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) || {};
  const queue = resolvedSearchParams.queue === "verification" ? "verification" : "listings";
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const response = await getPendingCards(
    new Request(`http://localhost/api/account/seller/instacomp-pending?queue=${queue}`, {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    }),
  ).catch(() => null);
  const data = response ? await response.json().catch(() => ({})) : {};
  return (
    <KingmakerPendingClient
      initialQueue={queue}
      initialCards={Array.isArray(data.items) ? data.items : []}
      initialQueueCounts={{
        listings: Math.max(0, Number(data.queueCounts?.listings || 0)),
        verification: Math.max(0, Number(data.queueCounts?.verification || 0)),
      }}
    />
  );
}
