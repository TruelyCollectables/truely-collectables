import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import AdminSubmitButton from "../../AdminSubmitButton";
import {
  AUTHENTICITY_STATUSES,
  AUTOGRAPH_SOURCES,
  authenticityStatusLabel,
  autographSourceLabel,
} from "../../../../lib/authenticity";
import {
  ADMIN_INVENTORY_STATUSES,
  adminProductStatusChangeError,
  adminProductStatusPendingLabel,
  adminProductStatusRequiresStock,
  adminProductStatusSuccessMessage,
  parseAdminInventoryStatus,
  parseAdminProductId,
} from "../../../../lib/admin-product-status";
import { createAdminSessionValue } from "../../../../lib/admin-session";
import { createServerInventoryEngine } from "../../../../lib/server-inventory-engine";
import type { InventoryStatus } from "../../../../modules/inventory";
import { getSalesCompHistory, getSalesComps } from "../../../../lib/ebay";
import type {
  SalesCompHistoryResult,
  SalesCompSummary,
} from "../../../../lib/ebay";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function textValue(value: string | null) {
  return value ?? "";
}

function adminHref(href: string, handoff: string) {
  const [path, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);

  params.set("admin_handoff", handoff);

  return `${path}?${params.toString()}`;
}

function readableProductActionFailure(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 240);
  }

  return fallbackMessage;
}

function productSaveErrorPath(id: number, message: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params);

  query.set("saveError", message.slice(0, 240));

  return `/admin/products/${id}?${query.toString()}`;
}

function productsSaveErrorPath(message: string) {
  return `/admin/products?saveError=${encodeURIComponent(message.slice(0, 240))}`;
}

async function setProductStatus(formData: FormData) {
  "use server";

  const adminInventoryEngine = createServerInventoryEngine();
  const rawId = formData.get("id");
  const rawStatus = formData.get("status");
  const id = parseAdminProductId(rawId);
  const status = parseAdminInventoryStatus(rawStatus);
  const error = adminProductStatusChangeError({
    productId: rawId,
    status: rawStatus,
  });

  if (error) {
    redirect(
      id
        ? `/admin/products/${id}?saveError=${encodeURIComponent(error)}`
        : `/admin/products?saveError=${encodeURIComponent(error)}`,
    );
  }

  let failure: string | null = null;

  try {
    await adminInventoryEngine.setStatus({
      legacyProductId: id!,
      status: status!,
    });
  } catch (error) {
    failure = readableProductActionFailure(
      error,
      "Could not update product status.",
    );
  }

  if (failure) {
    redirect(productSaveErrorPath(id!, failure));
  }

  redirect(`/admin/products/${id}?statusSaved=${status}`);
}

async function regenerateDescription(formData: FormData) {
  "use server";

  const adminInventoryEngine = createServerInventoryEngine();
  const id = parseAdminProductId(formData.get("id"));

  if (!id) {
    redirect(productsSaveErrorPath("Invalid product ID."));
  }

  let failure: string | null = null;

  try {
    await adminInventoryEngine.regenerateDescription(id);
  } catch (error) {
    failure = readableProductActionFailure(
      error,
      "Could not auto-fill the product description.",
    );
  }

  if (failure) {
    redirect(productSaveErrorPath(id, failure));
  }

  redirect(`/admin/products/${id}`);
}

async function generateAiDescription(formData: FormData) {
  "use server";

  const adminInventoryEngine = createServerInventoryEngine();
  const id = parseAdminProductId(formData.get("id"));

  if (!id) {
    redirect(productsSaveErrorPath("Invalid product ID."));
  }

  let failure: string | null = null;

  try {
    await adminInventoryEngine.generateAiDescription(id);
  } catch (error) {
    failure = readableProductActionFailure(
      error,
      "Could not write the AI product description.",
    );
  }

  if (failure) {
    redirect(productSaveErrorPath(id, failure));
  }

  redirect(`/admin/products/${id}`);
}

