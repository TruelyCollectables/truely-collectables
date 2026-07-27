import fs from "node:fs";

function mustInclude(source, needle, file) {
  if (!source.includes(needle)) {
    throw new Error(`${file}: expected marker not found: ${needle}`);
  }
}

function replaceOnce(source, before, after, file) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${file}: expected exactly one occurrence, found ${count}: ${before.slice(0, 120)}`);
  }
  return source.replace(before, after);
}

function replaceBetween(source, startMarker, endMarker, replacement, file) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${file}: could not locate replacement range ${startMarker} -> ${endMarker}`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

{
  const file = "src/lib/instacomp.ts";
  let source = fs.readFileSync(file, "utf8");
  source = replaceOnce(
    source,
    `  price: number;\n  currency: string;`,
    `  price: number;\n  itemPrice?: number | null;\n  shippingPrice?: number | null;\n  priceIncludesShipping?: boolean;\n  currency: string;`,
    file,
  );

  const parallelBlock = `function normalizedParallelDescriptor(value: string | null | undefined) {
  let normalized = normalizeText(value).replace(/\\s*&\\s*/g, " and ");
  if (!normalized || isUncertainParallel(value)) return "";

  normalized = normalized
    .replace(/\\b(?:serial(?:ly)?[-\\s]?numbered|numbered)\\b(?:\\s*(?:to|\\/))?\\s*\\d{1,6}\\b/g, " ")
    .replace(/\\b\\d{1,6}\\s*\\/\\s*\\d{1,6}\\b/g, " ")
    .replace(/(?:^|\\s)\\/\\s*\\d{1,6}\\b/g, " ")
    .replace(/\\bbase\\b/g, " ")
    .replace(/\\b(?:memorabilia|relic|autograph|auto)\\s+issue\\b/g, " ")
    .replace(/\\bissue\\b/g, " ")
    .replace(/\\s+/g, " ")
    .trim();

  if (["standard", "standard card", "regular", "regular card", "card"].includes(normalized)) {
    return "";
  }
  return normalized;
}

export function normalizeInstaCompParallelForExactMatching(
  value: string | null | undefined,
) {
  return normalizedParallelDescriptor(value);
}

function isBaseParallel(value: string | null | undefined) {
  return normalizedParallelDescriptor(value) === "";
}

function isUncertainParallel(value: string | null | undefined) {
  return /\\b(uncertain|unknown|unsure|not sure|cannot confirm|ambiguous|maybe|possibly|exact type uncertain)\\b/i.test(
    String(value || ""),
  );
}

function searchParallelPart(value: string | null | undefined) {
  const normalized = normalizedParallelDescriptor(value);
  return normalized ? cleanPart(normalized) : "";
}

function parallelTokens(value: string | null | undefined) {
  const normalized = normalizedParallelDescriptor(value);
  if (!normalized) return [];

  const tokens = normalized
    .split(/\\s+/)
    .map((token) => token.trim())
    .filter((token) => /^[a-z0-9]+$/.test(token))
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "parallel",
          "exact",
          "type",
          "uncertain",
          "version",
          "card",
          "and",
        ].includes(token),
    );
  const distinctive = tokens.filter(
    (token) => !["prizm", "refractor", "foil", "holo"].includes(token),
  );
  return distinctive.length ? distinctive : tokens;
}

`;
  source = replaceBetween(
    source,
    "function isBaseParallel",
    "const PARALLEL_COLOR_TOKENS",
    parallelBlock,
    file,
  );
  source = replaceOnce(
    source,
    `    .filter((comp) => {\n      if (!targetDenominator) return true;\n\n      return serialRunDenominatorFromTitle(comp.title) === targetDenominator;\n    })`,
    `    .filter((comp) => {\n      const compDenominator = serialRunDenominatorFromTitle(comp.title);\n      if (targetDenominator) return compDenominator === targetDenominator;\n      return compDenominator === null;\n    })`,
    file,
  );
  fs.writeFileSync(file, source);
}

