import { redirect } from "next/navigation";
import Link from "next/link";
import AdminSubmitButton from "../../AdminSubmitButton";
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
  const detail =
    error instanceof Error && error.message.trim()
      ? error.message.trim().slice(0, 240)
      : "Manual product could not be created.";

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
    <main className="space-y-8 bg-neutral-50 px-6 py-8 text-neutral-950">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <Link href="/admin/products" className="text-sm font-black text-neutral-600 underline">
          ← Back to products
        </Link>
        <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              Inventory intake
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Add products
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
              Use InstaComp™ for lots and card scans. Use manual entry only for a
              known single product where title, price, quantity, and image are
              already ready for review.
            </p>
          </div>
          <Link
            href="/admin/ebay/inventory-intake"
            className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-950 hover:bg-emerald-100"
          >
            Review eBay intake
          </Link>
        </div>
      </section>

      <section className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
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

      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
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
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-950">
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
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
            />
          </Field>
          <Field label="Player / subject">
            <input
              name="player"
              placeholder="Connor Bedard"
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
            />
          </Field>
          <Field label="Sport / category">
            <input
              name="sport"
              placeholder="Hockey"
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
            />
          </Field>
          <Field label="Image URL">
            <input
              name="image_url"
              type="url"
              placeholder="https://..."
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
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
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
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
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
            />
          </Field>

          <Field label="Description" className="md:col-span-2">
            <textarea
              name="description"
              rows={5}
              placeholder="Leave blank to auto-fill later, or paste the reviewed listing description."
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-sm"
            />
          </Field>

          <div className="md:col-span-2">
            <AdminSubmitButton
              className="rounded-md bg-neutral-950 px-6 py-3 text-sm font-black text-white hover:bg-neutral-800"
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
