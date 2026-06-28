import Link from "next/link";
import { redirect } from "next/navigation";
import { inventoryEngine } from "../../../../modules/inventory";
import type { InventoryStatus } from "../../../../modules/inventory";
import { getSalesCompHistory, getSalesComps } from "../../../../lib/ebay";
import type {
  SalesCompHistoryResult,
  SalesCompSummary,
} from "../../../../lib/ebay";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INVENTORY_STATUSES: InventoryStatus[] = [
  "draft",
  "active",
  "reserved",
  "sold",
  "archived",
];

function textValue(value: string | null) {
  return value ?? "";
}

function parseString(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function parseNumber(value: FormDataEntryValue | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function updateProduct(formData: FormData) {
  "use server";

  const id = Number(formData.get("id"));
  const status = String(formData.get("status") || "active") as InventoryStatus;

  await inventoryEngine.updateProduct(id, {
    title: String(formData.get("title") || "").trim(),
    player: parseString(formData.get("player")),
    sport: parseString(formData.get("sport")),
    price: parseNumber(formData.get("price")),
    quantity: Math.max(0, parseNumber(formData.get("quantity"))),
    status,
    imageUrl: parseString(formData.get("image_url")),
    description: parseString(formData.get("description")),
  });

  redirect(`/admin/products/${id}`);
}

async function setProductStatus(formData: FormData) {
  "use server";

  const id = Number(formData.get("id"));
  const status = String(formData.get("status") || "active") as InventoryStatus;

  await inventoryEngine.setStatus({
    legacyProductId: id,
    status,
  });

  redirect(`/admin/products/${id}`);
}

async function regenerateDescription(formData: FormData) {
  "use server";

  const id = Number(formData.get("id"));

  await inventoryEngine.regenerateDescription(id);

  redirect(`/admin/products/${id}`);
}

async function generateAiDescription(formData: FormData) {
  "use server";

  const id = Number(formData.get("id"));

  await inventoryEngine.generateAiDescription(id);

  redirect(`/admin/products/${id}`);
}

async function applySuggestedPrice(formData: FormData) {
  "use server";

  const id = Number(formData.get("id"));
  const product = await inventoryEngine.getByLegacyProductId(id);

  if (!product) {
    redirect("/admin/products");
  }

  const salesComps = await getSalesComps({
    title: product.title,
    player: product.player,
    sport: product.sport,
    legacyProductId: product.legacyProductId,
    limit: 12,
  });

  if (!salesComps.suggestedPrice) {
    redirect(`/admin/products/${id}?comps=true`);
  }

  await inventoryEngine.updateProduct(id, {
    title: product.title,
    player: product.player,
    sport: product.sport,
    price: salesComps.suggestedPrice,
    quantity: product.quantity,
    status: product.status,
    imageUrl: product.imageUrl,
    description: product.description,
  });

  redirect(`/admin/products/${id}?comps=true`);
}

export default async function AdminProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ comps?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const product = await inventoryEngine.getByLegacyProductId(Number(id));

  if (!product) {
    return (
      <main className="p-8 max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Product Not Found</h1>
        <Link href="/admin/products" className="underline">
          Back to Products
        </Link>
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
    <main className="p-8 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <Link href="/admin/products" className="underline">
            Back to Products
          </Link>

          <h1 className="text-4xl font-bold mt-4">Edit Product</h1>
          <p className="text-gray-600 mt-2">
            Product #{product.legacyProductId} - {product.source}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/product/${product.legacyProductId}`}
            className="border rounded px-4 py-2"
          >
            View Storefront
          </Link>

          <Link href="/admin/logout" className="border rounded px-4 py-2">
            Logout
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <section className="lg:col-span-2">
          <form action={updateProduct} className="space-y-4">
            <input type="hidden" name="id" value={product.legacyProductId} />

            <label className="block">
              <span className="font-bold">Title</span>
              <input
                name="title"
                required
                defaultValue={product.title}
                className="border p-2 w-full mt-1"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="font-bold">Player</span>
                <input
                  name="player"
                  defaultValue={textValue(product.player)}
                  className="border p-2 w-full mt-1"
                />
              </label>

              <label className="block">
                <span className="font-bold">Sport</span>
                <input
                  name="sport"
                  defaultValue={textValue(product.sport)}
                  className="border p-2 w-full mt-1"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="font-bold">Price</span>
                <input
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={product.price}
                  className="border p-2 w-full mt-1"
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
                  className="border p-2 w-full mt-1"
                />
              </label>

              <label className="block">
                <span className="font-bold">Status</span>
                <select
                  name="status"
                  defaultValue={product.status}
                  className="border p-2 w-full mt-1"
                >
                  {INVENTORY_STATUSES.map((status) => (
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
                defaultValue={textValue(product.imageUrl)}
                className="border p-2 w-full mt-1"
              />
            </label>

            <label className="block">
              <span className="font-bold">Description</span>
              <textarea
                name="description"
                defaultValue={textValue(product.description)}
                rows={8}
                className="border p-2 w-full mt-1"
              />
              <span className="text-sm text-gray-500">
                Leave blank and save to auto-fill from TCOS product data.
              </span>
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                className="bg-black text-white rounded px-6 py-3 font-bold"
              >
                Save Product
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-6">
          <section className="border rounded p-4">
            <h2 className="font-bold text-xl mb-3">Inventory State</h2>
            <p>Status: {product.status}</p>
            <p>Quantity: {product.quantity}</p>
            <p>SKU: {product.sku || "Not set"}</p>
            <p>eBay Listing: {product.ebayItemId || "Not linked"}</p>
            <p>V2 Item: {product.inventoryItemId || "Not created yet"}</p>
          </section>

          {product.imageUrl && (
            <section className="border rounded p-4">
              <h2 className="font-bold text-xl mb-3">Image</h2>
              <img
                src={product.imageUrl}
                alt={product.title}
                className="w-full rounded border"
              />
            </section>
          )}

          <section className="border rounded p-4">
            <h2 className="font-bold text-xl mb-3">Quick Status</h2>
            <div className="space-y-3">
              <StatusButton
                id={product.legacyProductId}
                status="active"
                label="Set Active"
              />
              <StatusButton
                id={product.legacyProductId}
                status="reserved"
                label="Reserve"
              />
              <StatusButton
                id={product.legacyProductId}
                status="sold"
                label="Mark Sold"
              />
              <StatusButton
                id={product.legacyProductId}
                status="archived"
                label="Archive"
              />
            </div>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-bold text-xl mb-3">Description</h2>
            <div className="space-y-3">
              <form action={regenerateDescription}>
                <input type="hidden" name="id" value={product.legacyProductId} />
                <button type="submit" className="border rounded px-4 py-2 w-full">
                  Auto-Fill Description
                </button>
              </form>

              <form action={generateAiDescription}>
                <input type="hidden" name="id" value={product.legacyProductId} />
                <button
                  type="submit"
                  className="bg-black text-white rounded px-4 py-2 w-full"
                >
                  AI Write Description
                </button>
              </form>
            </div>
          </section>

          <SalesCompsPanel
            productId={product.legacyProductId}
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

function money(value: number | null) {
  if (value === null) return "n/a";
  return `$${value.toFixed(2)}`;
}

function SalesCompsPanel({
  productId,
  point130Url,
  salesComps,
  salesCompHistory,
}: {
  productId: number;
  point130Url: string;
  salesComps: SalesCompSummary | null;
  salesCompHistory: SalesCompHistoryResult;
}) {
  return (
    <section className="border rounded p-4">
      <h2 className="font-bold text-xl mb-3">Sales Comps</h2>

      <div className="space-y-3">
        <Link
          href={`/admin/products/${productId}?comps=true`}
          className="block text-center border rounded px-4 py-2"
        >
          Check eBay Sold Comps
        </Link>

        <a
          href={point130Url}
          target="_blank"
          rel="noreferrer"
          className="block text-center border rounded px-4 py-2"
        >
          Open 130point Search
        </a>
      </div>

      {!salesComps ? (
        <p className="text-sm text-gray-600 mt-4">
          Load comps to compare recent sold pricing before listing or repricing.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="text-sm">
            <p>Query: {salesComps.query}</p>
            <p>eBay: {salesComps.sourceStatus}</p>
            <p>Google: {salesComps.googleStatus}</p>
            <p>PriceCharting: {salesComps.priceGuideStatus}</p>
            {salesComps.sourceMessage && (
              <p className="text-gray-600">{salesComps.sourceMessage}</p>
            )}
            {salesComps.googleMessage && (
              <p className="text-gray-600">{salesComps.googleMessage}</p>
            )}
            {salesComps.priceGuideMessage && (
              <p className="text-gray-600">{salesComps.priceGuideMessage}</p>
            )}
            {salesComps.snapshotMessage && (
              <p className="text-gray-600">
                History save: {salesComps.snapshotMessage}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="border rounded p-3">
              <p className="text-gray-500">Suggested</p>
              <p className="font-bold">{money(salesComps.suggestedPrice)}</p>
            </div>
            <div className="border rounded p-3">
              <p className="text-gray-500">Count</p>
              <p className="font-bold">{salesComps.count}</p>
            </div>
            <div className="border rounded p-3">
              <p className="text-gray-500">Median</p>
              <p className="font-bold">{money(salesComps.medianPrice)}</p>
            </div>
            <div className="border rounded p-3">
              <p className="text-gray-500">Average</p>
              <p className="font-bold">{money(salesComps.averagePrice)}</p>
            </div>
            <div className="border rounded p-3">
              <p className="text-gray-500">Range</p>
              <p className="font-bold">
                {money(salesComps.lowPrice)} - {money(salesComps.highPrice)}
              </p>
            </div>
          </div>

          {salesComps.suggestedPriceMethod && (
            <p className="text-sm text-gray-600">
              {salesComps.suggestedPriceMethod}. Recent comps used:{" "}
              {salesComps.recentCompCount}.
            </p>
          )}

          {salesComps.suggestedPrice && (
            <form action={applySuggestedPrice}>
              <input type="hidden" name="id" value={productId} />
              <button
                type="submit"
                className="bg-black text-white rounded px-4 py-2 w-full"
              >
                Apply Suggested Price
              </button>
            </form>
          )}

          {salesComps.comps.length === 0 ? (
            <p className="text-sm text-gray-600">No sold comps found.</p>
          ) : (
            <div className="space-y-3">
              {salesComps.comps.slice(0, 6).map((comp, index) => (
                <a
                  key={`${comp.title}-${index}`}
                  href={comp.itemUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="block border rounded p-3 text-sm"
                >
                  <p className="font-bold">{comp.title}</p>
                  <p>
                    {money(comp.price)} - {comp.source}
                  </p>
                  {comp.soldAt && (
                    <p className="text-gray-500">
                      Sold {new Date(comp.soldAt).toLocaleDateString()}
                    </p>
                  )}
                </a>
              ))}
            </div>
          )}

          {salesComps.googleResults.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-bold">Google Results</h3>
              {salesComps.googleResults.slice(0, 5).map((result) => (
                <a
                  key={result.url}
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block border rounded p-3 text-sm"
                >
                  <p className="font-bold">{result.title}</p>
                  {result.snippet && (
                    <p className="text-gray-600">{result.snippet}</p>
                  )}
                </a>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <h3 className="font-bold">Research Links</h3>
            {salesComps.researchLinks.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="block border rounded px-4 py-2 text-sm"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        <h3 className="font-bold">Comps History</h3>
        {salesCompHistory.status === "unavailable" && (
          <p className="text-sm text-gray-600">{salesCompHistory.message}</p>
        )}

        {salesCompHistory.entries.length === 0 ? (
          <p className="text-sm text-gray-600">No saved comp checks yet.</p>
        ) : (
          <div className="space-y-3">
            {salesCompHistory.entries.map((entry) => (
              <div key={entry.id} className="border rounded p-3 text-sm">
                <p className="font-bold">{money(entry.suggestedPrice)}</p>
                <p>{new Date(entry.createdAt).toLocaleString()}</p>
                <p>Comps: {entry.compCount}</p>
                <p>Recent comps: {entry.recentCompCount}</p>
                <p>
                  Median: {money(entry.medianPrice)} / Average:{" "}
                  {money(entry.averagePrice)}
                </p>
                <p className="text-gray-600">{entry.suggestedPriceMethod}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function StatusButton({
  id,
  status,
  label,
}: {
  id: number;
  status: InventoryStatus;
  label: string;
}) {
  return (
    <form action={setProductStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className="border rounded px-4 py-2 w-full">
        {label}
      </button>
    </form>
  );
}
