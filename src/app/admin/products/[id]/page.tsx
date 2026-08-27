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
  adminProductActionFailureMessage,
  adminProductStatusChangeError,
  adminProductStatusPendingLabel,
  adminProductStatusRequiresStock,
  adminProductStatusSuccessMessage,
  adminProductStatusZeroesQuantity,
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

const fieldClassName =
  "mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm font-semibold text-neutral-950 shadow-inner shadow-neutral-100 outline-none transition focus:border-neutral-950 focus:ring-4 focus:ring-neutral-950/10";
const labelClassName = "block text-sm font-black text-neutral-800";
const stackedLabelClassName = `${labelClassName} mt-4`;

function textValue(value: string | null) {
  return value ?? "";
}

function productStatusLabel(status: InventoryStatus | string) {
  return String(status || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function productStatusTone(
  status: InventoryStatus,
  quantity: number,
): "neutral" | "emerald" | "sky" | "amber" | "rose" {
  if (adminProductStatusZeroesQuantity(status)) return "neutral";
  if (adminProductStatusRequiresStock(status) && quantity <= 0) return "amber";
  if (status === "active") return "emerald";
  if (status === "reserved") return "sky";

  return "neutral";
}

function productAvailabilityPosture(status: InventoryStatus, quantity: number) {
  if (adminProductStatusZeroesQuantity(status)) {
    return {
      detail: "Buyer availability is off and quantity should stay at 0.",
      label: "Off-market",
    };
  }

  if (adminProductStatusRequiresStock(status) && quantity <= 0) {
    return {
      detail: "Set quantity before making this buyer-available.",
      label: "Needs stock",
    };
  }

  if (status === "active") {
    return {
      detail: "Visible to buyers with stock available.",
      label: "Buyer-available",
    };
  }

  if (status === "reserved") {
    return {
      detail: "Held out of normal buyer flow for a pending claim.",
      label: "Reserved",
    };
  }

  return {
    detail: "Not yet buyer-facing.",
    label: "Review state",
  };
}

function adminHref(href: string, handoff: string) {
  const [path, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);

  params.set("admin_handoff", handoff);

  return `${path}?${params.toString()}`;
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
    failure = adminProductActionFailureMessage(
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
    failure = adminProductActionFailureMessage(
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
    failure = adminProductActionFailureMessage(
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
    failure = adminProductActionFailureMessage(
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
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#ecfdf5,_transparent_28%),linear-gradient(180deg,_#f8fafc,_#f5f5f4)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-4xl rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">
            Product editor
          </p>
          <h1 className="mt-2 text-3xl font-black">Product not found</h1>
          <p className="mt-2 text-sm font-semibold text-neutral-600">
            This product no longer exists or is not available in the active store.
          </p>
          <Link
            href={adminHref("/admin/products", adminHandoff)}
            className="mt-5 inline-flex rounded-xl bg-neutral-950 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-neutral-800"
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
  const quantity = Math.max(0, Number(product.quantity || 0));
  const inventoryValue = Number(product.price || 0) * quantity;
  const statusTone = productStatusTone(product.status, quantity);
  const availabilityPosture = productAvailabilityPosture(product.status, quantity);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#ecfdf5,_transparent_28%),linear-gradient(180deg,_#f8fafc,_#f5f5f4)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <section className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 shadow-2xl shadow-neutral-950/10">
          <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.28),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-4xl">
                <Link
                  href={adminHref("/admin/products", adminHandoff)}
                  className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
                >
                  ← Back to products
                </Link>

                <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
                  Product command desk
                </p>
                <h1 className="mt-3 text-4xl font-black tracking-tight text-white lg:text-5xl">
                  {product.title}
                </h1>
                <p className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-300">
                  <span>Product #{product.legacyProductId}</span>
                  <span aria-hidden="true">·</span>
                  <span>{product.source}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {product.inventoryItemId ? "Inventory linked" : "Inventory item pending"}
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-white">
                    {productStatusLabel(product.status)}
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/product/${product.legacyProductId}`}
                  className="rounded-full border border-sky-300/30 bg-sky-300/10 px-4 py-2 text-sm font-black text-sky-100 shadow-sm transition hover:bg-sky-300/20"
                >
                  View storefront
                </Link>

                <Link
                  href="/admin/logout"
                  className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
                >
                  Logout
                </Link>
              </div>
            </div>
          </div>

          <div className="grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            <HeaderStat
              label="Status"
              value={productStatusLabel(product.status)}
              detail={availabilityPosture.detail}
              tone={statusTone}
            />
            <HeaderStat
              label="Availability"
              value={availabilityPosture.label}
              detail="No-dead-end controls keep stock and buyer state aligned."
              tone={statusTone}
            />
            <HeaderStat
              label="Quantity"
              value={String(quantity)}
              detail={quantity === 1 ? "single item on hand" : "items on hand"}
            />
            <HeaderStat
              label="Inventory value"
              value={money(inventoryValue)}
              detail="Current price multiplied by available quantity."
              tone="sky"
            />
          </div>
        </section>

      {query?.saved === "1" ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-900 shadow-sm"
        >
          Product saved.
        </div>
      ) : null}

      {savedStatus ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-900 shadow-sm"
        >
          {adminProductStatusSuccessMessage(savedStatus)}
        </div>
      ) : null}

      {query?.saveError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-2xl border border-rose-300 bg-rose-50 p-4 font-bold text-rose-900 shadow-sm"
        >
          Product action needs attention: {query.saveError}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="Status" value={productStatusLabel(product.status)} tone={statusTone} />
        <Metric label="Buyer availability" value={availabilityPosture.label} tone={statusTone} />
        <Metric label="Price" value={money(product.price)} tone="sky" />
        <Metric
          label="Value"
          value={money(inventoryValue)}
          tone={inventoryValue > 0 ? "sky" : "neutral"}
        />
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <form
            action={`/api/admin/products/${product.legacyProductId}/save?admin_handoff=${encodeURIComponent(
              adminHandoff,
            )}`}
            method="post"
            className="space-y-5 rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]"
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

            <label className={labelClassName}>
              <span className="font-bold">Title</span>
              <input
                name="title"
                required
                defaultValue={product.title}
                className={fieldClassName}
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className={labelClassName}>
                <span className="font-bold">Player</span>
                <input
                  name="player"
                  defaultValue={textValue(product.player)}
                  className={fieldClassName}
                />
              </label>

              <label className={labelClassName}>
                <span className="font-bold">Sport</span>
                <input
                  name="sport"
                  defaultValue={textValue(product.sport)}
                  className={fieldClassName}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className={labelClassName}>
                <span className="font-bold">Price</span>
                <input
                  name="price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  defaultValue={product.price}
                  className={fieldClassName}
                />
              </label>

              <label className={labelClassName}>
                <span className="font-bold">Quantity</span>
                <input
                  name="quantity"
                  type="number"
                  min="0"
                  step="1"
                  required
                  defaultValue={product.quantity}
                  className={fieldClassName}
                />
              </label>

              <label className={labelClassName}>
                <span className="font-bold">Status</span>
                <select
                  name="status"
                  defaultValue={product.status}
                  className={fieldClassName}
                >
                  {ADMIN_INVENTORY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className={labelClassName}>
              <span className="font-bold">Image URL</span>
              <input
                name="image_url"
                type="url"
                defaultValue={textValue(product.imageUrl)}
                className={fieldClassName}
                placeholder="https://..."
              />
            </label>

            <label className={labelClassName}>
              <span className="font-bold">Description</span>
              <textarea
                name="description"
                defaultValue={textValue(product.description)}
                rows={8}
                className={fieldClassName}
              />
              <span className="text-sm font-semibold text-neutral-500">
                Leave blank and save to auto-fill from TCOS product data.
              </span>
            </label>

            <section className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-neutral-50 to-white p-5 shadow-inner shadow-neutral-100">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                Trust layer
              </p>
              <h2 className="mt-2 text-xl font-black">Authenticity and provenance</h2>
              <p className="mt-2 text-sm font-semibold text-neutral-600">
                Store the exact certification, guarantee, or provenance disclosure
                that should follow this listing everywhere it appears.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className={labelClassName}>
                  <span className="font-bold">Authenticity Status</span>
                  <select
                    name="authenticity_status"
                    defaultValue={product.authenticity.status}
                    className={fieldClassName}
                  >
                    {AUTHENTICITY_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {authenticityStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={labelClassName}>
                  <span className="font-bold">Autograph Source</span>
                  <select
                    name="autograph_source"
                    defaultValue={product.authenticity.autographSource}
                    className={fieldClassName}
                  >
                    {AUTOGRAPH_SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {autographSourceLabel(source)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={labelClassName}>
                  <span className="font-bold">Certification Provider</span>
                  <input
                    name="cert_provider"
                    defaultValue={textValue(product.authenticity.certProvider)}
                    className={fieldClassName}
                    placeholder="PSA, JSA, Beckett, SGC, CGC"
                  />
                </label>

                <label className={labelClassName}>
                  <span className="font-bold">Certification Number</span>
                  <input
                    name="cert_number"
                    defaultValue={textValue(product.authenticity.certNumber)}
                    className={fieldClassName}
                    placeholder="Certificate or serial lookup number"
                  />
                </label>
              </div>

              <label className={stackedLabelClassName}>
                <span className="font-bold">Pass Guarantee Authenticators</span>
                <input
                  name="guaranteed_authenticators"
                  defaultValue={product.authenticity.guaranteedAuthenticators.join(", ")}
                  className={fieldClassName}
                  placeholder="JSA, PSA DNA, Beckett"
                />
                <span className="text-sm font-semibold text-neutral-500">
                  Separate multiple authenticators with commas.
                </span>
              </label>

              <label className={stackedLabelClassName}>
                <span className="font-bold">Provenance Evidence</span>
                <textarea
                  name="provenance_evidence"
                  defaultValue={textValue(product.authenticity.provenanceEvidence)}
                  rows={3}
                  className={fieldClassName}
                  placeholder="Envelope, fan-club letter, event ticket, signing photo, receipt, or other support"
                />
              </label>

              <label className={stackedLabelClassName}>
                <span className="font-bold">Authenticity Notes</span>
                <textarea
                  name="authenticity_notes"
                  defaultValue={textValue(product.authenticity.authenticityNotes)}
                  rows={3}
                  className={fieldClassName}
                  placeholder="Anything the buyer should read before purchase"
                />
              </label>
            </section>

            <div className="flex flex-wrap gap-3">
              <AdminSubmitButton
                className="rounded-xl bg-neutral-950 px-6 py-3 text-sm font-black text-white shadow-sm transition hover:bg-neutral-800"
                pendingChildren="Saving product..."
                title="Save the edited product fields, including pricing, quantity, status, images, and authenticity notes."
              >
                Save product
              </AdminSubmitButton>
              <p className="w-full text-xs font-bold text-neutral-600">
                Saves the form values on this page. Status rules still apply: active/reserved
                products need quantity, while sold/archived inventory is forced to quantity 0.
              </p>
            </div>
          </form>
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Inventory state
            </p>
            <h2 className="mt-2 text-xl font-black">Record health</h2>
            <dl className="mt-4 space-y-3 text-sm font-semibold">
              <SideFact label="Status" value={productStatusLabel(product.status)} />
              <SideFact label="Availability" value={availabilityPosture.label} />
              <SideFact label="Quantity" value={String(quantity)} />
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
            <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
              <h2 className="mb-3 text-xl font-black">Image</h2>
              <Image
                src={product.imageUrl}
                alt={product.title}
                width={800}
                height={800}
                unoptimized
                className="h-auto w-full rounded-2xl border border-neutral-200 shadow-sm"
              />
            </section>
          )}

          <section className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Quick actions
            </p>
            <h2 className="mt-2 text-xl font-black">Quick status</h2>
            <p className="mt-2 text-sm font-semibold text-neutral-600">
              Sold and archived actions intentionally remove the item from buyer
              availability and force quantity to 0.
            </p>
            <div
              className={`mt-4 rounded-3xl border p-4 shadow-inner ${
                adminProductStatusZeroesQuantity(product.status)
                  ? "border-neutral-200 bg-neutral-50 text-neutral-800"
                  : "border-rose-200 bg-rose-50 text-rose-950"
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-widest opacity-70">
                Inventory removal lane
              </p>
              <h3 className="mt-1 text-lg font-black">
                {adminProductStatusZeroesQuantity(product.status)
                  ? "This item is already ended"
                  : "End early without leaving phantom stock"}
              </h3>
              <p className="mt-2 text-sm font-semibold leading-6 opacity-85">
                {adminProductStatusZeroesQuantity(product.status)
                  ? `Current status is ${product.status}; buyer availability is off and quantity should remain 0.`
                  : `Use End Early / Archive / Zero Qty to remove this product from buyer availability and change quantity ${Math.max(
                      0,
                      Number(product.quantity || 0),
                    )} → 0 in one guarded action.`}
              </p>
            </div>
            <div className="mt-4 space-y-3">
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

          <section className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Description tools
            </p>
            <h2 className="mt-2 text-xl font-black">Description</h2>
            <div className="space-y-3">
              <form action={regenerateDescription}>
                <input type="hidden" name="id" value={product.legacyProductId} />
                <AdminSubmitButton
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black shadow-sm transition hover:bg-neutral-50"
                  pendingChildren="Auto-filling..."
                  title="Replace the product description with the standard TCOS template using this product's current saved facts."
                >
                  Auto-fill description
                </AdminSubmitButton>
                <p className="mt-1 text-xs font-bold text-neutral-600">
                  Rewrites only the description from saved product facts; review the text before publishing.
                </p>
              </form>

              <form action={generateAiDescription}>
                <input type="hidden" name="id" value={product.legacyProductId} />
                <AdminSubmitButton
                  className="w-full rounded-xl bg-neutral-950 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-neutral-800"
                  pendingChildren="Writing..."
                  title="Draft a concise description from saved product facts, falling back to the standard template if AI is unavailable."
                >
                  AI write description
                </AdminSubmitButton>
                <p className="mt-1 text-xs font-bold text-neutral-600">
                  Uses only saved product facts and falls back to the standard template if AI cannot run.
                </p>
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

function HeaderStat({
  detail,
  label,
  tone = "neutral",
  value,
}: {
  detail: string;
  label: string;
  tone?: "neutral" | "emerald" | "sky" | "amber" | "rose";
  value: string;
}) {
  const accentClassName =
    tone === "emerald"
      ? "text-emerald-200"
      : tone === "sky"
        ? "text-sky-200"
        : tone === "amber"
          ? "text-amber-200"
          : tone === "rose"
            ? "text-rose-200"
            : "text-neutral-200";

  return (
    <div className="bg-neutral-950/80 p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-neutral-400">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-black ${accentClassName}`}>{value}</p>
      <p className="mt-1 text-xs font-bold leading-5 text-neutral-400">{detail}</p>
    </div>
  );
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
    <section className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
        Pricing intelligence
      </p>
      <h2 className="mt-2 text-xl font-black">Sales comps</h2>

      <div className="space-y-3">
        <Link
          href={adminHref(`/admin/products/${productId}?comps=true`, adminHandoff)}
          className="block rounded-xl bg-neutral-950 px-4 py-2 text-center text-sm font-black text-white shadow-sm transition hover:bg-neutral-800"
        >
          Check eBay sold comps
        </Link>

        <a
          href={point130Url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-xl border border-neutral-300 bg-white px-4 py-2 text-center text-sm font-black shadow-sm transition hover:bg-neutral-50"
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
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm font-semibold shadow-inner shadow-neutral-100">
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
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 shadow-sm">
              <p className="text-emerald-800">Suggested</p>
              <p className="font-bold">{money(salesComps.suggestedPrice)}</p>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
              <p className="text-neutral-500">Count</p>
              <p className="font-bold">{salesComps.count}</p>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
              <p className="text-neutral-500">Median</p>
              <p className="font-bold">{money(salesComps.medianPrice)}</p>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
              <p className="text-neutral-500">Average</p>
              <p className="font-bold">{money(salesComps.averagePrice)}</p>
            </div>
            <div className="col-span-2 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
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
                className="w-full rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-emerald-800"
                pendingChildren="Applying price..."
                title="Update this product's price to the latest suggested comp price while preserving the rest of the product record."
              >
                Apply suggested price
              </AdminSubmitButton>
              <p className="mt-1 text-xs font-bold text-neutral-600">
                Updates price from the latest comps only; title, quantity, status, image, description,
                and authenticity fields stay on the product record.
              </p>
            </form>
          )}

          {salesComps.comps.length === 0 ? (
            <p className="text-sm font-semibold text-neutral-600">No sold comps found.</p>
          ) : (
            <div className="space-y-3">
              {salesComps.comps.slice(0, 6).map((comp, index) => {
                const compCard = (
                  <>
                    <p className="font-bold">{comp.title}</p>
                    <p>
                      {money(comp.price)} - {comp.source}
                    </p>
                    {comp.soldAt && (
                      <p className="text-neutral-500">
                        Sold {new Date(comp.soldAt).toLocaleDateString()}
                      </p>
                    )}
                    {!comp.itemUrl && (
                      <p className="mt-2 text-xs font-bold uppercase tracking-wide text-amber-700">
                        Source link unavailable
                      </p>
                    )}
                  </>
                );

                return comp.itemUrl ? (
                  <a
                    key={`${comp.title}-${index}`}
                    href={comp.itemUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-sm shadow-sm transition hover:bg-neutral-100"
                  >
                    {compCard}
                  </a>
                ) : (
                  <div
                    key={`${comp.title}-${index}`}
                    className="block rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm shadow-sm"
                  >
                    {compCard}
                  </div>
                );
              })}
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
                  className="block rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-sm shadow-sm transition hover:bg-neutral-100"
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
                className="block rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-bold shadow-sm transition hover:bg-neutral-50"
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
              <div key={entry.id} className="rounded-2xl border border-neutral-200 bg-white p-3 text-sm shadow-sm">
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
  const removesFromInventory = status === "sold" || status === "archived";
  const title = isCurrent
    ? `Already ${status}.`
    : blockedForStock
      ? "Set quantity to at least 1 in the product form before making this active or reserved."
      : adminProductStatusSuccessMessage(status);
  const statusHelp = removesFromInventory
    ? status === "sold"
      ? "Marks this product sold, removes it from buyer availability, and sets quantity to 0."
      : "Ends this product early, archives it, removes it from active inventory, and sets quantity to 0."
    : status === "reserved"
      ? "Reserves this product and removes it from normal buyer availability."
      : status === "active"
        ? "Makes this product buyer-available when quantity is at least 1."
        : "Updates this product status.";
  const buttonLabel =
    !isCurrent && status === "sold"
      ? "Mark Sold / Zero Qty"
      : !isCurrent && status === "archived"
        ? "End Early / Archive / Zero Qty"
        : label;
  const actionClassName = removesFromInventory
    ? "border border-rose-300 bg-rose-50 text-rose-950 hover:bg-rose-100"
    : "border border-neutral-300 bg-white hover:bg-neutral-50";

  return (
    <form action={setProductStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <AdminSubmitButton
        disabled={isDisabled}
        disabledReason={isDisabled ? title : undefined}
        title={title}
        className={`w-full rounded-xl px-4 py-2 text-sm font-black shadow-sm transition disabled:cursor-not-allowed ${
          isCurrent
            ? "border border-emerald-200 bg-emerald-50 text-emerald-950"
            : blockedForStock
              ? "border border-amber-200 bg-amber-50 text-amber-950"
            : actionClassName
        }`}
        pendingChildren={adminProductStatusPendingLabel(status)}
      >
        {isCurrent
          ? `Current: ${label}`
          : blockedForStock
            ? "Qty required first"
            : buttonLabel}
      </AdminSubmitButton>
      {blockedForStock ? (
        <p className="mt-1 text-xs font-black text-amber-800">
          Quantity must be at least 1 before {status}.
        </p>
      ) : (
        <p
          className={`mt-1 text-xs font-black ${
            removesFromInventory ? "text-rose-800" : "text-neutral-600"
          }`}
        >
          {statusHelp}
        </p>
      )}
    </form>
  );
}

function Metric({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "emerald" | "sky" | "amber" | "rose";
  value: string;
}) {
  const className =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "sky"
        ? "border-sky-200 bg-sky-50 text-sky-950"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : tone === "rose"
            ? "border-rose-200 bg-rose-50 text-rose-950"
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