{
  const file = "src/lib/instacomp-ebay-serp-provider.ts";
  let source = fs.readFileSync(file, "utf8");
  source = replaceOnce(
    source,
    `  filterAndRankExactMatches,\n  filterAndRankGuidanceMatches,`,
    `  buildInstaCompQueries,\n  filterAndRankExactMatches,\n  filterAndRankGuidanceMatches,\n  normalizeInstaCompParallelForExactMatching,`,
    file,
  );
  source = replaceOnce(
    source,
    `.update(\`serpapi_ebay_v4_\${lane}:\${normalizeKey(query)}\`)`,
    `.update(\`serpapi_ebay_v6_\${lane}:\${normalizeKey(query)}\`)`,
    file,
  );
  source = replaceOnce(
    source,
    `  url.searchParams.set("_blrs", "spell_auto_correct");`,
    `  url.searchParams.set("_blrs", "spell_auto_correct");\n  if (process.env.INSTACOMP_BYPASS_CACHE === "1") url.searchParams.set("no_cache", "true");`,
    file,
  );
  source = replaceOnce(
    source,
    `async function readCache(query: string, lane: EbayLane) {\n  if (!SUPABASE_URL || !SUPABASE_KEY) return null;`,
    `async function readCache(query: string, lane: EbayLane) {\n  if (process.env.INSTACOMP_BYPASS_CACHE === "1") return null;\n  if (!SUPABASE_URL || !SUPABASE_KEY) return null;`,
    file,
  );
  source = replaceOnce(
    source,
    `async function writeCache(query: string, lane: EbayLane, items: EbaySerpItem[]) {\n  if (!SUPABASE_URL || !SUPABASE_KEY || !items.length) return;`,
    `async function writeCache(query: string, lane: EbayLane, items: EbaySerpItem[]) {\n  if (process.env.INSTACOMP_BYPASS_CACHE === "1") return;\n  if (!SUPABASE_URL || !SUPABASE_KEY || !items.length) return;`,
    file,
  );
  source = replaceOnce(
    source,
    `  price: number;\n  thumbnail: string | null;`,
    `  price: number;\n  itemPrice: number;\n  shippingPrice: number;\n  thumbnail: string | null;`,
    file,
  );

  mustInclude(source, "function itemLink", file);
  const shippingHelper = `function extractedShipping(value: unknown): number {
  if (typeof value === "string") {
    if (/free/i.test(value)) return 0;
    const match = value.replace(/,/g, "").match(/(?:\\$|USD\\s*)(\\d+(?:\\.\\d{1,2})?)/i);
    const parsed = match ? Number(match[1]) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return extractedPrice(value);
}

`;
  source = source.replace("function itemLink", shippingHelper + "function itemLink");

  source = replaceOnce(
    source,
    `      const price = extractedPrice(item.price);\n      const link = itemLink(item);\n      if (!title || !price || !link) return null;`,
    `      const itemPrice = extractedPrice(item.price);\n      const shippingPrice = extractedShipping(item.shipping);\n      const price = Math.round((itemPrice + shippingPrice) * 100) / 100;\n      const link = itemLink(item);\n      if (!title || !itemPrice || !price || !link) return null;`,
    file,
  );
  source = replaceOnce(
    source,
    `        price,\n        thumbnail:`,
    `        price,\n        itemPrice,\n        shippingPrice,\n        thumbnail:`,
    file,
  );

  const ladderBlock = `function compactSearchPart(value: string | null | undefined) {
  return String(value || "").replace(/\\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[|\\{}()[\\]^$+*?.-]/g, "\\\\$&");
}

function sanitizeExactSearchQuery(value: string, ai: InstaCompAiResult) {
  let query = compactSearchPart(value);
  const denominator = titleSerialDenominator(ai.serialNumber);
  if (denominator) {
    query = query
      .replace(
        new RegExp(\`\\\\b\\\\d{1,6}\\\\s*\\\\/\\\\s*0*\${denominator}\\\\b\`, "gi"),
        \`/\${denominator}\`,
      )
      .replace(
        new RegExp(\`\\\\b(?:serial(?:ly)?[-\\\\s]?numbered|numbered)\\\\s*(?:to|\\\\/)?\\\\s*0*\${denominator}\\\\b\`, "gi"),
        \`/\${denominator}\`,
      );
  }
  const cert = compactIdentity(ai.certificationNumber);
  if (cert) {
    query = query.replace(new RegExp(escapeRegExp(cert), "gi"), " ");
  }
  return query
    .replace(/\\bcert(?:ification)?\\s*[#:.-]*\\s*[a-z0-9-]{5,}\\b/gi, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

export function buildExactEbayQueryLadder(params: {
  exactTitle: string | null | undefined;
  fallbackQuery: string;
  ai: InstaCompAiResult;
}) {
  const ai = params.ai;
  const built = buildInstaCompQueries(ai);
  const denominator = titleSerialDenominator(ai.serialNumber);
  const serialRun = denominator ? \`/\${denominator}\` : "";
  const parallel = normalizeInstaCompParallelForExactMatching(ai.parallel);
  const grade = [ai.gradingCompany, ai.gradeValue].map(compactSearchPart).filter(Boolean).join(" ");
  const cardNumber = compactSearchPart(ai.cardNumber)
    ? \`#\${compactSearchPart(ai.cardNumber).replace(/^#/, "")}\`
    : "";
  const identityFeatures = [
    ai.isRookie ? "rookie" : "",
    ai.isAuto ? "auto" : "",
    ai.isRelic ? "patch" : "",
  ].filter(Boolean);

  const candidates = [
    [
      grade,
      compactSearchPart(ai.year),
      compactSearchPart(ai.player),
      cardNumber,
      parallel,
      serialRun,
      ...identityFeatures,
    ].filter(Boolean).join(" "),
    [
      grade,
      compactSearchPart(ai.year),
      compactSearchPart(ai.brand),
      compactSearchPart(ai.setName),
      compactSearchPart(ai.player),
      cardNumber,
      parallel,
      serialRun,
    ].filter(Boolean).join(" "),
    sanitizeExactSearchQuery(String(params.exactTitle || ""), ai),
    sanitizeExactSearchQuery(String(params.fallbackQuery || ""), ai),
    sanitizeExactSearchQuery(built.primary, ai),
    ...built.backupQueries.map((query) => sanitizeExactSearchQuery(query, ai)),
  ];

  const seen = new Set<string>();
  return candidates
    .map((query) => query.replace(/\\s+/g, " ").trim())
    .filter((query) => query.length >= 4)
    .filter((query) => {
      const key = normalizeKey(query);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

`;
  source = source.replace("function deterministicExactTitle", ladderBlock + "function deterministicExactTitle");

  source = replaceOnce(
    source,
    `    price: item.price,\n    currency: "USD",`,
    `    price: item.price,\n    itemPrice: item.itemPrice,\n    shippingPrice: item.shippingPrice,\n    priceIncludesShipping: true,\n    currency: "USD",`,
    file,
  );

  const newUniversal = `async function providerAcrossQueries(
  queries: string[],
  ai: InstaCompAiResult,
  lane: EbayLane,
) {
  let combined: InstaCompProviderResult | null = null;
  const queryAttempts: string[] = [];
  const targetExactCount = lane === "sold" ? 5 : 8;

  for (const query of queries) {
    const next = await provider(query, ai, lane);
    queryAttempts.push(query);
    combined = combined ? mergeProviders(combined, next) : next;
    const exactCount = combined.results.filter(
      (comp) =>
        !comp.flags.includes("guidance comp") &&
        !comp.flags.includes("not used for pricing") &&
        !comp.flags.some((flag) => /parallel mismatch|not exact parallel|excluded/i.test(flag)),
    ).length;
    if (exactCount >= targetExactCount) break;
    if ((next.status === "not_configured" || next.status === "error") && next.results.length === 0) {
      break;
    }
  }

  const fallback = combined || (await provider(queries[0] || "sports card", ai, lane));
  const exactCount = fallback.results.filter(
    (comp) =>
      !comp.flags.includes("guidance comp") &&
      !comp.flags.includes("not used for pricing") &&
      !comp.flags.some((flag) => /parallel mismatch|not exact parallel|excluded/i.test(flag)),
  ).length;
  return {
    ...fallback,
    status: exactCount > 0 ? "live" : fallback.status === "not_configured" || fallback.status === "error"
      ? fallback.status
      : "no_matches",
    queryAttempts,
    message: exactCount > 0
      ? \`Found \${exactCount} exact eBay \${lane} match\${exactCount === 1 ? "" : "es"} after \${queryAttempts.length} exact-identity quer\${queryAttempts.length === 1 ? "y" : "ies"}.\`
      : \`No exact eBay \${lane} match survived identity, parallel, print-run, grade, and condition gates after \${queryAttempts.length} quer\${queryAttempts.length === 1 ? "y" : "ies"}.\`,
  };
}

export async function getUniversalEbaySerpProviders(params: {
  exactTitle: string | null | undefined;
  fallbackQuery: string;
  ai: InstaCompAiResult;
}) {
  const queries = buildExactEbayQueryLadder(params);
  const [sold, active] = await Promise.all([
    providerAcrossQueries(queries, params.ai, "sold"),
    providerAcrossQueries(queries, params.ai, "active"),
  ]);

  return {
    query: queries[0] || String(params.exactTitle || params.fallbackQuery || "").trim(),
    fallbackQuery: queries[1] || null,
    queries,
    sold,
    active,
  };
}
`;
  const universalStart = source.indexOf("export async function getUniversalEbaySerpProviders");
  if (universalStart < 0) throw new Error(`${file}: universal provider export not found`);
  source = source.slice(0, universalStart) + newUniversal;
  fs.writeFileSync(file, source);
}

