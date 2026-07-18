import Link from "next/link";
import { redirect } from "next/navigation";
import AdminSubmitButton from "../AdminSubmitButton";
import BulkDescriptionEditor from "./BulkDescriptionEditor";
import {
  adminProductActionFailureMessage,
  adminProductStatusZeroesQuantity,
  adminProductStatusSuccessMessage,
  parseAdminProductId,
} from "../../../lib/admin-product-status";
import { createServerInventoryEngine } from "../../../lib/server-inventory-engine";
import type { UniversalInventoryItem } from "../../../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseBulkDescriptionMode(value: FormDataEntryValue | null) {
  const mode = String(value || "append");

  return mode === "replace" || mode === "prepend" || mode === "append"
    ? mode
    : "append";
}

function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value || 0));
}

function statusTone(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }

  if (normalized === "archived" || normalized === "sold") {
    return "border-neutral-200 bg-neutral-100 text-neutral-700";
  }

  if (normalized.includes("review") || normalized.includes("draft")) {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  return "border-sky-200 bg-sky-50 text-sky-950";
}

function productActionErrorPath(message: string) {
  return `/admin/products?saveError=${encodeURIComponent(message.slice(0, 240))}`;
}

async function endProductEarly(formData: FormData) {
  "use server";

  const id = parseAdminProductId(formData.get("id"));

  if (!id) {
    redirect(productActionErrorPath("Invalid product ID."));
  }

  let failure: string | null = null;

  try {
    await createServerInventoryEngine().setStatus({
      legacyProductId: id,
      status: "archived",
    });
  } catch (error) {
    failure = adminProductActionFailureMessage(
      error,
      "Could not end/archive this product.",
    );
  }

  if (failure) {
    redirect(productActionErrorPath(failure));
  }

  redirect(`/admin/products?statusEnded=${id}`);
}

