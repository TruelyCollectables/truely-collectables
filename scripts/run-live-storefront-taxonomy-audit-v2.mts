import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
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

async function readAll(client: ReturnType<typeof createClient>, table: string) {
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 50; page += 1) {
    const from = page * pageSize;
    const { data, error } = await client
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data || []) as Row[];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  throw new Error(`${table} pagination exceeded 50,000 rows`);
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

const envFile = process.env.PRODUCTION_ENV_FILE;
if (!envFile) throw new Error("PRODUCTION_ENV_FILE is required");
const env = parseEnvFile(envFile);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRole) {
  throw new Error("Production Supabase credentials were not pulled");
}

const supabase = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const [products, inventoryItems] = await Promise.all([
  readAll(supabase, "products"),
  readAll(supabase, "inventory_items"),
]);

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
  auditVersion: 2,
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
