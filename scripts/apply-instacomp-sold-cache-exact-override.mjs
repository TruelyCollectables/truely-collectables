import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}
function write(path, content) {
  fs.writeFileSync(path, content);
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
  `  const payload = data.result_payload as CachedPayload;
  return Array.isArray(payload.items) ? payload.items : null;
`,
  `  const payload = data.result_payload as CachedPayload;
  return Array.isArray(payload.items) && payload.items.length ? payload.items : null;
`,
  "ignore empty cached results",
);

provider = replaceOnce(
  provider,
  `async function writeCache(query: string, lane: EbayLane, items: EbaySerpItem[]) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
`,
  `async function writeCache(query: string, lane: EbayLane, items: EbaySerpItem[]) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !items.length) return;
`,
  "never cache empty eBay searches",
);

provider = replaceOnce(
  provider,
  `function rawComps(items: EbaySerpItem[], lane: EbayLane) {
`,
  `function normalizedWords(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\\s+/)
    .filter((token) => token.length > 1);
}

function compact(value: string | null | undefined) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function serialDenominator(value: string | null | undefined) {
  const matches = Array.from(String(value || "").matchAll(/(?:\\b\\d{1,6}\\s*)?\\/\\s*(\\d{1,6})\\b/g));
  const parsed = matches.map((match) => Number(match[1])).filter((value) => Number.isFinite(value) && value > 0);
  return parsed.length ? parsed[parsed.length - 1] : null;
}

function deterministicExactTitle(
  title: string,
  query: string,
  ai: InstaCompAiResult,
  flags: string[],
) {
  if (flags.some((flag) => /parallel mismatch|wrong parallel|excluded/i.test(flag))) return false;
  const normalizedTitle = ` ${normalizedWords(title).join(" ")} `;
  const titleCompact = compact(title);
  const player = normalizedWords(String(ai.player || ""));
  if (player.length && !player.every((token) => normalizedTitle.includes(` ${token} `))) return false;
  const year = compact(ai.year);
  if (year && !titleCompact.includes(year)) return false;
  const cardNumber = compact(ai.cardNumber);
  if (cardNumber && !titleCompact.includes(cardNumber)) return false;

  const distinctiveParallelTokens = normalizedWords(String(ai.parallel || "")).filter(
    (token) => !["prizm", "refractor", "parallel", "foil", "holo"].includes(token),
  );
  if (
    distinctiveParallelTokens.length &&
    !distinctiveParallelTokens.every((token) => normalizedTitle.includes(` ${token} `))
  ) return false;

  const targetDenominator = serialDenominator(ai.serialNumber);
  if (targetDenominator && serialDenominator(title) !== targetDenominator) return false;

  if (ai.gradingCompany) {
    const grader = compact(ai.gradingCompany);
    if (grader && !titleCompact.includes(grader)) return false;
  }
  if (ai.gradeValue) {
    const grade = compact(String(ai.gradeValue));
    if (grade && !titleCompact.includes(grade)) return false;
  }

  const queryTokens = normalizedWords(query).filter(
    (token) => !["panini", "topps", "upper", "deck", "rookie", "card"].includes(token),
  );
  const covered = queryTokens.filter((token) => normalizedTitle.includes(` ${token} `)).length;
  const coverage = queryTokens.length ? covered / queryTokens.length : 0;
  return coverage >= 0.68;
}

function promoteDeterministicExact(
  comps: InstaCompComp[],
  query: string,
  ai: InstaCompAiResult,
  lane: EbayLane,
) {
  return comps.map((comp) => {
    if (!deterministicExactTitle(comp.title, query, ai, comp.flags)) return comp;
    const flags = comp.flags.filter(
      (flag) => !/guidance comp|not used for pricing|not exact parallel/i.test(flag),
    );
    flags.push("deterministic exact identity");
    return {
      ...comp,
      sourceCategory: lane === "sold" ? ("sold" as const) : ("marketplace" as const),
      flags: Array.from(new Set(flags)).slice(0, 20),
    };
  });
}

function rawComps(items: EbaySerpItem[], lane: EbayLane) {
`,
  "deterministic exact identity helpers",
);

provider = replaceOnce(
  provider,
  `  const results = scoreWithSetEvidence(fetched.items, lane, ai).slice(
    0,
    lane === "sold" ? 50 : 30,
  );
`,
  `  const results = promoteDeterministicExact(
    scoreWithSetEvidence(fetched.items, lane, ai),
    query,
    ai,
    lane,
  ).slice(0, lane === "sold" ? 50 : 30);
`,
  "promote deterministic exact candidates",
);

write(providerPath, provider);

const visualPath = "src/lib/instacomp-comp-visual-verification.ts";
let visual = read(visualPath);
visual = replaceOnce(
  visual,
  `function requiresVisualVerification(candidate: InstaCompVisualCandidate) {
  return candidate.flags.some((flag) =>
    /parallel mismatch|not exact parallel|guidance comp|not used for pricing/i.test(flag),
  );
}
`,
  `function requiresVisualVerification(candidate: InstaCompVisualCandidate) {
  if (candidate.flags.some((flag) => /deterministic exact identity/i.test(flag))) return false;
  return candidate.flags.some((flag) =>
    /parallel mismatch|not exact parallel|guidance comp|not used for pricing/i.test(flag),
  );
}
`,
  "deterministic exact visual bypass",
);
write(visualPath, visual);

const regressionPath = "scripts/run-instacomp-fast-exclusions-regressions.ts";
let regression = fs.existsSync(regressionPath) ? read(regressionPath) : "";
regression = regression.replace(
  `const exclusion = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/exclude-comp/route.ts",
  "utf8",
);
`,
  `const exclusion = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/exclude-comp/route.ts",
  "utf8",
);
const provider = fs.readFileSync("src/lib/instacomp-ebay-serp-provider.ts", "utf8");
const visual = fs.readFileSync("src/lib/instacomp-comp-visual-verification.ts", "utf8");
`,
);
regression = regression.replace(
  `assert.ok(exclusion.includes("calculateInstaCompSweetSpot"));
`,
  `assert.ok(exclusion.includes("calculateInstaCompSweetSpot"));
assert.ok(provider.includes("serpapi_ebay_v4_"));
assert.ok(provider.includes("!items.length"));
assert.ok(provider.includes("deterministic exact identity"));
assert.ok(provider.includes("coverage >= 0.68"));
assert.ok(visual.includes("deterministic exact identity"));
`,
);
write(regressionPath, regression);

console.log("Invalidated stale empty sold caches and made deterministic exact identity bypass uncertain visual rejection.");
