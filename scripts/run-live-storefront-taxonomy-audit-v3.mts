import fs from "node:fs";
import path from "node:path";
import { deriveStrictStorefrontFeatures } from "../src/lib/storefront-feature-evidence.ts";
import {
  classifyStorefrontItem,
  type StorefrontFeatureKey,
} from "../src/lib/storefront-taxonomy.ts";

type Row = Record<string, any>;

function parseEnvFile(file: string) {
  const parsed: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function normalized(value: unknown) {
  return String(value ?? "")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function obviousObjectSection(titleValue: unknown) {
  const title = normalized(titleValue);
  const cardSignal =
    /(?:^|\s)#[a-z0-9-]+\b|\b(?:card|rookie|rc|refractor|parallel|prizm|relic card|jersey card|patch card|swatch card)\b/.test(
      title,
    );
  if (cardSignal) return null;

  if (/\b(?:music cd|compact disc|cd booklet|album booklet|liner notes?|vinyl record)\b/.test(title)) {
    return "Music";
  }
  if (/\b(?:wristwatch|sunglasses|eyewear|oakley)\b/.test(title)) {
    return "Watches & Accessories";
  }
  if (/\b(?:signed|autographed|official|game[- ]used|full[- ]size|regulation)\b[\s\S]*\bpuck\b|\bpuck\b[\s\S]*\b(?:signed|autographed|official|game[- ]used)\b/.test(title)) {
    return "Pucks";
  }
  if (/\b(?:signed|autographed|official|game[- ]used|full[- ]size|regulation)\b[\s\S]*\b(?:baseball|football|basketball|soccer ball|softball|volleyball|golf ball)\b|\b(?:baseball|football|basketball|soccer ball|softball|volleyball|golf ball)\b[\s\S]*\b(?:signed|autographed|official|game[- ]used|full[- ]size|regulation)\b/.test(title)) {
    return "Balls";
  }
  if (/\b(?:signed|autographed|game[- ]used|game[- ]worn)\b[\s\S]*\bjersey\b|\bjersey\b[\s\S]*\b(?:signed|autographed|game[- ]used|game[- ]worn)\b/.test(title)) {
    return "Jerseys";
  }
  if (/\b(?:signed|autographed|game[- ]used|full[- ]size)\b[\s\S]*\bhelmet\b|\bhelmet\b[\s\S]*\b(?:signed|autographed|game[- ]used|full[- ]size)\b/.test(title)) {
    return "Helmets";
  }
  if (/\b(?:8x10|16x20|photo|photograph|poster|lithograph)\b/.test(title)) {
    return "Photos & Prints";
  }
  return null;
}

async function queryProductionCatalog(params: {
  projectRef: string;
  accessToken: string;
}) {
  const endpoint = `https://api.supabase.com/v1/projects/${params.projectRef}/database/query`;
  const query = `
    select json_build_object(
      'products', coalesce((
        select json_agg(json_build_object(
          'id', p.id,
          'store_id', p.store_id,
          'sku', p.sku,
          'title', p.title,
          'description', p.description,
          'price', p.price,
          'quantity', p.quantity,
          'archived_at', p.archived_at,
          'sport', p.sport,
          'ebay_item_id', p.ebay_item_id
        ) order by p.id)
        from public.products p
      ), '[]'::json),
      'inventory_items', coalesce((
        select json_agg(json_build_object(
          'id', i.id,
          'store_id', i.store_id,
          'legacy_product_id', i.legacy_product_id,
          'sku', i.sku,
          'title', i.title,
          'description', i.description,
          'category', i.category,
          'metadata', i.metadata
        ) order by i.id)
        from public.inventory_items i
      ), '[]'::json)
    ) as payload;
  `;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, parameters: [], read_only: true }),
  });
  const body = await response.text();
  if (!response.ok) {
    const safe = body
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .slice(0, 4000);
    throw new Error(
      `Supabase catalog audit query failed with HTTP ${response.status}: ${safe}`,
    );
  }
  const result = body ? JSON.parse(body) : [];
  const rawPayload = result?.[0]?.payload;
  const payload =
    typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
  if (!payload || !Array.isArray(payload.products) || !Array.isArray(payload.inventory_items)) {
    throw new Error("Supabase catalog audit returned an invalid payload");
  }
  return {
    products: payload.products as Row[],
    inventoryItems: payload.inventory_items as Row[],
  };
}

const envFile = process.env.PRODUCTION_ENV_FILE;
if (!envFile) throw new Error("PRODUCTION_ENV_FILE is required");
const env = parseEnvFile(envFile);
const productionUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const accessToken = process.env.GH_SUPABASE_ACCESS_TOKEN;
if (!productionUrl || !/^https:\/\//.test(productionUrl)) {
  throw new Error("Production NEXT_PUBLIC_SUPABASE_URL was not pulled");
}
if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN is unavailable");
const projectRef = new URL(productionUrl).hostname.split(".")[0];
if (!projectRef) throw new Error("Unable to derive the Supabase project reference");

