import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`Could not find ${label}.`);
  }
  return content.replace(search, replacement);
}

const instacompPath = "src/lib/instacomp.ts";
let instacomp = read(instacompPath);

instacomp = replaceOnce(
  instacomp,
  "export function buildInstaCompQueries(ai: InstaCompAiResult) {",
  `const PARALLEL_COLOR_TOKENS = [
  "red",
  "blue",
  "green",
  "gold",
  "silver",
  "purple",
  "orange",
  "pink",
  "black",
  "white",
  "yellow",
  "teal",
  "aqua",
  "bronze",
  "copper",
] as const;

function titleHasWholeToken(title: string, token: string) {
  return new RegExp(\`(?:^|[^a-z0-9])\${token}(?:$|[^a-z0-9])\`, "i").test(title);
}

export function explainInstaCompParallelMismatch(
  title: string,
  targetParallel: string | null | undefined,
) {
  const requiredTokens = parallelTokens(targetParallel);
  if (!requiredTokens.length) return null;

  const normalizedTitle = normalizeText(title);
  const targetColors = requiredTokens.filter((token) =>
    PARALLEL_COLOR_TOKENS.includes(token as (typeof PARALLEL_COLOR_TOKENS)[number]),
  );
  const listingColors = PARALLEL_COLOR_TOKENS.filter((token) =>
    titleHasWholeToken(normalizedTitle, token),
  );
  const conflictingColors = listingColors.filter(
    (token) => !targetColors.includes(token),
  );
  const expected = cleanPart(targetParallel) || "the identified parallel";

  if (conflictingColors.length) {
    return \`parallel mismatch: expected \${expected}; listing says \${conflictingColors.join("/")}\`;
  }

  const missingTokens = requiredTokens.filter(
    (token) => !titleHasWholeToken(normalizedTitle, token),
  );
  if (!missingTokens.length) return null;

  return \`parallel mismatch: expected \${expected}; missing \${missingTokens.join(" ")}\`;
}

export function buildInstaCompQueries(ai: InstaCompAiResult) {`,
  "parallel mismatch helper insertion",
);

instacomp = replaceOnce(
  instacomp,
  "  const certificationNumber = cleanCertificationNumber(ai.certificationNumber);\n",
  "  const certificationNumber = cleanCertificationNumber(ai.certificationNumber);\n  const parallelMismatch = explainInstaCompParallelMismatch(title, ai.parallel);\n",
  "parallel mismatch scoring declaration",
);

instacomp = replaceOnce(
  instacomp,
  "  if (serial.normalized) {",
  `  if (parallelMismatch) {
    score -= 150;
    flags.push(parallelMismatch);
    flags.push("not exact parallel");
  }

  if (serial.normalized) {`,
  "parallel mismatch scoring penalty",
);

instacomp = replaceOnce(
  instacomp,
  '    .filter((comp) => !comp.flags.includes("excluded"))\n    .filter(\n      (comp) =>\n        (!requiresPlayerEvidence || comp.flags.includes("player"))',
  '    .filter((comp) => !comp.flags.includes("excluded"))\n    .filter(\n      (comp) =>\n        !comp.flags.some((flag) => flag.startsWith("parallel mismatch:")),\n    )\n    .filter(\n      (comp) =>\n        (!requiresPlayerEvidence || comp.flags.includes("player"))',
  "exact parallel fail-closed filter",
);

write(instacompPath, instacomp);

const sellerScanPath = "src/app/api/account/seller/inventory/instacomp/route.ts";
let sellerScan = read(sellerScanPath);

sellerScan = replaceOnce(
  sellerScan,
  "      ? Math.max(0, Math.min(1, Number(value.matchScore)))\n      : null,",
  "      ? Number(value.matchScore)\n      : null,",
  "raw evidence score preservation",
);

sellerScan = replaceOnce(
  sellerScan,
  "/excluded|guidance comp|not used for pricing/i.test(flag)",
  "/excluded|guidance comp|not used for pricing|parallel mismatch|not exact parallel/i.test(flag)",
  "rejected evidence classification",
);