{
  const file = "src/app/api/account/seller/inventory/instacomp-universal/route.ts";
  let source = fs.readFileSync(file, "utf8");
  source = replaceOnce(
    source,
    `  price: number;\n  currency: string;`,
    `  price: number;\n  itemPrice: number | null;\n  shippingPrice: number | null;\n  priceIncludesShipping: boolean;\n  currency: string;`,
    file,
  );
  source = replaceOnce(
    source,
    `    price: Math.round(price * 100) / 100,\n    currency:`,
    `    price: Math.round(price * 100) / 100,\n    itemPrice: Number.isFinite(Number(row.itemPrice)) ? Math.round(Number(row.itemPrice) * 100) / 100 : null,\n    shippingPrice: Number.isFinite(Number(row.shippingPrice)) ? Math.round(Number(row.shippingPrice) * 100) / 100 : null,\n    priceIncludesShipping: row.priceIncludesShipping === true,\n    currency:`,
    file,
  );
  source = replaceOnce(
    source,
    `  searchUrl?: string;\n}) {`,
    `  searchUrl?: string;\n  queryAttempts?: string[];\n}) {`,
    file,
  );
  source = replaceOnce(
    source,
    `    searchUrl: provider.searchUrl || null,\n  };`,
    `    searchUrl: provider.searchUrl || null,\n    queryAttempts: Array.isArray(provider.queryAttempts) ? provider.queryAttempts.slice(0, 10) : [],\n  };`,
    file,
  );
  const fallbackMarker = /^(\s*)fallbackIdentityQuery: universal\.fallbackQuery,$/gm;
  const fallbackMatches = Array.from(source.matchAll(fallbackMarker));
  if (fallbackMatches.length !== 2) {
    throw new Error(`${file}: expected two fallbackIdentityQuery rows, found ${fallbackMatches.length}`);
  }
  source = source.replace(
    fallbackMarker,
    (_match, indent) => `${indent}fallbackIdentityQuery: universal.fallbackQuery,\n${indent}exactSearchQueries: universal.queries,`,
  );
  fs.writeFileSync(file, source);
}