async function bulkUpdateDescriptions(formData: FormData) {
  "use server";

  const ids = Array.from(new Set(
    formData
      .getAll("product_ids")
      .map((value) => Number(value || 0))
      .filter((value) => Number.isInteger(value) && value > 0),
  )).slice(0, 500);
  const descriptionPatch = String(formData.get("description") || "").trim();
  const mode = parseBulkDescriptionMode(formData.get("mode"));

  if (ids.length === 0 || descriptionPatch.length === 0) {
    redirect("/admin/products?bulkError=missing_selection_or_description");
  }

  const engine = createServerInventoryEngine();
  let updated = 0;

  for (const id of ids) {
    const product = await engine.getByLegacyProductId(id);

    if (!product) continue;

    const currentDescription = product.description?.trim() || "";
    const nextDescription =
      mode === "replace"
        ? descriptionPatch
        : mode === "prepend"
          ? [descriptionPatch, currentDescription].filter(Boolean).join("\n\n")
          : [currentDescription, descriptionPatch].filter(Boolean).join("\n\n");

    await engine.updateProduct(id, {
      title: product.title,
      player: product.player,
      sport: product.sport,
      price: product.price,
      quantity: product.quantity,
      status: product.status,
      imageUrl: product.imageUrl,
      description: nextDescription,
      authenticity: product.authenticity,
    });
    updated += 1;
  }

  redirect(`/admin/products?bulkUpdated=${updated}`);
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    bulkUpdated?: string;
    bulkError?: string;
    saveError?: string;
    statusEnded?: string;
  }>;
}) {
  const query = await searchParams;
  let products: UniversalInventoryItem[] = [];
  let error: Error | null = null;

  try {
    products = await createServerInventoryEngine().listAll();
  } catch (err: any) {
    error = err;
  }

  if (error) {
    const loadFailure = adminProductActionFailureMessage(
      error,
      "Could not load products.",
    );

    return (
      <main className="bg-neutral-50 px-6 py-8 text-neutral-950">
        <section className="mx-auto max-w-4xl rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">
            Admin products
          </p>
          <h1 className="mt-2 text-3xl font-black">Error loading products</h1>
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-950">
            {loadFailure}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/admin/products"
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white"
            >
              Retry
            </Link>
            <Link
              href="/admin"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black"
            >
              Admin dashboard
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const activeCount = products.filter((product) => product.status === "active").length;
  const totalQuantity = products.reduce(
    (sum, product) => sum + Math.max(0, Number(product.quantity || 0)),
    0,
  );
  const totalValue = products.reduce(
    (sum, product) =>
      sum +
      Math.max(0, Number(product.quantity || 0)) *
        Math.max(0, Number(product.price || 0)),
    0,
  );

  return (
    <main className="space-y-6 bg-neutral-50 px-6 py-8 text-neutral-950">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              Inventory control
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Admin products
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
              Review TCOS inventory, bulk-apply reusable descriptions, and open
              individual product records for price, quantity, media, and
              authenticity cleanup.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/products/new"
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
            >
              Add product
            </Link>
            <Link
              href="/admin/ebay/inventory-intake"
              className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-950 hover:bg-emerald-100"
            >
              eBay intake
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

      {query?.bulkUpdated && (
        <div className="rounded border border-green-300 bg-green-50 p-4 font-bold text-green-800">
          Updated descriptions on {query.bulkUpdated} product
          {query.bulkUpdated === "1" ? "" : "s"}.
        </div>
      )}

      {query?.bulkError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded border border-red-300 bg-red-50 p-4 font-bold text-red-800"
        >
          Select at least one product and paste a description/code block first.
        </div>
      )}

      {query?.saveError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded border border-red-300 bg-red-50 p-4 font-bold text-red-800"
        >
          Product action needs attention: {query.saveError}
        </div>
      )}

      {query?.statusEnded && (
        <div
          role="status"
          aria-live="polite"
          className="rounded border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-800"
        >
          Product #{query.statusEnded}: {adminProductStatusSuccessMessage("archived")}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-3">
        <Metric label="Total products" value={String(products.length)} />
        <Metric label="Active rows" value={String(activeCount)} tone="emerald" />
        <Metric label="On-hand value" value={money(totalValue)} tone="sky" />
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
            Bulk tools
          </p>
          <h2 className="mt-2 text-2xl font-black">Description updater</h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-600">
            Select rows below and append, prepend, or replace reusable listing
            language without opening every product one at a time.
          </p>
        </div>
        <BulkDescriptionEditor
          products={products.map((product) => ({
            legacyProductId: product.legacyProductId,
            title: product.title,
            price: product.price,
            status: product.status,
          }))}
          action={bulkUpdateDescriptions}
        />
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Inventory rows
            </p>
            <h2 className="mt-2 text-2xl font-black">Product records</h2>
          </div>
          <p className="text-sm font-bold text-neutral-600">
            {totalQuantity} total unit{totalQuantity === 1 ? "" : "s"} on hand
          </p>
        </div>

        {products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
            <h3 className="text-xl font-black">No products yet</h3>
            <p className="mt-2 text-sm font-semibold text-neutral-600">
              Add a manual product or use InstaComp™ / eBay intake to start the
              working inventory list.
            </p>
            <Link
              href="/admin/products/new"
              className="mt-4 inline-block rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white"
            >
              Add first product
            </Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {products.map((product) => (
              <article
                key={product.legacyProductId}
                className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-black">{product.title}</h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-black ${statusTone(
                          product.status,
                        )}`}
                      >
                        {product.status || "unknown"}
                      </span>
                    </div>
                    <dl className="mt-3 grid gap-2 text-sm font-semibold text-neutral-700 sm:grid-cols-2 lg:grid-cols-4">
                      <ProductFact label="Price" value={money(product.price)} />
                      <ProductFact label="Quantity" value={String(product.quantity)} />
                      <ProductFact label="Source" value={product.source || "manual"} />
                      <ProductFact label="Player" value={product.player || "—"} />
                      <ProductFact label="Sport" value={product.sport || "—"} />
                      <ProductFact
                        label="Legacy ID"
                        value={String(product.legacyProductId)}
                      />
                    </dl>
                  </div>

                  <div className="flex flex-wrap gap-2 md:flex-col md:items-stretch">
                    <Link
                      href={`/admin/products/${product.legacyProductId}`}
                      className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-center text-sm font-black hover:bg-neutral-100"
                    >
                      Edit product
                    </Link>

                    {adminProductStatusZeroesQuantity(product.status) ? (
                      <span
                        className="rounded-md border border-neutral-200 bg-neutral-100 px-4 py-2 text-center text-sm font-black text-neutral-500"
                        title={`This product is already ${product.status}; ended statuses are removed from active inventory and should carry quantity 0.`}
                      >
                        {product.status === "sold" ? "Ended / Sold" : "Ended / Archived"}
                      </span>
                    ) : (
                      <form action={endProductEarly}>
                        <input
                          type="hidden"
                          name="id"
                          value={product.legacyProductId}
                        />
                        <AdminSubmitButton
                          className="w-full rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-center text-sm font-black text-rose-950 hover:bg-rose-100"
                          pendingChildren="Ending item..."
                          title="End this product early, archive it, and set quantity to 0."
                        >
                          End early
                        </AdminSubmitButton>
                      </form>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
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

function ProductFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-black uppercase tracking-[0.12em] text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}
