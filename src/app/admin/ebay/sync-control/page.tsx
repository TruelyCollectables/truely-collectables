import Link from "next/link";
import { redirect } from "next/navigation";
import AdminSubmitButton from "../../AdminSubmitButton";
import { importEbayListingsPage } from "../../../../lib/ebay-sync";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type SyncSearchParams = {
  offset?: string;
  limit?: string;
  runId?: string;
  imported?: string;
  markedSold?: string;
  skipped?: string;
  received?: string;
  policyAllowed?: string;
  policyNeedsReview?: string;
  policyBlocked?: string;
  nextOffset?: string;
  error?: string;
};

const LIMIT_OPTIONS = [10, 25, 50, 100];

type DecisionSummaryRow = {
  decision: string;
  action: string;
  reason: string;
  decision_count: number;
  latest_decision_at: string | null;
};

type MissingDecisionSummaryRow = {
  decision: string;
  reason: string;
  decision_count: number;
  latest_decision_at: string | null;
};

type PublicInventoryStatsRow = {
  total_products: number;
  in_stock_products: number;
  sold_out_products: number;
  ebay_linked_products: number;
  missing_sku_products: number;
  latest_ebay_seen_at: string | null;
};

function safeLimit(value: FormDataEntryValue | string | undefined) {
  const parsed = Number(value || 25);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : 25;
}

function safeOffset(value: FormDataEntryValue | string | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function resultUrl(params: Record<string, string | number | null>) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== "") {
      search.set(key, String(value));
    }
  }

  return `/admin/ebay/sync-control?${search.toString()}`;
}

async function runBatch(formData: FormData) {
  "use server";

  const offset = safeOffset(formData.get("offset") || "0");
  const limit = safeLimit(formData.get("limit") || "25");
  const runId =
    String(formData.get("runId") || "").trim() || new Date().toISOString();

  try {
    const result = await importEbayListingsPage({
      offset,
      limit,
      runId,
    });

    redirect(
      resultUrl({
        offset,
        limit,
        runId,
        imported: result.imported,
        markedSold: result.markedSold,
        skipped: result.skipped,
        received: result.received,
        policyAllowed: result.policyAllowed,
        policyNeedsReview: result.policyNeedsReview,
        policyBlocked: result.policyBlocked,
        nextOffset: result.nextOffset,
      }),
    );
  } catch (error: any) {
    redirect(
      resultUrl({
        offset,
        limit,
        runId,
        error: error.message || "eBay sync batch failed",
      }),
    );
  }
}