{
  const file = "src/app/api/account/seller/instacomp-pending/route.ts";
  let source = fs.readFileSync(file, "utf8");
  source = replaceOnce(
    source,
    `        price: optionalPrice(row.price) || 0,\n        currency:`,
    `        price: optionalPrice(row.price) || 0,\n        itemPrice: optionalPrice(row.itemPrice),\n        shippingPrice: optionalPrice(row.shippingPrice),\n        priceIncludesShipping: row.priceIncludesShipping === true,\n        currency:`,
    file,
  );
  source = replaceOnce(
    source,
    `        searchUrl: textValue(row.searchUrl),\n      };`,
    `        searchUrl: textValue(row.searchUrl),\n        queryAttempts: Array.isArray(row.queryAttempts)\n          ? row.queryAttempts.map((query) => String(query)).slice(0, 10)\n          : [],\n      };`,
    file,
  );
  fs.writeFileSync(file, source);
}

{
  const file = "src/app/seller/instacomp-pending/page.tsx";
  let source = fs.readFileSync(file, "utf8");
  source = replaceOnce(
    source,
    `  price: number;\n  currency: string;`,
    `  price: number;\n  itemPrice: number | null;\n  shippingPrice: number | null;\n  priceIncludesShipping: boolean;\n  currency: string;`,
    file,
  );
  source = replaceOnce(
    source,
    `      searchUrl: string | null;\n    }>;`,
    `      searchUrl: string | null;\n      queryAttempts: string[];\n    }>;`,
    file,
  );
  source = source.replaceAll(
    `{money(comp.price)}`,
    `{money(comp.price)}{comp.priceIncludesShipping ? " delivered" : ""}`,
  );
  fs.writeFileSync(file, source);
}

console.log("Applied InstaComp exact-market proof hardening.");