const { products, inventoryItems } = await queryProductionCatalog({
  projectRef,
  accessToken,
});
const inventoryByLegacyId = new Map<number, Row>();
const inventoryBySku = new Map<string, Row>();
for (const item of inventoryItems) {
  if (item.legacy_product_id !== null && item.legacy_product_id !== undefined) {
    const legacyId = Number(item.legacy_product_id);
    if (Number.isFinite(legacyId)) inventoryByLegacyId.set(legacyId, item);
  }
  const sku = String(item.sku || "").trim();
  if (sku) inventoryBySku.set(sku, item);
}

const activeProducts = products.filter(
  (product) =>
    Number(product.quantity || 0) > 0 &&
    Number(product.price || 0) > 0 &&
    !product.archived_at,
);
const featureKeys: StorefrontFeatureKey[] = [
  "autograph",
  "memorabilia",
  "rookie",
  "graded",
  "numbered",
];
const currentCounts = Object.fromEntries(featureKeys.map((key) => [key, 0])) as Record<StorefrontFeatureKey, number>;
const strictCounts = Object.fromEntries(featureKeys.map((key) => [key, 0])) as Record<StorefrontFeatureKey, number>;
const falsePositives = Object.fromEntries(featureKeys.map((key) => [key, []])) as Record<StorefrontFeatureKey, Row[]>;
const falseNegatives = Object.fromEntries(featureKeys.map((key) => [key, []])) as Record<StorefrontFeatureKey, Row[]>;
const sectionCounts = new Map<string, number>();
const needsReview: Row[] = [];
const sectionSuspects: Row[] = [];

for (const product of activeProducts) {
  const sku = String(product.sku || "").trim();
  const inventory =
    inventoryByLegacyId.get(Number(product.id)) ||
    (sku ? inventoryBySku.get(sku) : undefined);
  const metadata = record(inventory?.metadata);
  const aspects = record(metadata.source_aspects);
  const title = String(inventory?.title || product.title || "Untitled");
  const classification = classifyStorefrontItem({
    title,
    description: inventory?.description ?? product.description ?? null,
    rawSport: product.sport,
    primaryCategory: inventory?.category ?? null,
    metadata,
  });
  const strict = deriveStrictStorefrontFeatures({
    title,
    section: classification.section,
  });

  sectionCounts.set(
    classification.section,
    (sectionCounts.get(classification.section) || 0) + 1,
  );
  const baseEvidence = {
    id: Number(product.id),
    ebayItemId: product.ebay_item_id ?? null,
    title,
    section: classification.section,
    primaryCategory: inventory?.category ?? null,
    autographedAspect: aspects.Autographed ?? null,
    signedBy: aspects["Signed By"] ?? null,
    autographAuthentication: aspects["Autograph Authentication"] ?? null,
    gradedAspect: aspects.Graded ?? null,
    professionalGrader: aspects["Professional Grader"] ?? null,
    featuresAspect: aspects.Features ?? null,
    parallelAspect: aspects["Parallel/Variety"] ?? null,
  };

  if (classification.section === "Needs Review") needsReview.push(baseEvidence);
  const expectedObjectSection = obviousObjectSection(title);
  if (expectedObjectSection && expectedObjectSection !== classification.section) {
    sectionSuspects.push({ ...baseEvidence, expectedObjectSection });
  }

  for (const feature of featureKeys) {
    if (classification.features[feature]) currentCounts[feature] += 1;
    if (strict[feature]) strictCounts[feature] += 1;
    if (classification.features[feature] && !strict[feature]) {
      falsePositives[feature].push(baseEvidence);
    }
    if (!classification.features[feature] && strict[feature]) {
      falseNegatives[feature].push(baseEvidence);
    }
  }
}

const report = {
  auditVersion: 3,
  generatedAt: new Date().toISOString(),
  activeProducts: activeProducts.length,
  inventoryItems: inventoryItems.length,
  currentCounts,
  strictCounts,
  falsePositiveCounts: Object.fromEntries(
    featureKeys.map((key) => [key, falsePositives[key].length]),
  ),
  falseNegativeCounts: Object.fromEntries(
    featureKeys.map((key) => [key, falseNegatives[key].length]),
  ),
  sectionCounts: Object.fromEntries(
    Array.from(sectionCounts.entries()).sort((left, right) => right[1] - left[1]),
  ),
  needsReviewCount: needsReview.length,
  sectionSuspectCount: sectionSuspects.length,
  needsReview,
  sectionSuspects,
  falsePositives,
  falseNegatives,
};

const output = path.resolve(
  process.env.AUDIT_OUTPUT || "live-taxonomy-audit.json",
);
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
