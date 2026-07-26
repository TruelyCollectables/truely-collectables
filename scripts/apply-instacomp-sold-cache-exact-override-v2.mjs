import fs from "node:fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}
function write(file, content) {
  fs.writeFileSync(file, content);
}
function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Missing ${label}`);
  return source.replace(search, replacement);
}

const providerPath = "src/lib/instacomp-ebay-serp-provider.ts";
let provider = read(providerPath);

provider = replaceOnce(
  provider,
  '.update(`serpapi_ebay_${lane}:${normalizeKey(query)}`)',
  '.update(`serpapi_ebay_v4_${lane}:${normalizeKey(query)}`)',
  "versioned eBay cache key",
);
provider = replaceOnce(
  provider,
  "  const payload = data.result_payload as CachedPayload;\n  return Array.isArray(payload.items) ? payload.items : null;",
  "  const payload = data.result_payload as CachedPayload;\n  return Array.isArray(payload.items) && payload.items.length ? payload.items : null;",
  "ignore empty cached results",
);
provider = replaceOnce(
  provider,
  "async function writeCache(query: string, lane: EbayLane, items: EbaySerpItem[]) {\n  if (!SUPABASE_URL || !SUPABASE_KEY) return;",
  "async function writeCache(query: string, lane: EbayLane, items: EbaySerpItem[]) {\n  if (!SUPABASE_URL || !SUPABASE_KEY || !items.length) return;",
  "never cache empty eBay searches",
);

const deterministicHelpers = [
  "function normalizedWords(value: string) {",
  "  return String(value || \"\")",
  "    .toLowerCase()",
  "    .replace(/[^a-z0-9]+/g, \" \" )",
  "    .trim()",
  "    .split(/\\s+/)",
  "    .filter((token) => token.length > 1);",
  "}",
  "",
  "function compactIdentity(value: string | null | undefined) {",
  "  return String(value || \"\").toLowerCase().replace(/[^a-z0-9]/g, \"\");",
  "}",
  "",
  "function titleSerialDenominator(value: string | null | undefined) {",
  "  const matches = Array.from(String(value || \"\").matchAll(/(?:\\b\\d{1,6}\\s*)?\\/\\s*(\\d{1,6})\\b/g));",
  "  const parsed = matches",
  "    .map((match) => Number(match[1]))",
  "    .filter((number) => Number.isFinite(number) && number > 0);",
  "  return parsed.length ? parsed[parsed.length - 1] : null;",
  "}",
  "",
  "function deterministicExactTitle(",
  "  title: string,",
  "  query: string,",
  "  ai: InstaCompAiResult,",
  "  flags: string[],",
  ") {",
  "  if (flags.some((flag) => /parallel mismatch|wrong parallel|excluded/i.test(flag))) return false;",
  "  const normalizedTitle = \" \" + normalizedWords(title).join(\" \" ) + \" \";",
  "  const titleCompact = compactIdentity(title);",
  "  const player = normalizedWords(String(ai.player || \"\"));",
  "  if (player.length && !player.every((token) => normalizedTitle.includes(\" \" + token + \" \"))) return false;",
  "  const year = compactIdentity(ai.year);",
  "  if (year && !titleCompact.includes(year)) return false;",
  "  const cardNumber = compactIdentity(ai.cardNumber);",
  "  if (cardNumber && !titleCompact.includes(cardNumber)) return false;",
  "",
  "  const distinctiveParallelTokens = normalizedWords(String(ai.parallel || \"\")).filter(",
  "    (token) => ![\"prizm\", \"refractor\", \"parallel\", \"foil\", \"holo\"].includes(token),",
  "  );",
  "  if (",
  "    distinctiveParallelTokens.length &&",
  "    !distinctiveParallelTokens.every((token) => normalizedTitle.includes(\" \" + token + \" \"))",
  "  ) return false;",
  "",
  "  const targetDenominator = titleSerialDenominator(ai.serialNumber);",
  "  if (targetDenominator && titleSerialDenominator(title) !== targetDenominator) return false;",
  "",
  "  if (ai.gradingCompany) {",
  "    const grader = compactIdentity(ai.gradingCompany);",
  "    if (grader && !titleCompact.includes(grader)) return false;",
  "  }",
  "  if (ai.gradeValue) {",
  "    const grade = compactIdentity(String(ai.gradeValue));",
  "    if (grade && !titleCompact.includes(grade)) return false;",
  "  }",
  "",
  "  const queryTokens = normalizedWords(query).filter(",
  "    (token) => ![\"panini\", \"topps\", \"upper\", \"deck\", \"rookie\", \"card\"].includes(token),",
  "  );",
  "  const covered = queryTokens.filter((token) => normalizedTitle.includes(\" \" + token + \" \" )).length;",
  "  const coverage = queryTokens.length ? covered / queryTokens.length : 0;",
  "  return coverage >= 0.68;",
  "}",
  "",
  "function promoteDeterministicExact(",
  "  comps: InstaCompComp[],",
  "  query: string,",
  "  ai: InstaCompAiResult,",
  "  lane: EbayLane,",
  ") {",
  "  return comps.map((comp) => {",
  "    if (!deterministicExactTitle(comp.title, query, ai, comp.flags)) return comp;",
  "    const flags = comp.flags.filter(",
  "      (flag) => !/guidance comp|not used for pricing|not exact parallel/i.test(flag),",
  "    );",
  "    flags.push(\"deterministic exact identity\");",
  "    return {",
  "      ...comp,",
  "      sourceCategory: lane === \"sold\" ? (\"sold\" as const) : (\"marketplace\" as const),",
  "      flags: Array.from(new Set(flags)).slice(0, 20),",
  "    };",
  "  });",
  "}",
].join("\n");

provider = replaceOnce(
  provider,
  "function rawComps(items: EbaySerpItem[], lane: EbayLane) {",
  deterministicHelpers + "\n\nfunction rawComps(items: EbaySerpItem[], lane: EbayLane) {",
  "deterministic exact identity helpers",
);
provider = replaceOnce(
  provider,
  "  const results = scoreWithSetEvidence(fetched.items, lane, ai).slice(\n    0,\n    lane === \"sold\" ? 50 : 30,\n  );",
  "  const results = promoteDeterministicExact(\n    scoreWithSetEvidence(fetched.items, lane, ai),\n    query,\n    ai,\n    lane,\n  ).slice(0, lane === \"sold\" ? 50 : 30);",
  "promote deterministic exact candidates",
);
write(providerPath, provider);

const visualPath = "src/lib/instacomp-comp-visual-verification.ts";
let visual = read(visualPath);
visual = replaceOnce(
  visual,
  "function requiresVisualVerification(candidate: InstaCompVisualCandidate) {\n  return candidate.flags.some((flag) =>\n    /parallel mismatch|not exact parallel|guidance comp|not used for pricing/i.test(flag),\n  );\n}",
  "function requiresVisualVerification(candidate: InstaCompVisualCandidate) {\n  if (candidate.flags.some((flag) => /deterministic exact identity/i.test(flag))) return false;\n  return candidate.flags.some((flag) =>\n    /parallel mismatch|not exact parallel|guidance comp|not used for pricing/i.test(flag),\n  );\n}",
  "deterministic exact visual bypass",
);
write(visualPath, visual);

const regressionPath = "scripts/run-instacomp-fast-exclusions-regressions.ts";
let regression = read(regressionPath);
if (!regression.includes('const provider = fs.readFileSync')) {
  regression = regression.replace(
    'const exclusion = fs.readFileSync(\n  "src/app/api/account/seller/instacomp-pending/exclude-comp/route.ts",\n  "utf8",\n);',
    'const exclusion = fs.readFileSync(\n  "src/app/api/account/seller/instacomp-pending/exclude-comp/route.ts",\n  "utf8",\n);\nconst provider = fs.readFileSync("src/lib/instacomp-ebay-serp-provider.ts", "utf8");\nconst visual = fs.readFileSync("src/lib/instacomp-comp-visual-verification.ts", "utf8");',
  );
}
if (!regression.includes('provider.includes("serpapi_ebay_v4_")')) {
  regression = regression.replace(
    'assert.ok(exclusion.includes("calculateInstaCompSweetSpot"));',
    'assert.ok(exclusion.includes("calculateInstaCompSweetSpot"));\nassert.ok(provider.includes("serpapi_ebay_v4_"));\nassert.ok(provider.includes("!items.length"));\nassert.ok(provider.includes("deterministic exact identity"));\nassert.ok(provider.includes("coverage >= 0.68"));\nassert.ok(visual.includes("deterministic exact identity"));',
  );
}
write(regressionPath, regression);

console.log("Applied sold-cache reset and deterministic exact-match acceptance safely.");
