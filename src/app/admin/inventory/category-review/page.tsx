import Link from "next/link";
import { supabase } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  sku: string | null;
  title: string;
  category: string;
  status: string;
  quantity: number;
  price: number;
  notes: string | null;
  updated_at: string;
};

type AttributeRow = {
  inventory_item_id: string;
  attribute_name: string;
  attribute_value: string | null;
};

type ReviewRow = {
  inventory: InventoryRow;
  attributes: Record<string, string>;
  ebayAttributes: AttributeRow[];
};

const TCOS_ATTRIBUTE_NAMES = [
  "tcos_category",
  "tcos_category_confidence",
  "tcos_review_required",
  "tcos_category_evidence",
];

const CATEGORY_LABELS: Record<string, string> = {
  sports_cards: "Sports Cards",
  trading_cards: "Trading Cards",
  shoes: "Shoes",
  comics: "Comics",
  memorabilia: "Memorabilia",
  toys: "Toys",
  sealed_wax: "Sealed Wax",
  autographs: "Autographs",
  coins: "Coins",
  other_collectable: "Other Collectable",
};

function categoryLabel(value: string | null | undefined) {
  if (!value) return "Unmapped";
  return CATEGORY_LABELS[value] || value.replaceAll("_", " ");
}

function confidenceTone(value: string | null | undefined) {
  if (value === "high") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (value === "medium") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function categoryTone(value: string | null | undefined) {
  if (value === "other_collectable") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  if (value === "autographs" || value === "memorabilia" || value === "sealed_wax") {
    return "border-indigo-200 bg-indigo-50 text-indigo-800";
  }

  if (value === "shoes") return "border-sky-200 bg-sky-50 text-sky-800";
  if (value === "sports_cards" || value === "trading_cards") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function money(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function safeErrorMessage(error: Error | { message?: string } | string | null) {
  const message =
    typeof error === "string"
      ? error
      : error?.message || "Unknown category review load error.";

  return String(message).replace(/\s+/g, " ").trim().slice(0, 220);
}

function isReviewRequired(row: ReviewRow) {
  return (
    row.attributes.tcos_review_required === "true" ||
    row.attributes.tcos_category_confidence === "low" ||
    row.inventory.category === "other_collectable"
  );
}

function groupAttributes(rows: AttributeRow[]) {
  return rows.reduce<Record<string, Record<string, string>>>((grouped, row) => {
    grouped[row.inventory_item_id] ??= {};
    grouped[row.inventory_item_id][row.attribute_name] =
      row.attribute_value || "";
    return grouped;
  }, {});
}

function groupEbayAttributes(rows: AttributeRow[]) {
  return rows.reduce<Record<string, AttributeRow[]>>((grouped, row) => {
    grouped[row.inventory_item_id] ??= [];
    grouped[row.inventory_item_id].push(row);
    return grouped;
  }, {});
}

async function loadReviewRows() {
  const tcosAttributes = await supabase
    .from("inventory_attributes")
    .select("inventory_item_id,attribute_name,attribute_value")
    .in("attribute_name", TCOS_ATTRIBUTE_NAMES)
    .limit(2000);

  if (tcosAttributes.error) throw tcosAttributes.error;

  const attributeGroups = groupAttributes(
    (tcosAttributes.data ?? []) as AttributeRow[],
  );
  const inventoryItemIds = Object.keys(attributeGroups);

  if (inventoryItemIds.length === 0) {
    return [];
  }

  const inventoryResult = await supabase
    .from("inventory_items")
    .select(
      "id,legacy_product_id,sku,title,category,status,quantity,price,notes,updated_at",
    )
    .in("id", inventoryItemIds)
    .order("updated_at", { ascending: false })
    .limit(250);

  if (inventoryResult.error) throw inventoryResult.error;

  const visibleIds = (inventoryResult.data ?? []).map((item) => item.id);
  const ebayAttributeResult =
    visibleIds.length > 0
      ? await supabase
          .from("inventory_attributes")
          .select("inventory_item_id,attribute_name,attribute_value")
          .in("inventory_item_id", visibleIds)
          .like("attribute_name", "ebay_aspect_%")
          .order("attribute_name")
          .limit(2000)
      : { data: [], error: null };

  if (ebayAttributeResult.error) throw ebayAttributeResult.error;

  const ebayAttributeGroups = groupEbayAttributes(
    (ebayAttributeResult.data ?? []) as AttributeRow[],
  );

  return ((inventoryResult.data ?? []) as InventoryRow[])
    .map((inventory) => ({
      inventory,
      attributes: attributeGroups[inventory.id] ?? {},
      ebayAttributes: ebayAttributeGroups[inventory.id] ?? [],
    }))
    .sort((left, right) => {
      const leftReview = isReviewRequired(left) ? 0 : 1;
      const rightReview = isReviewRequired(right) ? 0 : 1;
      return leftReview - rightReview;
    });
}

export default async function CategoryReviewPage() {
  let rows: ReviewRow[] = [];
  let error: Error | null = null;

  try {
    rows = await loadReviewRows();
  } catch (err: any) {
    error = err;
  }

  const reviewRows = rows.filter(isReviewRequired);
  const cleanRows = rows.filter((row) => !isReviewRequired(row));
  const visibleRows = [...reviewRows, ...cleanRows].slice(0, 150);
  const categoryReviewUnavailable = Boolean(error);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#fef3c7,_transparent_28%),linear-gradient(180deg,_#f8fafc,_#f5f5f4)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="flex flex-col gap-5 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(251,191,36,0.28),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:flex-row lg:items-end lg:justify-between lg:p-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Category Intelligence
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Import Category Review
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Review eBay-generated TCOS categories, confidence, mapping
              evidence, and imported aspects before larger sync runs.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandLink href="/admin" label="Command Center" />
            <CommandLink href="/admin/inventory" label="Inventory Control" />
            <CommandLink href="/admin/ebay" label="eBay Sync" />
            <CommandLink href="/admin/products" label="Products" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 py-6">
        {error ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-900 shadow-sm ring-1 ring-rose-950/5">
            <h2 className="text-lg font-black text-rose-950">
              Category review source unavailable
            </h2>
            <p className="mt-2 max-w-3xl leading-6">
              Imported category attributes did not load, so this page cannot
              prove whether low-confidence category mappings exist. Do not treat
              the review queue as clear until the inventory attribute source is
              repaired.
            </p>
            <p className="mt-3 rounded-2xl border border-rose-200 bg-white/70 px-3 py-2 text-xs font-black text-rose-950">
              Diagnostic: {safeErrorMessage(error)}
            </p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric
            label="Mapped Imports"
            value={categoryReviewUnavailable ? "Unavailable" : String(rows.length)}
          />
          <Metric
            label="Needs Review"
            value={
              categoryReviewUnavailable ? "Unavailable" : String(reviewRows.length)
            }
          />
          <Metric
            label="Clean Mappings"
            value={
              categoryReviewUnavailable ? "Unavailable" : String(cleanRows.length)
            }
          />
        </section>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/95 shadow-sm ring-1 ring-black/[0.02]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 bg-white p-5">
            <div>
              <h2 className="text-2xl font-black">Review Queue</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Review-required, low-confidence, and other-collectable mappings
                appear first. Evidence comes from the eBay title and aspects.
              </p>
            </div>
            <span className="rounded-full border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-black uppercase text-neutral-700 shadow-sm">
              Showing {visibleRows.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3">Evidence</th>
                  <th className="px-4 py-3">eBay Aspects</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {categoryReviewUnavailable ? (
                  <tr>
                    <td className="px-4 py-6 text-rose-800" colSpan={6}>
                      <p className="font-black">
                        Category review queue unavailable.
                      </p>
                      <p className="mt-1 max-w-3xl font-semibold">
                        Inventory category attributes did not load, so this
                        table cannot prove whether imported category mappings
                        need review.
                      </p>
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-neutral-600" colSpan={6}>
                      No imported category attributes found yet. Run an eBay
                      import after the inventory migrations are applied.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => {
                    const category =
                      row.attributes.tcos_category || row.inventory.category;
                    const confidence =
                      row.attributes.tcos_category_confidence || "unknown";
                    const reviewRequired = isReviewRequired(row);

                    return (
                      <tr key={row.inventory.id} className="align-top transition hover:bg-neutral-50">
                        <td className="px-4 py-4">
                          <p className="max-w-[320px] font-bold">
                            {row.inventory.title}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            SKU {row.inventory.sku || "missing"} | Qty{" "}
                            {row.inventory.quantity} | {money(row.inventory.price)}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            Inventory {row.inventory.id}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`rounded border px-2 py-1 text-xs font-black uppercase ${categoryTone(
                              category,
                            )}`}
                          >
                            {categoryLabel(category)}
                          </span>
                          {reviewRequired ? (
                            <p className="mt-2 text-xs font-bold uppercase text-rose-700">
                              Review Required
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`rounded border px-2 py-1 text-xs font-black uppercase ${confidenceTone(
                              confidence,
                            )}`}
                          >
                            {confidence}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <p className="max-w-[220px] text-sm text-neutral-700">
                            {row.attributes.tcos_category_evidence ||
                              "No evidence recorded"}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <div className="max-w-[320px] space-y-1">
                            {row.ebayAttributes.length === 0 ? (
                              <p className="text-xs text-neutral-500">
                                No eBay aspects recorded.
                              </p>
                            ) : (
                              row.ebayAttributes.slice(0, 8).map((attribute) => (
                                <p
                                  key={`${attribute.attribute_name}-${attribute.attribute_value}`}
                                  className="text-xs text-neutral-600"
                                >
                                  <span className="font-bold">
                                    {attribute.attribute_name
                                      .replace("ebay_aspect_", "")
                                      .replaceAll("_", " ")}
                                    :
                                  </span>{" "}
                                  {attribute.attribute_value || "n/a"}
                                </p>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          {row.inventory.legacy_product_id ? (
                            <Link
                              href={`/admin/products/${row.inventory.legacy_product_id}`}
                              className="inline-flex rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black shadow-sm transition hover:border-neutral-500 hover:bg-neutral-50"
                            >
                              Edit Product
                            </Link>
                          ) : (
                            <span className="text-xs font-bold text-neutral-500">
                              No product link
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function CommandLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold shadow-sm transition hover:bg-white/15"
    >
      {label}
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-black">{value}</p>
    </div>
  );
}
