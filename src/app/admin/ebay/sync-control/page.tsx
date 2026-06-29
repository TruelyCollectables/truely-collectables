import Link from "next/link";
import { redirect } from "next/navigation";
import { importEbayListingsPage } from "../../../../lib/ebay-sync";

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
  nextOffset?: string;
  error?: string;
};

const LIMIT_OPTIONS = [10, 25, 50, 100];

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

export default async function EbaySyncControlPage({
  searchParams,
}: {
  searchParams?: Promise<SyncSearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const currentOffset = safeOffset(params.nextOffset ?? params.offset ?? "0");
  const currentLimit = safeLimit(params.limit ?? "25");
  const runId = params.runId || new Date().toISOString();
  const hasResult =
    params.imported !== undefined ||
    params.markedSold !== undefined ||
    params.skipped !== undefined ||
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

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[0.45fr_0.55fr]">
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

            <button
              type="submit"
              className="w-full rounded-md bg-neutral-950 px-4 py-3 text-sm font-black text-white hover:bg-neutral-800"
            >
              Run eBay Batch
            </button>
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
