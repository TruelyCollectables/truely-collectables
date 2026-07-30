import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { classifyStorefrontItem } from "../src/lib/storefront-taxonomy";

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

function normalize(value: unknown): string {
  if (Array.isArray(value)) return value.map(normalize).filter(Boolean).join(" ");
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function aspectValue(aspects: Record<string, unknown>, key: string) {
  return normalize(aspects[key]);
}

function affirmative(value: unknown) {
  return /^(?:1|true|yes|y|autographed|signed)$/i.test(normalize(value));
}

function negative(value: unknown) {
  return /^(?:0|false|no|none|n\/a|na|not applicable|does not apply|not specified|unknown|not authenticated|unsigned|not autographed|not signed)$/i.test(
    normalize(value),
  );
}

function meaningful(value: unknown) {
  const text = normalize(value);
  return Boolean(text && !negative(text));
}

function strictFeatures(params: {
  title: string;
  section: string;
  metadata: Record<string, unknown>;
}) {
  const titleOriginal = String(params.title || "");
  const title = normalize(titleOriginal);
  const aspects = record(params.metadata.source_aspects);
  const features = aspectValue(aspects, "Features");
  const parallel = aspectValue(aspects, "Parallel/Variety");
  const autographedAspect = aspects.Autographed;
  const signedBy = aspects["Signed By"];
  const authentication = aspects["Autograph Authentication"];

  const negativeAutograph =
    negative(autographedAspect) ||
    /\b(?:facsimile|pre[- ]?printed|printed signature|reproduction|reprint autograph|unsigned|not signed|not autographed|non[- ]?auto|auto racing)\b/.test(
      `${title} ${features} ${parallel}`,
    );
  const titleAutograph =
    /\b(?:autograph(?:ed|s)?|autos?|signed|chirography|fresh ink|treasured ink|sign of the times|autofacts?|ink autographs?|hard[- ]signed|on[- ]card auto|sticker auto|momentous material autos?|endorsements?)\b/.test(
      title,
    );
  const autograph =
    !negativeAutograph &&
    (affirmative(autographedAspect) ||
      titleAutograph ||
      (meaningful(signedBy) && meaningful(authentication)));

  const cardFeatureEligible =
    params.section !== "Music" &&
    ![
      "Pucks",
      "Balls",
      "Jerseys",
      "Helmets",
      "Bats & Gloves",
      "Photos & Prints",
      "Tickets & Programs",
      "Pins & Souvenirs",
      "Signs & Display",
      "Watches & Accessories",
      "Comics",
      "Coins",
      "Toys & Figures",
    ].includes(params.section);

  const memorabiliaText = `${title.replace(/\bnew jersey\b/g, "")} ${features}`;
  const memorabilia =
    cardFeatureEligible &&
    /\b(?:relics?|patch(?:es)?|swatch(?:es)?|jersey|memorabilia|rookie remembrance|rookie materials?|materials?|fabrics?|rpa|prime patch|logo jumbo|team logo jumbo|emblems?|stitchings?|momentous material|game[- ]used)\b/.test(
      memorabiliaText,
    );

  const rookie =
    cardFeatureEligible &&
    (/\b(?:rookie|rookies|rated rookie|young guns|rookie remembrance|ultimate introductions)\b/i.test(
      titleOriginal,
    ) || /(?:^|[^A-Za-z])RC(?:$|[^A-Za-z])/i.test(titleOriginal));

  const gradedAspect = aspects.Graded;
  const grader = aspects["Professional Grader"];
  const graded =
    cardFeatureEligible &&
    !negative(gradedAspect) &&
    (affirmative(gradedAspect) ||
      (meaningful(grader) &&
        /\b(?:psa|bgs|sgc|cgc|csg|hga|isa|ksa)\b/i.test(String(grader))) ||
      /\b(?:psa|bgs|sgc|cgc|csg|hga|isa|ksa)\s*(?:authentic|a|\d{1,2}(?:\.\d)?)\b/i.test(
        titleOriginal,
      ));

  const serialText = `${title} ${features} ${parallel}`;
  const explicitSerial =
    /(?:^|\s)#\s*\/\s*\d{1,5}\b|(?:^|\s)\/\d{1,5}\b|serial numbered|\bnumbered\b|#'?d\b/.test(
      serialText,
    );
  const fractionMatches = Array.from(
    serialText.matchAll(/\b(\d{1,5})\s*\/\s*(\d{1,5})\b/g),
  );
  const fractionSerial = fractionMatches.some((match) => {
    const left = Number(match[1]);
    const right = Number(match[2]);
    const looksLikeSeason = left >= 1900 && left <= 2100 && right <= 99;
    const looksLikeSetNumber = params.section === "Trading Card Games";
    return !looksLikeSeason && !looksLikeSetNumber && right > 1;
  });
  const numbered = cardFeatureEligible && (explicitSerial || fractionSerial);

  return { autograph, memorabilia, rookie, graded, numbered };
}