async function applySuggestedPrice(formData: FormData) {
  "use server";

  const adminInventoryEngine = createServerInventoryEngine();
  const id = parseAdminProductId(formData.get("id"));

  if (!id) {
    redirect(productsSaveErrorPath("Invalid product ID."));
  }

  const product = await adminInventoryEngine.getByLegacyProductId(id);

  if (!product) {
    redirect(productsSaveErrorPath("Product was not found."));
  }

  let failure: string | null = null;
  let suggestedPrice: number | null = null;

  try {
    const salesComps = await getSalesComps({
      title: product.title,
      player: product.player,
      sport: product.sport,
      legacyProductId: product.legacyProductId,
      limit: 12,
    });

    suggestedPrice = salesComps.suggestedPrice ?? null;

    if (!suggestedPrice) {
      failure = "No suggested price is available from the latest comps.";
    } else {
      await adminInventoryEngine.updateProduct(id, {
        title: product.title,
        player: product.player,
        sport: product.sport,
        price: suggestedPrice,
        quantity: product.quantity,
        status: product.status,
        imageUrl: product.imageUrl,
        description: product.description,
        authenticity: product.authenticity,
      });
    }
  } catch (error) {
    failure = readableProductActionFailure(
      error,
      "Could not apply the suggested price.",
    );
  }

  if (failure) {
    redirect(productSaveErrorPath(id, failure, { comps: "true" }));
  }

  redirect(`/admin/products/${id}?comps=true`);
}

