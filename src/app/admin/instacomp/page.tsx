import { createClient } from "@supabase/supabase-js";
import InstaCompAdminFrame from "./InstaCompAdminFrame";
import InstaCompScanner from "./InstaCompScanner";

export const dynamic = "force-dynamic";

type ScanRow = {
  id: string;
  created_at: string;
  player: string | null;
  year: string | null;
  brand: string | null;
  set_name: string | null;
  card_number: string | null;
  parallel: string | null;
  confidence: number | null;
  search_query: string | null;
  suggested_price: number | null;
  ebay_sold_url: string | null;
};

async function getRecentScans(): Promise<ScanRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return [];

  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from("instacomp_scans")
    .select(
      "id, created_at, player, year, brand, set_name, card_number, parallel, confidence, search_query, suggested_price, ebay_sold_url"
    )
    .order("created_at", { ascending: false })
    .limit(15);

  if (error) {
    console.error("Failed loading InstaComp™ scans:", error);
    return [];
  }

  return data || [];
}

function money(value: number | null) {
  if (value === null || value === undefined) return "—";

  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function confidence(value: number | null) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

export default async function InstaCompAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{
    source?: string;
    rows?: string;
    q?: string;
    stagedItemId?: string | string[];
  }>;
}) {
  const recentScans = await getRecentScans();
  const params = (await searchParams) || {};
  const openedFromSellerEbayStaging = params.source === "seller-ebay-staging";
  const stagedRowCount = Number(params.rows || 0);
  const importedQuery = typeof params.q === "string" ? params.q : "";

  return (
    <InstaCompAdminFrame
      eyebrow="Admin scan workbench"
      title="InstaComp™ Scan Lab"
      description="Identify cards with AI, verify the exact card identity, remove bad rows, merge duplicate quantities, refresh comps, and turn clean scan results into priced TCOS drafts."
      notice={
        openedFromSellerEbayStaging ? (
          <section className="rounded-3xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
                  Seller eBay staging handoff
                </p>
                <h2 className="mt-1 text-2xl font-black text-blue-950">
                  Seller eBay listings ready for InstaComp™ cleanup
                </h2>
                <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-blue-950">
                  {stagedRowCount > 0
                    ? `${stagedRowCount} staged eBay row${
                        stagedRowCount === 1 ? "" : "s"
                      } selected. `
                    : ""}
                  Upload or scan the matching card fronts/backs here, review the
                  detected identity and comps, then create TCOS seller drafts from
                  the cleaned InstaComp™ result.
                </p>
              </div>
              {importedQuery ? (
                <div className="rounded-2xl border border-blue-200 bg-white px-4 py-3 text-sm font-black text-blue-800">
                  Import context: {importedQuery}
                </div>
              ) : null}
            </div>
          </section>
        ) : null
      }
    >
      <InstaCompScanner />

      <section className="mt-7 overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
            Audit trail
          </p>
          <h2 className="mt-1 text-2xl font-black">Recent InstaComp™ Scans</h2>
        </div>

        {!recentScans.length ? (
          <p className="p-5 font-semibold text-neutral-600">No scans saved yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                    Date
                  </th>
                  <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                    Card
                  </th>
                  <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                    Query
                  </th>
                  <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                    Confidence
                  </th>
                  <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                    Suggested
                  </th>
                  <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                    Sold Search
                  </th>
                </tr>
              </thead>

              <tbody>
                {recentScans.map((scan) => {
                  const title = [
                    scan.year,
                    scan.brand,
                    scan.set_name,
                    scan.player,
                    scan.parallel,
                    scan.card_number ? `#${scan.card_number}` : null,
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <tr key={scan.id} className="border-b border-neutral-100">
                      <td className="px-5 py-4 align-top font-semibold text-neutral-600">
                        {new Date(scan.created_at).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 align-top font-black text-neutral-900">
                        {title || "—"}
                      </td>
                      <td className="px-5 py-4 align-top font-semibold text-neutral-600">
                        {scan.search_query || "—"}
                      </td>
                      <td className="px-5 py-4 align-top font-black text-neutral-900">
                        {confidence(scan.confidence)}
                      </td>
                      <td className="px-5 py-4 align-top font-black text-neutral-900">
                        {money(scan.suggested_price)}
                      </td>
                      <td className="px-5 py-4 align-top">
                        {scan.ebay_sold_url ? (
                          <a
                            href={scan.ebay_sold_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-black text-blue-700 underline"
                          >
                            Open
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </InstaCompAdminFrame>
  );
}