function intValue(value: string | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSupabaseClient() {
  try {
    return createSupabaseServerClient({ admin: true });
  } catch {
    return null;
  }
}

function shortDate(value: string | null) {
  if (!value) return "Never";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function decisionLabel(value: string) {
  return value.replaceAll("_", " ").toUpperCase();
}

function decisionTone(value: string) {
  if (value === "allowed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (value === "needs_review") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

export default async function EbaySyncControlPage({
  searchParams,
}: {
  searchParams?: Promise<SyncSearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const currentOffset = safeOffset(params.nextOffset ?? params.offset ?? "0");
  const currentLimit = safeLimit(params.limit ?? "25");
  const runId = params.runId || new Date().toISOString();
  const storeId = getActiveStoreId();
  const supabase = getSupabaseClient();
  const ebayTokenResult = supabase
    ? await supabase
        .from("ebay_tokens")
        .select("id")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  const hasEbayRefreshToken = Boolean(ebayTokenResult.data);
  const [snapshotSummaryResult, blockedSummaryResult, inventoryStatsResult] =
    supabase
      ? await Promise.all([
          supabase
            .from("tcos_ebay_snapshot_import_decision_summary")
            .select("decision,action,reason,decision_count,latest_decision_at")
            .eq("store_id", storeId)
            .eq("run_id", runId)
            .order("decision_count", { ascending: false })
            .limit(20),
          supabase
            .from("tcos_ebay_missing_sync_decision_summary")
            .select("decision,reason,decision_count,latest_decision_at")
            .eq("store_id", storeId)
            .order("decision_count", { ascending: false })
            .limit(10),
          supabase
            .from("tcos_public_inventory_stats")
            .select(
              "total_products,in_stock_products,sold_out_products,ebay_linked_products,missing_sku_products,latest_ebay_seen_at",
            )
            .eq("store_id", storeId)
            .maybeSingle(),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: null, error: null },
        ];
  const decisionSummary =
    (snapshotSummaryResult.data ?? []) as DecisionSummaryRow[];
  const blockedSummary =
    (blockedSummaryResult.data ?? []) as MissingDecisionSummaryRow[];
  const inventoryStats =
    (inventoryStatsResult.data as PublicInventoryStatsRow | null) ?? null;
  const hasResult =
    params.imported !== undefined ||
    params.markedSold !== undefined ||
    params.skipped !== undefined ||
    params.policyAllowed !== undefined ||
    params.policyNeedsReview !== undefined ||
    params.policyBlocked !== undefined ||
    params.error !== undefined;

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Marketplace Sync
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              eBay Sync Control
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Run controlled eBay import batches, review results, then move to
              category review before increasing batch size.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandLink href="/admin/ebay" label="eBay Health" />
            <CommandLink href="/admin/inventory/category-review" label="Category Review" />
            <CommandLink href="/admin/inventory" label="Inventory V2" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {snapshotSummaryResult.error ||
        blockedSummaryResult.error ||
        inventoryStatsResult.error ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
            eBay sync policy summaries are not available yet. Apply
            `20260630123000_create_ebay_sync_decision_events.sql` to enable
            the TCOS sync decision views.
          </section>
        ) : null}

        {ebayTokenResult.error ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
            eBay token status could not be checked: {ebayTokenResult.error.message}
          </section>
        ) : null}

        <section className="rounded-xl border-4 border-emerald-400 bg-emerald-50 p-6 text-emerald-950 shadow-lg">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-emerald-700">
                Fast lane
              </p>
              <h2 className="mt-2 text-4xl font-black tracking-tight">
                Import ALL active eBay listings
              </h2>
              <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-emerald-900">
                One click runs the full active-listing sync in 100-listing
                batches. TCOS keeps eBay pricing as the starting price and
                flags anything that needs review.
              </p>
            </div>

            <div className="flex min-w-[280px] flex-col gap-2">
              {hasEbayRefreshToken ? (
                <Link
                  href="/admin/ebay/import-runner"
                  className="rounded-xl bg-neutral-950 px-6 py-4 text-center text-base font-black uppercase tracking-[0.08em] text-white hover:bg-neutral-800"
                >
                  Open eBay Import Runner
                </Link>
              ) : (
                <Link
                  href="/api/ebay/auth"
                  className="rounded-xl bg-amber-300 px-6 py-4 text-center text-base font-black uppercase tracking-[0.08em] text-neutral-950 hover:bg-amber-200"
                >
                  Connect eBay First
                </Link>
              )}
              <Link
                href="/admin/inventory"
                className="rounded-xl border border-emerald-300 bg-white px-6 py-3 text-center text-sm font-black text-emerald-950 hover:bg-emerald-100"
              >
                Open TCOS inventory
              </Link>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Metric
            label="Public Products"
            value={String(inventoryStats?.total_products ?? 0)}
          />
          <Metric
            label="In Stock"
            value={String(inventoryStats?.in_stock_products ?? 0)}
          />
          <Metric
            label="Sold Out"
            value={String(inventoryStats?.sold_out_products ?? 0)}
          />
          <Metric
            label="eBay Linked"
            value={String(inventoryStats?.ebay_linked_products ?? 0)}
          />
          <Metric
            label="Missing SKU"
            value={String(inventoryStats?.missing_sku_products ?? 0)}
          />
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[0.45fr_0.55fr]">
        <section className="rounded-md border border-neutral-200 bg-white p-5">
          <h2 className="text-2xl font-black">Run Batch</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Start small. Batch imports update local TCOS inventory and category
            attributes from eBay, but they do not delete eBay inventory.
          </p>

          <form action={runBatch} className="mt-5 space-y-4">
            <label className="block text-sm font-bold text-neutral-700">
              Offset
              <input
                name="offset"
                type="number"
                min="0"
                defaultValue={currentOffset}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
              />
            </label>

            <label className="block text-sm font-bold text-neutral-700">
              Batch Size
              <select
                name="limit"
                defaultValue={currentLimit}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
              >
                {LIMIT_OPTIONS.map((limit) => (
                  <option key={limit} value={limit}>
                    {limit} listings
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-bold text-neutral-700">
              Run ID
              <input
                name="runId"
                defaultValue={runId}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
              />
            </label>

            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              Recommended flow: run 10 or 25, open Category Review, then
              continue with the next offset if the mapping looks good.
            </div>

            <AdminSubmitButton
              className="w-full rounded-md bg-neutral-950 px-4 py-3 text-sm font-black text-white hover:bg-neutral-800"
              pendingChildren="Running eBay batch..."
            >
              Run eBay Batch
            </AdminSubmitButton>
          </form>
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Last Batch Result</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Use the next offset to continue from the last returned page.
            </p>
          </div>

          {params.error ? (
            <div className="m-5 rounded border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
              {params.error}
            </div>
          ) : hasResult ? (
            <div className="space-y-5 p-5">
              <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric label="Received" value={String(intValue(params.received))} />
                <Metric label="Imported" value={String(intValue(params.imported))} />
                <Metric label="Marked Sold" value={String(intValue(params.markedSold))} />
                <Metric label="Skipped" value={String(intValue(params.skipped))} />
              </section>

              <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Metric
                  label="Policy Allowed"
                  value={String(intValue(params.policyAllowed))}
                />
                <Metric
                  label="Needs Review"
                  value={String(intValue(params.policyNeedsReview))}
                />
                <Metric
                  label="Blocked By TCOS"
                  value={String(intValue(params.policyBlocked))}
                />
              </section>

              <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                <Info label="Current Offset" value={String(safeOffset(params.offset))} />
                <Info label="Next Offset" value={params.nextOffset || "Complete"} />
                <Info label="Batch Size" value={String(currentLimit)} />
              </dl>

              <div className="flex flex-wrap gap-2">
                {params.nextOffset ? (
                  <Link
                    href={resultUrl({
                      offset: params.nextOffset,
                      limit: currentLimit,
                      runId,
                    })}
                    className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50"
                  >
                    Load Next Offset
                  </Link>
                ) : null}
                <Link
                  href="/admin/inventory/category-review"
                  className="rounded-md bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950 hover:bg-amber-200"
                >
                  Review Categories
                </Link>
                <Link
                  href="/admin/ebay"
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  Refresh eBay Health
                </Link>
              </div>
            </div>
          ) : (
            <div className="p-5">
              <div className="rounded border border-dashed border-neutral-300 bg-neutral-50 p-5">
                <p className="text-sm font-semibold text-neutral-700">
                  No batch has been run from this page yet.
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  Run a small batch first, then review category confidence.
                </p>
              </div>
            </div>
          )}
        </section>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <DecisionTable
            title="Current Run Policy Decisions"
            rows={decisionSummary}
            emptyText="No policy decisions recorded for this run ID yet."
          />
          <BlockedDecisionTable
            title="Blocked Policy Summary"
            rows={blockedSummary}
            emptyText="No blocked TCOS policy decisions recorded yet."
          />
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
      <dt className="text-xs font-bold uppercase text-neutral-500">{label}</dt>
      <dd className="mt-1 font-black">{value}</dd>
    </div>
  );
}

function DecisionTable({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: DecisionSummaryRow[];
  emptyText: string;
}) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 p-5">
        <h2 className="text-2xl font-black">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-3">Decision</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Count</th>
              <th className="px-4 py-3">Latest</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-neutral-600" colSpan={5}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.decision}-${row.action}-${row.reason}`}>
                  <td className="px-4 py-4">
                    <span
                      className={`rounded border px-2 py-1 text-xs font-black ${decisionTone(
                        row.decision,
                      )}`}
                    >
                      {decisionLabel(row.decision)}
                    </span>
                  </td>
                  <td className="px-4 py-4">{decisionLabel(row.action)}</td>
                  <td className="px-4 py-4">{decisionLabel(row.reason)}</td>
                  <td className="px-4 py-4 font-black">{row.decision_count}</td>
                  <td className="px-4 py-4">{shortDate(row.latest_decision_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BlockedDecisionTable({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: MissingDecisionSummaryRow[];
  emptyText: string;
}) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 p-5">
        <h2 className="text-2xl font-black">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-3">Decision</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Count</th>
              <th className="px-4 py-3">Latest</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-neutral-600" colSpan={4}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.decision}-${row.reason}`}>
                  <td className="px-4 py-4">
                    <span
                      className={`rounded border px-2 py-1 text-xs font-black ${decisionTone(
                        row.decision,
                      )}`}
                    >
                      {decisionLabel(row.decision)}
                    </span>
                  </td>
                  <td className="px-4 py-4">{decisionLabel(row.reason)}</td>
                  <td className="px-4 py-4 font-black">{row.decision_count}</td>
                  <td className="px-4 py-4">{shortDate(row.latest_decision_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CommandLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold hover:bg-white/10"
    >
      {label}
    </Link>
  );
}
