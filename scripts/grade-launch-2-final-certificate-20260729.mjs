import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const evidence = path.join(root, ".audit", "launch-2-final");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(evidence, name), "utf8"));

const expectedMainSha = process.env.EXPECTED_MAIN_SHA;
const prior = readJson("prior-audit-jobs.json");
const runtime = readJson("runtime-integrations.json");
const pages = ["home", "shop", "signup", "cart"];
const lighthouse = Object.fromEntries(
  pages.map((name) => [name, readJson(`lighthouse-${name}.json`)]),
);

const requiredPriorJobs = [
  "Repository inventory and source security",
  "Dependencies, lint, TypeScript, and production build",
  "API route and privilege audit",
  "Live Production crawl and access checks",
  "Simulation shard 0",
  "Simulation shard 1",
  "Simulation shard 2",
  "Simulation shard 3",
  "Simulation shard 4",
  "Simulation shard 5",
];
const priorByName = new Map((prior.jobs || []).map((job) => [job.name, job]));
const priorFailures = requiredPriorJobs
  .map((name) => ({ name, job: priorByName.get(name) }))
  .filter(({ job }) => !job || job.status !== "completed" || job.conclusion !== "success")
  .map(({ name, job }) => ({ name, status: job?.status || "missing", conclusion: job?.conclusion || "missing" }));
if (prior.head_sha !== process.env.PRIOR_AUDIT_HEAD_SHA) {
  priorFailures.push({ name: "Prior audit head SHA", status: prior.head_sha || "missing", conclusion: "unexpected" });
}

const lighthouseRows = [];
const lighthouseBlockers = [];
for (const [name, report] of Object.entries(lighthouse)) {
  const category = (id) => Math.round((report.categories[id]?.score || 0) * 100);
  const audit = (id) => report.audits[id];
  const row = {
    page: name,
    performance: category("performance"),
    accessibility: category("accessibility"),
    bestPractices: category("best-practices"),
    seo: category("seo"),
    crawlable: audit("is-crawlable")?.score,
    canonical: audit("canonical")?.score,
    selectName: audit("select-name")?.score,
    labelContentNameMismatch: audit("label-content-name-mismatch")?.score,
    labelContentFailingNodes: audit("label-content-name-mismatch")?.details?.items?.length || 0,
  };
  lighthouseRows.push(row);
  if (row.accessibility < 90) lighthouseBlockers.push(`${name} accessibility ${row.accessibility}`);
  if (row.bestPractices < 85) lighthouseBlockers.push(`${name} best practices ${row.bestPractices}`);
  if (row.canonical !== 1) lighthouseBlockers.push(`${name} canonical audit did not pass`);
  if (["home", "shop"].includes(name)) {
    if (row.seo < 90) lighthouseBlockers.push(`${name} SEO ${row.seo}`);
    if (row.crawlable !== 1) lighthouseBlockers.push(`${name} is not crawlable`);
  } else {
    const sources = audit("is-crawlable")?.details?.items?.map((item) => String(item.source || "")) || [];
    if (row.crawlable !== 0 || !sources.some((source) => /noindex/i.test(source))) {
      lighthouseBlockers.push(`${name} is not proven intentionally noindex`);
    }
  }
  if (name === "shop" && row.selectName !== 1) lighthouseBlockers.push("shop select-name did not pass");
  if (![1, null, undefined].includes(row.labelContentNameMismatch) || row.labelContentFailingNodes !== 0) {
    lighthouseBlockers.push(`${name} has a visible-label accessible-name failure`);
  }
}

const runtimeBlockers = (runtime.findings || []).filter((finding) => finding.severity === "blocker");
const currentSource = readJson("current-source.json");
const sourceProblems = [];
if (currentSource.mainSha !== expectedMainSha) sourceProblems.push(`main SHA ${currentSource.mainSha}`);
if (currentSource.productionDeploymentSourceSha !== expectedMainSha) {
  sourceProblems.push(`Production deployment source ${currentSource.productionDeploymentSourceSha || "unverified"}`);
}

const blockers = [
  ...priorFailures.map((item) => ({ area: "prior-full-audit", message: `${item.name}: ${item.status}/${item.conclusion}` })),
  ...runtimeBlockers,
  ...lighthouseBlockers.map((message) => ({ area: "lighthouse", message })),
  ...sourceProblems.map((message) => ({ area: "exact-source", message })),
];
const warnings = (runtime.findings || []).filter((finding) => finding.severity === "warning");
const overall = blockers.length === 0 ? "verified" : "blocked";
const certificate = {
  schema: "truely.collectables.launch-2-final-certificate.v1",
  generatedAt: new Date().toISOString(),
  sourceSha: expectedMainSha,
  productionDeploymentSourceSha: currentSource.productionDeploymentSourceSha,
  overall,
  counts: {
    blockers: blockers.length,
    warnings: warnings.length,
    priorGreenJobs: requiredPriorJobs.length - priorFailures.length,
    lighthousePages: lighthouseRows.length,
    runtimeFindings: runtime.findings?.length || 0,
  },
  priorAuditRun: {
    runId: Number(process.env.PRIOR_AUDIT_RUN_ID),
    headSha: prior.head_sha,
    requiredJobs: requiredPriorJobs,
    failures: priorFailures,
  },
  lighthouse: lighthouseRows,
  runtimeSummaries: runtime.summaries,
  runtimeWarnings: warnings,
  blockers,
  unverifiedByDesign: [
    "No controlled real-money charge was created by this read-only certificate.",
    "No physical delivery, postage purchase, carrier acceptance scan, refund, or dispute was manufactured.",
    "No customer or owner inbox receipt was claimed without a controlled real message.",
  ],
};
fs.writeFileSync(path.join(evidence, "final-launch-2-certificate.json"), `${JSON.stringify(certificate, null, 2)}\n`);
fs.writeFileSync(path.join(evidence, "final-launch-2-certificate.md"), [
  "# TruelyCollectables.com Launch 2.0 final certificate",
  "",
  `- Overall: **${overall.toUpperCase()}**`,
  `- Exact source: \`${expectedMainSha}\``,
  `- Exact Production deployment source: \`${certificate.productionDeploymentSourceSha}\``,
  `- Blockers: ${blockers.length}`,
  `- Warnings: ${warnings.length}`,
  `- Prior full-audit green jobs reused: ${certificate.counts.priorGreenJobs}/${requiredPriorJobs.length}`,
  "",
  "## Lighthouse",
  ...lighthouseRows.map((row) => `- ${row.page}: Performance ${row.performance}, Accessibility ${row.accessibility}, Best Practices ${row.bestPractices}, SEO ${row.seo}, crawlable ${row.crawlable}, canonical ${row.canonical}`),
  "",
  "## Blockers",
  ...(blockers.length ? blockers.map((item) => `- ${item.area}: ${item.message}`) : ["- None"]),
  "",
  "## Runtime warnings",
  ...(warnings.length ? warnings.map((item) => `- ${item.area}: ${item.message}`) : ["- None"]),
  "",
  "## Separate real-world proofs",
  ...certificate.unverifiedByDesign.map((item) => `- ${item}`),
].join("\n") + "\n");

console.log(JSON.stringify({ overall, blockers: blockers.length, warnings: warnings.length, lighthouseRows }, null, 2));
if (overall !== "verified") process.exit(1);