export default async function AdminProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    comps?: string;
    saved?: string;
    saveError?: string;
    statusSaved?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const adminInventoryEngine = createServerInventoryEngine();
  const adminHandoff = await createAdminSessionValue();
  const product = await adminInventoryEngine.getByLegacyProductId(Number(id));
  const savedStatus = parseAdminInventoryStatus(query?.statusSaved);

  if (!product) {
    return (
      <main className="bg-neutral-50 px-6 py-8 text-neutral-950">
        <section className="mx-auto max-w-4xl rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">
            Product editor
          </p>
          <h1 className="mt-2 text-3xl font-black">Product not found</h1>
          <p className="mt-2 text-sm font-semibold text-neutral-600">
            This product no longer exists or is not available in the active store.
          </p>
          <Link
            href={adminHref("/admin/products", adminHandoff)}
            className="mt-5 inline-block rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white"
          >
            Back to products
          </Link>
        </section>
      </main>
    );
  }

  const shouldLoadComps = query?.comps === "true";
  const salesComps = shouldLoadComps
    ? await getSalesComps({
        title: product.title,
        player: product.player,
        sport: product.sport,
        legacyProductId: product.legacyProductId,
        limit: 12,
      })
    : null;
  const salesCompHistory = await getSalesCompHistory(product.legacyProductId);

  return (
    <main className="space-y-6 bg-neutral-50 px-6 py-8 text-neutral-950">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href={adminHref("/admin/products", adminHandoff)}
            className="text-sm font-black text-neutral-600 underline"
          >
            ← Back to products
          </Link>

          <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
            Product editor
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-tight">
            {product.title}
          </h1>
          <p className="mt-3 text-sm font-semibold text-neutral-600">
            Product #{product.legacyProductId} · {product.source} ·{" "}
            {product.inventoryItemId ? "Inventory linked" : "Inventory item pending"}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/product/${product.legacyProductId}`}
            className="rounded-md border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-black text-sky-950 hover:bg-sky-100"
          >
            View storefront
          </Link>

          <Link
            href="/admin/logout"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
          >
            Logout
          </Link>
        </div>
      </div>
      </section>

      {query?.saved === "1" ? (
        <div
          aria-live="polite"
          className="rounded border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-800"
        >
          Product saved.
        </div>
      ) : null}

      {savedStatus ? (
        <div
          aria-live="polite"
          className="rounded border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-800"
        >
          {adminProductStatusSuccessMessage(savedStatus)}
        </div>
      ) : null}

      {query?.saveError ? (
        <div
          aria-live="assertive"
          className="rounded border border-rose-300 bg-rose-50 p-4 font-bold text-rose-800"
        >
          Save failed: {query.saveError}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="Status" value={product.status} tone="emerald" />
        <Metric label="Price" value={money(product.price)} tone="sky" />
        <Metric label="Quantity" value={String(product.quantity)} />
        <Metric
          label="Value"
          value={money(Number(product.price || 0) * Number(product.quantity || 0))}
        />
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <form
            action={`/api/admin/products/${product.legacyProductId}/save?admin_handoff=${encodeURIComponent(
              adminHandoff,
            )}`}
            method="post"
            className="space-y-5 rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm"
          >
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                Editable listing data
              </p>
              <h2 className="mt-2 text-2xl font-black">Product details</h2>
              <p className="mt-2 text-sm font-semibold text-neutral-600">
                Required fields are validated before save so the admin cannot
                create blank titles, invalid prices, malformed image URLs, or
                broken quantity values.
              </p>
            </div>

            <label className="block">
              <span className="font-bold">Title</span>
              <input
                name="title"
                required
                defaultValue={product.title}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="font-bold">Player</span>
                <input
                  name="player"
                  defaultValue={textValue(product.player)}
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                />
              </label>

              <label className="block">
                <span className="font-bold">Sport</span>
                <input
                  name="sport"
                  defaultValue={textValue(product.sport)}
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="font-bold">Price</span>
                <input
                  name="price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  defaultValue={product.price}
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                />
              </label>

              <label className="block">
                <span className="font-bold">Quantity</span>
                <input
                  name="quantity"
                  type="number"
                  min="0"
                  step="1"
                  required
                  defaultValue={product.quantity}
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                />
              </label>

              <label className="block">
                <span className="font-bold">Status</span>
                <select
                  name="status"
                  defaultValue={product.status}
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                >
                  {ADMIN_INVENTORY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="font-bold">Image URL</span>
              <input
                name="image_url"
                type="url"
                defaultValue={textValue(product.imageUrl)}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                placeholder="https://..."
              />
            </label>

            <label className="block">
              <span className="font-bold">Description</span>
              <textarea
                name="description"
                defaultValue={textValue(product.description)}
                rows={8}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
              />
              <span className="text-sm font-semibold text-neutral-500">
                Leave blank and save to auto-fill from TCOS product data.
              </span>
            </label>

            <section className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                Trust layer
              </p>
              <h2 className="mt-2 text-xl font-black">Authenticity and provenance</h2>
              <p className="mt-2 text-sm font-semibold text-neutral-600">
                Store the exact certification, guarantee, or provenance disclosure
                that should follow this listing everywhere it appears.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="font-bold">Authenticity Status</span>
                  <select
                    name="authenticity_status"
                    defaultValue={product.authenticity.status}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                  >
                    {AUTHENTICITY_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {authenticityStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="font-bold">Autograph Source</span>
                  <select
                    name="autograph_source"
                    defaultValue={product.authenticity.autographSource}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                  >
                    {AUTOGRAPH_SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {autographSourceLabel(source)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="font-bold">Certification Provider</span>
                  <input
                    name="cert_provider"
                    defaultValue={textValue(product.authenticity.certProvider)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                    placeholder="PSA, JSA, Beckett, SGC, CGC"
                  />
                </label>

                <label className="block">
                  <span className="font-bold">Certification Number</span>
                  <input
                    name="cert_number"
                    defaultValue={textValue(product.authenticity.certNumber)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                    placeholder="Certificate or serial lookup number"
                  />
                </label>
              </div>

              <label className="block mt-4">
                <span className="font-bold">Pass Guarantee Authenticators</span>
                <input
                  name="guaranteed_authenticators"
                  defaultValue={product.authenticity.guaranteedAuthenticators.join(", ")}
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                  placeholder="JSA, PSA DNA, Beckett"
                />
                <span className="text-sm font-semibold text-neutral-500">
                  Separate multiple authenticators with commas.
                </span>
              </label>

              <label className="block mt-4">
                <span className="font-bold">Provenance Evidence</span>
                <textarea
                  name="provenance_evidence"
                  defaultValue={textValue(product.authenticity.provenanceEvidence)}
                  rows={3}
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                  placeholder="Envelope, fan-club letter, event ticket, signing photo, receipt, or other support"
                />
              </label>

              <label className="block mt-4">
                <span className="font-bold">Authenticity Notes</span>
                <textarea
                  name="authenticity_notes"
                  defaultValue={textValue(product.authenticity.authenticityNotes)}
                  rows={3}
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
                  placeholder="Anything the buyer should read before purchase"
                />
              </label>
            </section>

            <div className="flex flex-wrap gap-3">
              <AdminSubmitButton
                className="rounded-md bg-neutral-950 px-6 py-3 text-sm font-black text-white hover:bg-neutral-800"
                pendingChildren="Saving product..."
              >
                Save product
              </AdminSubmitButton>
            </div>
          </form>
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Inventory state
            </p>
            <h2 className="mt-2 text-xl font-black">Record health</h2>
            <dl className="mt-4 space-y-3 text-sm font-semibold">
              <SideFact label="Status" value={product.status} />
              <SideFact label="Quantity" value={String(product.quantity)} />
              <SideFact label="SKU" value={product.sku || "Not set"} />
              <SideFact label="eBay listing" value={product.ebayItemId || "Not linked"} />
              <SideFact
                label="Seller owner"
                value={product.sellerAccountId || "Store inventory"}
              />
              <SideFact
                label="Inventory item"
                value={product.inventoryItemId || "Not created yet"}
              />
              <SideFact
                label="Authenticity"
                value={authenticityStatusLabel(product.authenticity.status)}
              />
            </dl>
          </section>

          {product.imageUrl && (
            <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-xl font-black">Image</h2>
              <Image
                src={product.imageUrl}
                alt={product.title}
                width={800}
                height={800}
                unoptimized
                className="h-auto w-full rounded border"
              />
            </section>
          )}

          <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Quick actions
            </p>
            <h2 className="mt-2 text-xl font-black">Quick status</h2>
            <div className="space-y-3">
              <StatusButton
                id={product.legacyProductId}
                currentStatus={product.status}
                quantity={product.quantity}
                status="active"
                label="Set Active"
              />
              <StatusButton
                id={product.legacyProductId}
                currentStatus={product.status}
                quantity={product.quantity}
                status="reserved"
                label="Reserve"
              />
              <StatusButton
                id={product.legacyProductId}
                currentStatus={product.status}
                quantity={product.quantity}
                status="sold"
                label="Mark Sold"
              />
              <StatusButton
                id={product.legacyProductId}
                currentStatus={product.status}
                quantity={product.quantity}
                status="archived"
                label="End Early / Archive"
              />
            </div>
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Description tools
            </p>
            <h2 className="mt-2 text-xl font-black">Description</h2>
            <div className="space-y-3">
              <form action={regenerateDescription}>
                <input type="hidden" name="id" value={product.legacyProductId} />
                <AdminSubmitButton
                  className="w-full rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
                  pendingChildren="Auto-filling..."
                >
                  Auto-fill description
                </AdminSubmitButton>
              </form>

              <form action={generateAiDescription}>
                <input type="hidden" name="id" value={product.legacyProductId} />
                <AdminSubmitButton
                  className="w-full rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
                  pendingChildren="Writing..."
                >
                  AI write description
                </AdminSubmitButton>
              </form>
            </div>
          </section>

          <SalesCompsPanel
            productId={product.legacyProductId}
            adminHandoff={adminHandoff}
            point130Url={`https://130point.com/sales/?search=${encodeURIComponent(
              [product.title, product.player, product.sport]
                .filter(Boolean)
                .join(" ")
            )}`}
            salesComps={salesComps}
            salesCompHistory={salesCompHistory}
          />
        </aside>
      </div>
    </main>
  );
}

function money(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "n/a";
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return "n/a";

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(parsed);
}

function SalesCompsPanel({
  productId,
  adminHandoff,
  point130Url,
  salesComps,
  salesCompHistory,
}: {
  productId: number;
  adminHandoff: string;
  point130Url: string;
  salesComps: SalesCompSummary | null;
  salesCompHistory: SalesCompHistoryResult;
}) {
  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
        Pricing intelligence
      </p>
      <h2 className="mt-2 text-xl font-black">Sales comps</h2>

      <div className="space-y-3">
        <Link
          href={adminHref(`/admin/products/${productId}?comps=true`, adminHandoff)}
          className="block rounded-md bg-neutral-950 px-4 py-2 text-center text-sm font-black text-white hover:bg-neutral-800"
        >
          Check eBay sold comps
        </Link>

        <a
          href={point130Url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-md border border-neutral-300 bg-white px-4 py-2 text-center text-sm font-black hover:bg-neutral-50"
        >
          Open 130point search
        </a>
      </div>

      {!salesComps ? (
        <p className="mt-4 text-sm font-semibold text-neutral-600">
          Load comps to compare recent sold pricing before listing or repricing.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-sm font-semibold">
            <p><span className="font-black">Query:</span> {salesComps.query}</p>
            <p><span className="font-black">eBay:</span> {salesComps.sourceStatus}</p>
            <p><span className="font-black">Google:</span> {salesComps.googleStatus}</p>
            <p>
              <span className="font-black">PriceCharting:</span>{" "}
              {salesComps.priceGuideStatus}
            </p>
            {salesComps.sourceMessage && (
              <p className="text-neutral-600">{salesComps.sourceMessage}</p>
            )}
            {salesComps.googleMessage && (
              <p className="text-neutral-600">{salesComps.googleMessage}</p>
            )}
            {salesComps.priceGuideMessage && (
              <p className="text-neutral-600">{salesComps.priceGuideMessage}</p>
            )}
            {salesComps.snapshotMessage && (
              <p className="text-neutral-600">
                History save: {salesComps.snapshotMessage}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-emerald-800">Suggested</p>
              <p className="font-bold">{money(salesComps.suggestedPrice)}</p>
            </div>
            <div className="rounded border border-neutral-200 p-3">
              <p className="text-neutral-500">Count</p>
              <p className="font-bold">{salesComps.count}</p>
            </div>
            <div className="rounded border border-neutral-200 p-3">
              <p className="text-neutral-500">Median</p>
              <p className="font-bold">{money(salesComps.medianPrice)}</p>
            </div>
            <div className="rounded border border-neutral-200 p-3">
              <p className="text-neutral-500">Average</p>
              <p className="font-bold">{money(salesComps.averagePrice)}</p>
            </div>
            <div className="col-span-2 rounded border border-neutral-200 p-3">
              <p className="text-neutral-500">Range</p>
              <p className="font-bold">
                {money(salesComps.lowPrice)} - {money(salesComps.highPrice)}
              </p>
            </div>
          </div>

          {salesComps.suggestedPriceMethod && (
            <p className="text-sm font-semibold text-neutral-600">
              {salesComps.suggestedPriceMethod}. Recent comps used:{" "}
              {salesComps.recentCompCount}.
            </p>
          )}

          {salesComps.suggestedPrice && (
            <form action={applySuggestedPrice}>
              <input type="hidden" name="id" value={productId} />
              <AdminSubmitButton
                className="w-full rounded-md bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-800"
                pendingChildren="Applying price..."
              >
                Apply suggested price
              </AdminSubmitButton>
            </form>
          )}

          {salesComps.comps.length === 0 ? (
            <p className="text-sm font-semibold text-neutral-600">No sold comps found.</p>
          ) : (
            <div className="space-y-3">
              {salesComps.comps.slice(0, 6).map((comp, index) => (
                <a
                  key={`${comp.title}-${index}`}
                  href={comp.itemUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded border border-neutral-200 bg-neutral-50 p-3 text-sm hover:bg-neutral-100"
                >
                  <p className="font-bold">{comp.title}</p>
                  <p>
                    {money(comp.price)} - {comp.source}
                  </p>
                  {comp.soldAt && (
                    <p className="text-neutral-500">
                      Sold {new Date(comp.soldAt).toLocaleDateString()}
                    </p>
                  )}
                </a>
              ))}
            </div>
          )}

          {salesComps.googleResults.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-bold">Google results</h3>
              {salesComps.googleResults.slice(0, 5).map((result) => (
                <a
                  key={result.url}
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded border border-neutral-200 bg-neutral-50 p-3 text-sm hover:bg-neutral-100"
                >
                  <p className="font-bold">{result.title}</p>
                  {result.snippet && (
                    <p className="text-neutral-600">{result.snippet}</p>
                  )}
                </a>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <h3 className="font-bold">Research links</h3>
            {salesComps.researchLinks.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded border border-neutral-200 bg-white px-4 py-2 text-sm font-bold hover:bg-neutral-50"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        <h3 className="font-bold">Comps history</h3>
        {salesCompHistory.status === "unavailable" && (
          <p className="text-sm font-semibold text-neutral-600">{salesCompHistory.message}</p>
        )}

        {salesCompHistory.entries.length === 0 ? (
          <p className="text-sm font-semibold text-neutral-600">No saved comp checks yet.</p>
        ) : (
          <div className="space-y-3">
            {salesCompHistory.entries.map((entry) => (
              <div key={entry.id} className="rounded border border-neutral-200 p-3 text-sm">
                <p className="font-bold">{money(entry.suggestedPrice)}</p>
                <p>{new Date(entry.createdAt).toLocaleString()}</p>
                <p>Comps: {entry.compCount}</p>
                <p>Recent comps: {entry.recentCompCount}</p>
                <p>
                  Median: {money(entry.medianPrice)} / Average:{" "}
                  {money(entry.averagePrice)}
                </p>
                <p className="text-neutral-600">{entry.suggestedPriceMethod}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function StatusButton({
  currentStatus,
  id,
  quantity,
  status,
  label,
}: {
  currentStatus: InventoryStatus;
  id: number;
  quantity: number;
  status: InventoryStatus;
  label: string;
}) {
  const isCurrent = currentStatus === status;
  const blockedForStock = adminProductStatusRequiresStock(status) && quantity <= 0;
  const isDisabled = isCurrent || blockedForStock;
  const title = isCurrent
    ? `Already ${status}.`
    : blockedForStock
      ? "Set quantity to at least 1 in the product form before making this active or reserved."
      : adminProductStatusSuccessMessage(status);

  return (
    <form action={setProductStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <AdminSubmitButton
        disabled={isDisabled}
        title={title}
        className={`w-full rounded-md px-4 py-2 text-sm font-black disabled:cursor-not-allowed ${
          isCurrent
            ? "border border-emerald-200 bg-emerald-50 text-emerald-950"
            : blockedForStock
              ? "border border-amber-200 bg-amber-50 text-amber-950"
            : "border border-neutral-300 bg-white hover:bg-neutral-50"
        }`}
        pendingChildren={adminProductStatusPendingLabel(status)}
      >
        {isCurrent
          ? `Current: ${label}`
          : blockedForStock
            ? "Qty required first"
            : label}
      </AdminSubmitButton>
      {blockedForStock ? (
        <p className="mt-1 text-xs font-black text-amber-800">
          Quantity must be at least 1 before {status}.
        </p>
      ) : null}
    </form>
  );
}

function Metric({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "emerald" | "sky";
  value: string;
}) {
  const className =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "sky"
        ? "border-sky-200 bg-sky-50 text-sky-950"
        : "border-neutral-200 bg-white text-neutral-950";

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${className}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em] opacity-70">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function SideFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-neutral-100 pb-2 last:border-b-0 last:pb-0">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="max-w-[60%] break-words text-right font-black">{value}</dd>
    </div>
  );
}