async function readAll(client: any, table: string) {
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

async function main() {
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
  for (const item of inventoryItems) {
    const legacyId = Number(item.legacy_product_id);
    if (Number.isFinite(legacyId)) inventoryByLegacyId.set(legacyId, item);
  }

  const activeProducts = products.filter(
    (product) =>
      Number(product.quantity || 0) > 0 &&
      Number(product.price || 0) > 0 &&
      !product.archived_at,
  );

  const currentCounts = {
    autograph: 0,
    memorabilia: 0,
    rookie: 0,
    graded: 0,
    numbered: 0,
  };
  const strictCounts = { ...currentCounts };
  const suspects: Record<string, Row[]> = {
    autograph: [],
    memorabilia: [],
    rookie: [],
    graded: [],
    numbered: [],
  };
  const sections = new Map<string, number>();
  const needsReview: Row[] = [];

  for (const product of activeProducts) {
    const inventory = inventoryByLegacyId.get(Number(product.id));
    const metadata = record(inventory?.metadata);
    const title = String(inventory?.title || product.title || "Untitled");
    const description = inventory?.description ?? product.description ?? null;
    const classification = classifyStorefrontItem({
      title,
      description,
      rawSport: product.sport,
      primaryCategory: inventory?.category ?? null,
      metadata,
    });
    const strict = strictFeatures({
      title,
      section: classification.section,
      metadata,
    });
    sections.set(
      classification.section,
      (sections.get(classification.section) || 0) + 1,
    );
    if (classification.section === "Needs Review") {
      needsReview.push({
        id: product.id,
        title,
        sport: product.sport,
        category: inventory?.category,
      });
    }

    for (const feature of Object.keys(currentCounts) as Array<
      keyof typeof currentCounts
    >) {
      if (classification.features[feature]) currentCounts[feature] += 1;
      if (strict[feature]) strictCounts[feature] += 1;
      if (classification.features[feature] && !strict[feature]) {
        const aspects = record(metadata.source_aspects);
        suspects[feature].push({
          id: product.id,
          ebayItemId: product.ebay_item_id,
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
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    activeProducts: activeProducts.length,
    inventoryItems: inventoryItems.length,
    currentCounts,
    strictCounts,
    suspectCounts: Object.fromEntries(
      Object.entries(suspects).map(([key, rows]) => [key, rows.length]),
    ),
    sectionCounts: Object.fromEntries(
      Array.from(sections.entries()).sort((a, b) => b[1] - a[1]),
    ),
    needsReviewCount: needsReview.length,
    needsReview,
    suspects,
  };

  const output = path.resolve(
    process.env.AUDIT_OUTPUT || "live-taxonomy-audit.json",
  );
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        activeProducts: report.activeProducts,
        currentCounts: report.currentCounts,
        strictCounts: report.strictCounts,
        suspectCounts: report.suspectCounts,
        needsReviewCount: report.needsReviewCount,
        sectionCounts: report.sectionCounts,
        autographSuspects: report.suspects.autograph,
        gradedSuspects: report.suspects.graded,
        numberedSuspects: report.suspects.numbered,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