sellerScan = replaceOnce(
  sellerScan,
  `    const activeCompetition = compactCompList(
      Array.isArray(scan?.remainingCards) ? scan.remainingCards : scan?.activeComps,
      20,
    ).filter(
      (comp) =>
        (comp.sourceCategory === "marketplace" || comp.sourceCategory === "auction") &&
        !isOwnStoreCompetition(comp),
    );`,
  `    const competitionCandidates = compactCompList(
      Array.isArray(scan?.remainingCards) ? scan.remainingCards : scan?.activeComps,
      20,
    ).filter(
      (comp) =>
        (comp.sourceCategory === "marketplace" || comp.sourceCategory === "auction") &&
        !isOwnStoreCompetition(comp),
    );
    const activeCompetition = competitionCandidates.filter(
      (comp) => !isExcludedEvidence(comp),
    );
    const rejectedCandidates = competitionCandidates.filter((comp) =>
      isExcludedEvidence(comp),
    );`,
  "active competition exact-only split",
);

sellerScan = replaceOnce(
  sellerScan,
  "        providerCoverage,\n        soldCompEvidence,\n        activeCompetition,\n        sourceLinks,",
  "        providerCoverage,\n        soldCompEvidence,\n        activeCompetition,\n        rejectedCandidates,\n        sourceLinks,",
  "rejected candidate persistence",
);

sellerScan = replaceOnce(
  sellerScan,
  "      activeCompetition,\n      sourceLinks,\n      providerCoverage,",
  "      activeCompetition,\n      rejectedCandidates,\n      sourceLinks,\n      providerCoverage,",
  "rejected candidate response",
);

write(sellerScanPath, sellerScan);

const pendingApiPath = "src/app/api/account/seller/instacomp-pending/route.ts";
let pendingApi = read(pendingApiPath);
pendingApi = replaceOnce(
  pendingApi,
  "          activeCompetition: evidenceList(instaComp.activeCompetition),\n          providerCoverage:",
  "          activeCompetition: evidenceList(instaComp.activeCompetition),\n          rejectedCandidates: evidenceList(instaComp.rejectedCandidates),\n          providerCoverage:",
  "pending rejected candidates response",
);
write(pendingApiPath, pendingApi);

const pendingPagePath = "src/app/seller/instacomp-pending/page.tsx";
let pendingPage = read(pendingPagePath);
pendingPage = replaceOnce(
  pendingPage,
  "    activeCompetition: CompEvidence[];\n    providerCoverage:",
  "    activeCompetition: CompEvidence[];\n    rejectedCandidates: CompEvidence[];\n    providerCoverage:",
  "pending rejected candidates type",
);

pendingPage = replaceOnce(
  pendingPage,
  `function scoreLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return \`\${Math.round(value * 100)}% match\`;
}`,
  `function scoreLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return \`\${Math.round(value * 100)}% normalized match\`;
  return \`\${Math.round(value)} evidence points\`;
}`,
  "honest score label",
);

pendingPage = replaceOnce(
  pendingPage,
  `                        {item.instaComp.sourceLinks.ebayActiveUrl ? (`,
  `                        {item.instaComp.rejectedCandidates.length ? (
                          <details className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3">
                            <summary className="cursor-pointer text-sm font-black text-rose-950">
                              Rejected near matches ({item.instaComp.rejectedCandidates.length})
                            </summary>
                            <p className="mt-2 text-xs font-semibold text-rose-900">
                              These listings were found but failed exact identity. They are never competition and never affect price.
                            </p>
                            <div className="mt-2 space-y-2">
                              {item.instaComp.rejectedCandidates.map((comp, index) => (
                                <a
                                  key={\`rejected-\${comp.url}-\${index}\`}
                                  href={comp.url || "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block rounded-md border border-rose-200 bg-white p-2"
                                >
                                  <span className="block text-sm font-black text-neutral-950">{comp.title}</span>
                                  <span className="mt-1 block text-xs font-bold text-neutral-700">
                                    {money(comp.price)} · {comp.sourceLabel}
                                    {scoreLabel(comp.matchScore) ? \` · \${scoreLabel(comp.matchScore)}\` : ""}
                                  </span>
                                  <span className="mt-1 block text-[11px] font-semibold text-rose-800">
                                    {comp.flags.filter((flag) => /parallel mismatch|not exact parallel|guidance comp|not used for pricing/i.test(flag)).join(" · ") || "Rejected by exact-card identity filter"}
                                  </span>
                                </a>
                              ))}
                            </div>
                          </details>
                        ) : null}
                        {item.instaComp.sourceLinks.ebayActiveUrl ? (`,
  "rejected candidates panel",
);

