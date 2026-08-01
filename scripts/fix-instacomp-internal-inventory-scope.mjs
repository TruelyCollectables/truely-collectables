import fs from "node:fs";

const routePath = "src/app/api/instacomp/scan/route.ts";
let source = fs.readFileSync(routePath, "utf8");

if (source.includes("INSTACOMP_INVENTORY_SCOPE_V2")) {
  console.log("InstaComp internal inventory scope is already hardened.");
  process.exit(0);
}

const start = source.indexOf("async function getTcosInventoryProvider(");
const end = source.indexOf("async function saveScanToSupabase(", start);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("Could not locate the InstaComp internal inventory provider boundary.");
}

const replacement = `async function getTcosInventoryProvider(
  query: string,
  ai: InstaCompAiResult,
  actor: Awaited<ReturnType<typeof requireInstaCompJobActor>>,
): Promise<InstaCompProviderResult> {
  // INSTACOMP_INVENTORY_SCOPE_V2
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      source: "tcos_inventory",
      label: "TCOS Inventory",
      status: "not_configured",
      message: "Supabase env vars missing.",
      results: [],
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const words = query
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 2)
    .slice(0, 6);

  if (!words.length) {
    return {
      source: "tcos_inventory",
      label: "TCOS Inventory",
      status: "no_matches",
      message: "Not enough query words for internal search.",
      results: [],
    };
  }

  const searchTerm = words.join(" ");
  let inventoryQuery = supabase
    .from("inventory_items")
    .select(
      "id,legacy_product_id,seller_account_id,title,price,quantity,status,metadata",
    )
    .eq("store_id", actor.storeId)
    .eq("status", "active")
    .gt("quantity", 0)
    .gt("price", 0)
    .ilike("title", \`%\${searchTerm}%\`);

  inventoryQuery =
    actor.type === "seller"
      ? inventoryQuery.eq("seller_account_id", actor.sellerAccountId)
      : inventoryQuery.is("seller_account_id", null);

  const { data, error } = await inventoryQuery.limit(25);

  if (error) {
    console.error("TCOS internal comp search error:", error);
    return {
      source: "tcos_inventory",
      label: "TCOS Inventory",
      status: "error",
      message: "TCOS inventory search failed.",
      results: [],
    };
  }

  const rawComps: Omit<InstaCompComp, "matchScore" | "flags">[] = (data || [])
    .filter((item: any) => item?.title && Number(item?.price) > 0)
    .map((item: any) => {
      const legacyProductId = Number(item.legacy_product_id);
      const metadata =
        item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
          ? item.metadata
          : {};
      const imageUrl =
        typeof metadata.image_url === "string"
          ? metadata.image_url
          : typeof metadata.imageUrl === "string"
            ? metadata.imageUrl
            : null;

      return {
        title: String(item.title),
        price: Number(item.price),
        itemPrice: Number(item.price),
        shippingPrice: 0,
        priceIncludesShipping: false,
        currency: "USD",
        url:
          Number.isFinite(legacyProductId) && legacyProductId > 0
            ? \`/product/\${legacyProductId}\`
            : actor.type === "seller"
              ? "/seller/inventory"
              : "/admin/inventory",
        imageUrl,
        source: "tcos_inventory" as const,
        sourceLabel: "TCOS Inventory",
        sourceCategory: "marketplace" as const,
      };
    });

  const results = filterAndRankExactMatches(rawComps, ai, 3, 45).map(
    (result) => ({
      ...result,
      flags: Array.from(
        new Set([
          ...result.flags,
          "internal inventory",
          "asking price only",
          "not used for pricing",
        ]),
      ),
    }),
  );

  return {
    source: "tcos_inventory",
    label: "TCOS Inventory",
    status: results.length ? "live" : "no_matches",
    message: results.length
      ? actor.type === "seller"
        ? "Seller-scoped active inventory matches are shown as display-only asking evidence."
        : "Owner-store active inventory matches are shown as display-only asking evidence."
      : "No actor-scoped active TCOS inventory matches passed the filter.",
    results,
  };
}

`;

source = source.slice(0, start) + replacement + source.slice(end);

for (const marker of [
  '.from("inventory_items")',
  '.eq("store_id", actor.storeId)',
  '.eq("status", "active")',
  '.eq("seller_account_id", actor.sellerAccountId)',
  '"not used for pricing"',
]) {
  if (!source.includes(marker)) {
    throw new Error(`Missing internal inventory hardening marker: ${marker}`);
  }
}

const providerSection = source.slice(start, source.indexOf("async function saveScanToSupabase(", start));
if (providerSection.includes('.from("products")')) {
  throw new Error("The internal inventory provider still queries the legacy products table.");
}

fs.writeFileSync(routePath, source);
console.log("Moved InstaComp internal comps to actor-scoped active inventory_items.");
