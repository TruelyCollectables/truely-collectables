import { redirect } from "next/navigation";
import Link from "next/link";
import AdminSubmitButton from "../../AdminSubmitButton";
import { adminProductActionFailureMessage } from "../../../../lib/admin-product-status";
import { inventoryEngine } from "../../../../modules/inventory";
import InstaCompScanner from "../../instacomp/InstaCompScanner";

function textValue(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function positiveMoneyValue(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function wholeQuantityValue(value: string) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function safeImageUrl(value: string) {
  if (!value) return null;

  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function addProductErrorPath(error: string) {
  return `/admin/products/new?error=${encodeURIComponent(error)}`;
}

function addProductFailurePath(error: unknown) {
  const detail = adminProductActionFailureMessage(
    error,
    "Manual product could not be created.",
  );

  return `/admin/products/new?error=create_failed&detail=${encodeURIComponent(detail)}`;
}

async function addProduct(formData: FormData) {
  "use server";

  const title = textValue(formData, "title");
  const player = textValue(formData, "player");
  const sport = textValue(formData, "sport");
  const price = positiveMoneyValue(textValue(formData, "price"));
  const quantity = wholeQuantityValue(textValue(formData, "quantity"));
  const description = textValue(formData, "description");
  const imageUrlInput = textValue(formData, "image_url");
  const imageUrl = safeImageUrl(imageUrlInput);

  if (!title) {
    redirect(addProductErrorPath("missing_title"));
  }

  if (price === null) {
    redirect(addProductErrorPath("invalid_price"));
  }

  if (quantity === null) {
    redirect(addProductErrorPath("invalid_quantity"));
  }

  if (imageUrlInput && !imageUrl) {
    redirect(addProductErrorPath("invalid_image_url"));
  }

  let failurePath: string | null = null;

  try {
    await inventoryEngine.createManualProduct({
      title,
      player: player || null,
      sport: sport || null,
      price,
      quantity,
      description: description || null,
      imageUrl,
    });
  } catch (error) {
    failurePath = addProductFailurePath(error);
  }

  if (failurePath) {
    redirect(failurePath);
  }

  redirect("/admin/products");
}

function errorMessage(
  code: string | string[] | undefined,
  detail: string | string[] | undefined,
) {
  const errorCode = Array.isArray(code) ? code[0] : code;
  const detailText = Array.isArray(detail) ? detail[0] : detail;

  if (errorCode === "missing_title") return "Title is required.";
  if (errorCode === "invalid_price") return "Price must be greater than zero.";
  if (errorCode === "invalid_quantity") {
    return "Quantity must be a whole number of zero or more.";
  }
  if (errorCode === "invalid_image_url") {
    return "Image URL must begin with http:// or https://.";
  }
  if (errorCode === "create_failed") {
    return `Manual product was not created: ${detailText || "Please try again."}`;
  }

  return "";
}

export default async function NewProductPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string | string[]; detail?: string | string[] }>;
}) {
  const query = await searchParams;
  const error = errorMessage(query?.error, query?.detail);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.14),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.2),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Link
                href="/admin/products"
                className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-black text-emerald-300 transition hover:border-emerald-300/50 hover:bg-emerald-300/10"
              >
                ← Back to products
              </Link>
              <p className="mt-5 text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
                Inventory intake
              </p>
              <h1 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">
                Add products
              </h1>
              <p className="mt-3 max-w-4xl text-sm font-semibold leading-7 text-neutral-300">
                Use InstaComp™ for lots and card scans. Use manual entry only for a
                known single product where title, price, quantity, and image are
                already ready for review.
              </p>
            </div>

            <div className="grid min-w-[320px] grid-cols-3 gap-3 rounded-3xl border border-white/10 bg-white/[0.06] p-4 shadow-xl shadow-neutral-950/20">
              <HeaderStat label="Scanner" value="Primary" />
              <HeaderStat label="Manual" value="Fallback" />
              <HeaderStat label="Publish" value="Separate" />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <CommandLink href="/admin/products" label="Products" primary />
            <CommandLink href="/admin/ebay/inventory-intake" label="eBay intake" />
            <CommandLink href="/admin/instacomp-direct" label="InstaComp direct" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-8 py-6">
        <section className="rounded-3xl border border-emerald-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm ring-1 ring-emerald-950/5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
              Recommended path
            </p>
            <h2 className="mt-2 text-2xl font-black">AI lot scanner</h2>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-emerald-950">
              This is the fast path: upload the whole lot, run InstaComp™, review
              the AI results, then create draft listings before anything goes live.
            </p>
          </div>
          <InstaCompScanner />
        </section>

        <section className="rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                Manual fallback
              </p>
              <h2 className="mt-2 text-2xl font-black">Manual product entry</h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-neutral-600">
                Create a single reviewed product. Required fields are enforced so
                manual intake does not create blank, NaN-priced, or malformed rows.
              </p>
            </div>
            {error ? (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-950 shadow-sm ring-1 ring-red-950/5"
              >
                {error}
              </p>
            ) : null}
          </div>

          <form action={addProduct} className="mt-6 grid max-w-4xl gap-4 md:grid-cols-2">
            <Field label="Title" required>
              <input
                name="title"
                required
                placeholder="2024 Topps Chrome Connor Bedard PSA 10"
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm shadow-sm focus:border-neutral-950 focus:outline-none focus:ring-4 focus:ring-black/10"
              />
            </Field>
            <Field label="Player / subject">
              <input
                name="player"
                placeholder="Connor Bedard"
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm shadow-sm focus:border-neutral-950 focus:outline-none focus:ring-4 focus:ring-black/10"
              />
            </Field>
            <Field label="Sport / category">
              <input
                name="sport"
                placeholder="Hockey"
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm shadow-sm focus:border-neutral-950 focus:outline-none focus:ring-4 focus:ring-black/10"
              />
            </Field>
            <Field label="Image URL">
              <input
                name="image_url"
                type="url"
                placeholder="https://..."
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm shadow-sm focus:border-neutral-950 focus:outline-none focus:ring-4 focus:ring-black/10"
              />
            </Field>
            <Field label="Price" required>
              <input
                name="price"
                type="number"
                min="0.01"
                step="0.01"
                required
                placeholder="49.99"
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm shadow-sm focus:border-neutral-950 focus:outline-none focus:ring-4 focus:ring-black/10"
              />
            </Field>
            <Field label="Quantity" required>
              <input
                name="quantity"
                type="number"
                min="0"
                step="1"
                required
                placeholder="1"
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm shadow-sm focus:border-neutral-950 focus:outline-none focus:ring-4 focus:ring-black/10"
              />
            </Field>

            <Field label="Description" className="md:col-span-2">
              <textarea
                name="description"
                rows={5}
                placeholder="Leave blank to auto-fill later, or paste the reviewed listing description."
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm shadow-sm focus:border-neutral-950 focus:outline-none focus:ring-4 focus:ring-black/10"
              />
            </Field>

            <div className="md:col-span-2">
              <AdminSubmitButton
                className="rounded-full bg-neutral-950 px-6 py-3 text-sm font-black text-white shadow-sm transition hover:bg-neutral-800"
                pendingChildren="Adding product..."
                title="Create one manual store product from the form fields without publishing it to eBay."
              >
                Add manual product
              </AdminSubmitButton>
              <p className="mt-2 text-xs font-bold text-neutral-600">
                Adds the product to TCOS inventory only; marketplace publishing remains a separate admin step.
              </p>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function Field({
  children,
  className = "",
  label,
  required,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label className={`block text-sm font-black text-neutral-800 ${className}`}>
      {label} {required ? <span className="text-red-700">*</span> : null}
      {children}
    </label>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-400">
        {label}
      </p>
      <p className="mt-1 truncate text-lg font-black text-white">{value}</p>
    </div>
  );
}

function CommandLink({
  href,
  label,
  primary = false,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "rounded-full bg-white px-4 py-2 text-sm font-black text-neutral-950 shadow-sm transition hover:bg-neutral-200"
          : "rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/15"
      }
    >
      {label}
    </Link>
  );
}