write(pendingPagePath, pendingPage);

const regressionPath = "scripts/run-instacomp-exact-parallel-regressions.ts";
write(
  regressionPath,
  `import assert from "node:assert/strict";
import {
  explainInstaCompParallelMismatch,
  filterAndRankExactMatches,
  filterAndRankGuidanceMatches,
  scoreCompMatch,
  type InstaCompAiResult,
  type InstaCompComp,
} from "../src/lib/instacomp";

const target: InstaCompAiResult = {
  player: "Shedeur Sanders",
  year: "2025",
  brand: "Panini",
  setName: "Select Rookie Swatches",
  cardNumber: "RSW-SSS",
  parallel: "Red Prizm",
  serialNumber: null,
  team: "Browns",
  sport: "Football",
  isRookie: true,
  isAuto: false,
  isRelic: true,
  conditionGuess: "Near Mint",
  confidence: 1,
  notes: null,
};

const comp = (title: string): Omit<InstaCompComp, "matchScore" | "flags"> => ({
  title,
  price: 10,
  currency: "USD",
  url: \`https://example.com/\${encodeURIComponent(title)}\`,
  imageUrl: null,
  source: "ebay_active",
  sourceLabel: "eBay Active",
  sourceCategory: "marketplace",
});

const red = comp("2025 Panini Select Shedeur Sanders Rookie Swatches Red Prizm #RSW-SSS");
const blue = comp("2025 Panini Select Shedeur Sanders Rookie Swatches Blue Prizm #RSW-SSS");
const redWhiteBlue = comp("2025 Panini Select Shedeur Sanders Rookie Swatches Red White Blue Prizm #RSW-SSS");

assert.equal(filterAndRankExactMatches([red], target, 5, 0).length, 1);
assert.equal(filterAndRankExactMatches([blue], target, 5, 0).length, 0);
assert.equal(filterAndRankExactMatches([redWhiteBlue], target, 5, 0).length, 0);
assert.match(explainInstaCompParallelMismatch(blue.title, target.parallel) || "", /expected Red Prizm; listing says blue/i);
assert.match(explainInstaCompParallelMismatch(redWhiteBlue.title, target.parallel) || "", /expected Red Prizm; listing says blue\/white|expected Red Prizm; listing says white\/blue/i);
assert.ok(scoreCompMatch(red.title, target).score > scoreCompMatch(blue.title, target).score);
const guidance = filterAndRankGuidanceMatches([blue], target, 5, -1000);
assert.equal(guidance.length, 1);
assert.ok(guidance[0].flags.some((flag) => /parallel mismatch: expected Red Prizm; listing says blue/i.test(flag)));
assert.ok(guidance[0].flags.includes("not exact parallel"));

console.log("InstaComp exact-parallel regression passed: Blue and Red/White/Blue Prizms are rejected for a Red Prizm target and cannot appear as exact competition.");
`,
);

const workflowPath = ".github/workflows/active-market-integrity.yml";
let workflow = read(workflowPath);
workflow = workflow.replaceAll(
  '      - "src/lib/active-market-*.ts"',
  '      - "src/lib/active-market-*.ts"\n      - "src/lib/instacomp.ts"',
);
workflow = workflow.replaceAll(
  '      - "scripts/run-active-market-*-simulations.ts"',
  '      - "scripts/run-active-market-*-simulations.ts"\n      - "scripts/run-instacomp-exact-parallel-regressions.ts"',
);
workflow = replaceOnce(
  workflow,
  `      - name: Validate checkout webhook idempotency
        run: node --import tsx scripts/run-checkout-webhook-idempotency-simulations.ts`,
  `      - name: Validate InstaComp exact-parallel rejection
        run: node --import tsx scripts/run-instacomp-exact-parallel-regressions.ts

      - name: Validate checkout webhook idempotency
        run: node --import tsx scripts/run-checkout-webhook-idempotency-simulations.ts`,
  "exact-parallel workflow step",
);
write(workflowPath, workflow);

fs.rmSync("scripts/apply-instacomp-exact-parallel-guard.mjs");
fs.rmSync(".github/workflows/apply-instacomp-exact-parallel-guard.yml");
fs.rmSync("docs/instacomp-exact-parallel-guard-trigger.md");

console.log("Applied InstaComp exact-parallel guard and removed one-shot patch machinery.");
