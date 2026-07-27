import fs from "node:fs";
import path from "node:path";

const baseUrl = String(process.env.INSTACOMP_BENCHMARK_URL || "")
  .trim()
  .replace(/\/$/, "");
const token = String(process.env.INSTACOMP_BENCHMARK_TOKEN || "").trim();
const requestedTarget = Number(process.env.INSTACOMP_BENCHMARK_TARGET || 25);
const target = Number.isInteger(requestedTarget) && requestedTarget > 0 ? requestedTarget : 25;
const requestedConcurrency = Number(process.env.INSTACOMP_BENCHMARK_CONCURRENCY || 2);
const concurrency = Number.isInteger(requestedConcurrency)
  ? Math.max(1, Math.min(requestedConcurrency, 3))
  : 2;
const reportsDirectory = path.resolve(
  process.env.INSTACOMP_BENCHMARK_REPORT_DIR || "reports",
);
const jsonPath = path.join(reportsDirectory, "instacomp-ebay-25-report.json");
const markdownPath = path.join(reportsDirectory, "instacomp-ebay-25-report.md");

if (!baseUrl) throw new Error("INSTACOMP_BENCHMARK_URL is required.");
if (token.length < 32) throw new Error("INSTACOMP_BENCHMARK_TOKEN must be at least 32 characters.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function percent(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toFixed(digits)}%`;
}

function median(values) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function markdownCell(value) {
  return clean(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

async function fetchJson(url, options = {}, timeoutMs = 330_000) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {
      ok: false,
      error: `Non-JSON response (${response.status}): ${text.slice(0, 500)}`,
    };
  }
  return { response, payload };
}

async function loadManifest() {
  const { response, payload } = await fetchJson(
    `${baseUrl}/api/instacomp/benchmark/ebay-25`,
    { method: "GET" },
    60_000,
  );
  if (!response.ok || !payload?.ok || !Array.isArray(payload?.cases)) {
    throw new Error(
      payload?.error || `Could not load benchmark manifest (${response.status}).`,
    );
  }
  return payload;
}

async function runCase(testCase, attempt = 1) {
  const startedAt = Date.now();
  try {
    const { response, payload } = await fetchJson(
      `${baseUrl}/api/instacomp/benchmark/ebay-25`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: testCase.id }),
      },
    );

    const result = {
      ...payload,
      caseId: payload?.caseId || testCase.id,
      requestedCase: testCase,
      httpStatus: response.status,
      runnerAttempt: attempt,
      runnerDurationMs: Date.now() - startedAt,
    };

    if (
      !response.ok &&
      attempt < 3 &&
      [408, 425, 429, 500, 502, 503, 504].includes(response.status)
    ) {
      const waitMs = attempt * 15_000;
      console.log(
        `[retry ${attempt + 1}/3] ${testCase.id}: HTTP ${response.status}; waiting ${Math.round(waitMs / 1000)}s`,
      );
      await sleep(waitMs);
      return runCase(testCase, attempt + 1);
    }

    return result;
  } catch (error) {
    if (attempt < 3) {
      const waitMs = attempt * 15_000;
      console.log(
        `[retry ${attempt + 1}/3] ${testCase.id}: ${error instanceof Error ? error.message : "request failure"}; waiting ${Math.round(waitMs / 1000)}s`,
      );
      await sleep(waitMs);
      return runCase(testCase, attempt + 1);
    }
    return {
      ok: false,
      status: "runner_error",
      caseId: testCase.id,
      requestedCase: testCase,
      httpStatus: null,
      runnerAttempt: attempt,
      runnerDurationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown runner error.",
    };
  }
}

function summarize(results, manifest, startedAt, completedAt) {
  const completed = results.filter(
    (result) => result?.ok && result?.status === "completed" && result?.grade,
  );
  const incomplete = results.filter(
    (result) => !(result?.ok && result?.status === "completed" && result?.grade),
  );
  const scores = completed.map((result) => Number(result.grade.score)).filter(Number.isFinite);
  const errorRows = completed.flatMap((result) =>
    (result.grade?.weirdErrors || []).map((error) => ({
      caseId: result.caseId,
      score: result.grade?.score ?? null,
      itemUrl: result.eBay?.url || null,
      ...error,
    })),
  );
  const errorCounts = new Map();
  for (const error of errorRows) {
    const key = `${error.severity}:${error.code}`;
    const current = errorCounts.get(key) || {
      severity: error.severity,
      code: error.code,
      count: 0,
      cases: [],
    };
    current.count += 1;
    current.cases.push(error.caseId);
    errorCounts.set(key, current);
  }

  const fieldTotals = new Map();
  for (const result of completed) {
    for (const fieldCheck of result.grade?.fieldChecks || []) {
      const current = fieldTotals.get(fieldCheck.field) || {
        field: fieldCheck.field,
        pass: 0,
        partial: 0,
        fail: 0,
        total: 0,
      };
      current[fieldCheck.status] += 1;
      current.total += 1;
      fieldTotals.set(fieldCheck.field, current);
    }
  }

  const catalogConfirmed = completed.filter((result) =>
    Boolean(
      result.scan?.catalogEvidence?.selectedMatch ||
        result.scan?.catalogEvidence?.compIdentity,
    ),
  ).length;
  const catalogReturned = completed.filter((result) =>
    Boolean(result.scan?.catalogEvidence),
  ).length;
  const exactSoldSupported = completed.filter(
    (result) =>
      Number(
        result.scan?.exactMarket?.pricingEligibleSoldCount ??
          result.scan?.exactMarket?.soldCount ??
          0,
      ) > 0,
  ).length;
  const trustedPrices = completed.filter((result) => {
    const price = Number(result.scan?.exactMarket?.trustedSuggestedPrice);
    const soldCount = Number(
      result.scan?.exactMarket?.pricingEligibleSoldCount ??
        result.scan?.exactMarket?.soldCount ??
        0,
    );
    return Number.isFinite(price) && price > 0 && soldCount > 0;
  }).length;
  const cleanupFailures = completed.filter(
    (result) => result.cleanup?.status === "error",
  ).length;
  const providerErrors = completed.filter(
    (result) => result.scan?.exactMarket?.status === "provider_error",
  ).length;
  const sellerTitleWeak = completed.filter((result) =>
    (result.grade?.weirdErrors || []).some(
      (error) => error.code === "SELLER_TITLE_WEAK_OR_MISLABELED",
    ),
  ).length;
  const criticalCards = completed.filter(
    (result) => Number(result.grade?.criticalErrorCount || 0) > 0,
  ).length;
  const majorCards = completed.filter(
    (result) => Number(result.grade?.majorErrorCount || 0) > 0,
  ).length;
  const passed = completed.filter((result) => result.grade?.pass).length;

  return {
    schema: "tcos.instacompEbay25BenchmarkReport.v1",
    generatedAt: completedAt,
    startedAt,
    completedAt,
    previewUrl: baseUrl,
    requestedTarget: target,
    manifestTarget: manifest.target,
    poolSize: manifest.poolSize,
    concurrency,
    summary: {
      attemptedCases: results.length,
      completedCards: completed.length,
      incompleteCases: incomplete.length,
      targetMet: completed.length >= target,
      passedCards: passed,
      passRate: completed.length ? (passed / completed.length) * 100 : 0,
      averageScore: scores.length
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length
        : null,
      medianScore: median(scores),
      lowestScore: scores.length ? Math.min(...scores) : null,
      highestScore: scores.length ? Math.max(...scores) : null,
      catalogEvidenceReturned: catalogReturned,
      catalogIdentityConfirmed: catalogConfirmed,
      catalogCoverageRate: completed.length
        ? (catalogConfirmed / completed.length) * 100
        : 0,
      exactSoldSupportedCards: exactSoldSupported,
      exactSoldSupportRate: completed.length
        ? (exactSoldSupported / completed.length) * 100
        : 0,
      trustedPriceCards: trustedPrices,
      providerErrorCards: providerErrors,
      cleanupFailures,
      weakOrMislabeledSellerTitles: sellerTitleWeak,
      cardsWithCriticalErrors: criticalCards,
      cardsWithMajorErrors: majorCards,
      totalWeirdErrors: errorRows.length,
      criticalErrors: errorRows.filter((error) => error.severity === "critical").length,
      majorErrors: errorRows.filter((error) => error.severity === "major").length,
      minorErrors: errorRows.filter((error) => error.severity === "minor").length,
    },
    fieldAccuracy: Array.from(fieldTotals.values()).map((field) => ({
      ...field,
      passRate: field.total ? (field.pass / field.total) * 100 : 0,
      passOrPartialRate: field.total
        ? ((field.pass + field.partial) / field.total) * 100
        : 0,
    })),
    weirdErrorCounts: Array.from(errorCounts.values()).sort((left, right) => {
      const severityRank = { critical: 0, major: 1, minor: 2 };
      return (
        (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9) ||
        right.count - left.count ||
        left.code.localeCompare(right.code)
      );
    }),
    completed,
    incomplete,
    allResults: results,
  };
}

function renderMarkdown(report) {
  const s = report.summary;
  const lines = [
    "# InstaComp — 25 Real eBay Card Benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Test design",
    "",
    `- Target: ${report.requestedTarget} successfully scanned live eBay listings with a verified front/back image pair using the highest available eBay image resolution.`,
    "- Source listings: active eBay sports-card listings discovered through the official eBay Browse API.",
    "- Ground truth: official Upper Deck 2024-25 Series 1 manufacturer checklist records.",
    "- Scanner: the real InstaComp live route, including front/back vision, OCR, identity guard, consensus, TCOS catalog evidence, exact sold/active providers, diagnostics, and persistence cleanup.",
    "- A seller title was treated as a claim, not ground truth.",
    "- Active listings were not counted as sold comps and could not create a trusted price by themselves.",
    "- Benchmark-created scan rows were deleted after grading; cleanup failures are reported.",
    "",
    "## Executive result",
    "",
    `- Completed: **${s.completedCards}/${report.requestedTarget}** (${s.targetMet ? "target met" : "target not met"})`,
    `- Passed at 94% identity score with no critical error: **${s.passedCards}/${s.completedCards}** (${percent(s.passRate)})`,
    `- Average score: **${s.averageScore === null ? "—" : s.averageScore.toFixed(1)}**`,
    `- Median score: **${s.medianScore === null ? "—" : s.medianScore.toFixed(1)}**`,
    `- Score range: **${s.lowestScore ?? "—"}–${s.highestScore ?? "—"}**`,
    `- TCOS catalog identity confirmed: **${s.catalogIdentityConfirmed}/${s.completedCards}** (${percent(s.catalogCoverageRate)})`,
    `- Strict exact sold support: **${s.exactSoldSupportedCards}/${s.completedCards}** (${percent(s.exactSoldSupportRate)})`,
    `- Trusted sold-backed prices: **${s.trustedPriceCards}/${s.completedCards}**`,
    `- Exact-market provider errors: **${s.providerErrorCards}**`,
    `- Benchmark scan cleanup failures: **${s.cleanupFailures}**`,
    `- Weak or mislabeled seller titles: **${s.weakOrMislabeledSellerTitles}**`,
    `- Weird errors: **${s.totalWeirdErrors}** — ${s.criticalErrors} critical, ${s.majorErrors} major, ${s.minorErrors} minor`,
    "",
    "## Important catalog finding",
    "",
    "The project’s intended manufacturer master catalog is TCOS Checklist Registry™. The current scanner branch still uses a small starter TCOS Curated Checklist rather than the complete Registry. Every official checklist card that InstaComp recognizes visually but cannot confirm through its internal catalog is reported as `TCOS_CHECKLIST_REGISTRY_COVERAGE_GAP`; the benchmark does not silently pretend the master catalog is complete.",
    "",
    "## Field accuracy",
    "",
    "| Field | Pass | Partial | Fail | Pass rate | Pass or partial |",
    "|---|---:|---:|---:|---:|---:|",
  ];

  report.fieldAccuracy.forEach((field) => {
    lines.push(
      `| ${markdownCell(field.field)} | ${field.pass} | ${field.partial} | ${field.fail} | ${percent(field.passRate)} | ${percent(field.passOrPartialRate)} |`,
    );
  });

  lines.push("", "## Weird-error totals", "");
  if (!report.weirdErrorCounts.length) {
    lines.push("No weird errors were recorded.");
  } else {
    lines.push("| Severity | Code | Count | Cases |", "|---|---|---:|---|");
    report.weirdErrorCounts.forEach((error) => {
      lines.push(
        `| ${error.severity.toUpperCase()} | \`${markdownCell(error.code)}\` | ${error.count} | ${markdownCell(error.cases.join(", "))} |`,
      );
    });
  }

  lines.push(
    "",
    "## Card-by-card grading",
    "",
    "| # | Score | Result | eBay card | Official expected identity | InstaComp identity | Catalog | Sold comps | Weird errors |",
    "|---:|---:|---|---|---|---|---|---:|---|",
  );

  report.completed.forEach((result, index) => {
    const expected = result.expected || result.requestedCase?.expected || {};
    const ai = result.scan?.ai || {};
    const expectedIdentity = [
      expected.year,
      expected.brand,
      expected.product,
      expected.setName,
      expected.player,
      expected.parallel,
      expected.cardNumber ? `#${expected.cardNumber}` : null,
      expected.serialDenominator ? `/${expected.serialDenominator}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const actualIdentity = [
      ai.year,
      ai.brand,
      ai.setName,
      ai.player,
      ai.parallel,
      ai.cardNumber ? `#${ai.cardNumber}` : null,
      ai.serialNumber,
    ]
      .filter(Boolean)
      .join(" ");
    const catalog =
      result.scan?.catalogEvidence?.selectedMatch ||
      result.scan?.catalogEvidence?.compIdentity
        ? "Confirmed"
        : result.scan?.catalogEvidence
          ? `Returned: ${clean(result.scan.catalogEvidence.status) || "unconfirmed"}`
          : "No evidence";
    const errors = (result.grade?.weirdErrors || [])
      .map((error) => `${error.severity}:${error.code}`)
      .join(", ");
    const itemLabel = result.eBay?.url
      ? `[${markdownCell(result.eBay.title || result.caseId)}](${result.eBay.url})`
      : markdownCell(result.eBay?.title || result.caseId);
    lines.push(
      `| ${index + 1} | ${result.grade?.score ?? "—"} | ${result.grade?.pass ? "PASS" : "REVIEW"} | ${itemLabel} | ${markdownCell(expectedIdentity)} | ${markdownCell(actualIdentity || "No identity")} | ${markdownCell(catalog)} | ${Number(result.scan?.exactMarket?.soldCount || 0)} | ${markdownCell(errors || "None")} |`,
    );
  });

  lines.push("", "## Detailed errors by card", "");
  report.completed.forEach((result, index) => {
    lines.push(
      `### ${index + 1}. ${clean(result.eBay?.title || result.caseId)}`,
      "",
      `- Score: ${result.grade?.score ?? "—"}/100`,
      `- eBay: ${result.eBay?.url || "not reported"}`,
      `- Front image: ${result.eBay?.frontImageUrl || "not reported"}`,
      `- Back image: ${result.eBay?.backImageUrl || "not reported"}`,
      `- Official checklist: ${result.catalogSourceUrl || "not reported"}`,
      `- Image-role selection: ${result.eBay?.imageRoles?.method || "unknown"}, confidence ${percent(Number(result.eBay?.imageRoles?.confidence || 0) * 100)}`,
      `- InstaComp confidence: ${percent(Number(result.scan?.ai?.confidence || 0) * 100)}`,
      `- Trusted price: ${money(result.scan?.exactMarket?.trustedSuggestedPrice)}`,
      "",
    );
    const errors = result.grade?.weirdErrors || [];
    if (!errors.length) {
      lines.push("No weird errors recorded.", "");
    } else {
      errors.forEach((error) => {
        lines.push(
          `- **${error.severity.toUpperCase()} — ${error.code}:** ${error.detail}`,
        );
      });
      lines.push("");
    }
  });

  if (report.incomplete.length) {
    lines.push("## Cases that did not complete", "");
    report.incomplete.forEach((result) => {
      lines.push(
        `- **${clean(result.caseId || "unknown case")}** — ${clean(result.status || "error")}: ${clean(result.error || `HTTP ${result.httpStatus ?? "unknown"}`)}`,
      );
    });
    lines.push("");
  }

  lines.push(
    "## Grading note",
    "",
    "This report separates scanner identity accuracy, TCOS catalog coverage, eBay listing quality, and market-provider availability. A catalog coverage gap is not automatically an image-recognition failure, and zero exact sold comps is not treated as a reason to invent a price.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

fs.mkdirSync(reportsDirectory, { recursive: true });
const startedAt = new Date().toISOString();
let report;

try {
  const manifest = await loadManifest();
  const cases = manifest.cases;
  const results = [];
  let nextIndex = 0;
  let completedCount = 0;

  async function worker(workerId) {
    while (true) {
      if (completedCount >= target) return;
      const index = nextIndex;
      nextIndex += 1;
      const testCase = cases[index];
      if (!testCase) return;

      console.log(
        `[worker ${workerId}] ${index + 1}/${cases.length} ${testCase.id} — starting`,
      );
      const result = await runCase(testCase);
      results[index] = result;
      if (result?.ok && result?.status === "completed" && result?.grade) {
        completedCount += 1;
        console.log(
          `[worker ${workerId}] ${testCase.id} — completed ${result.grade.score}/100 (${completedCount}/${target})`,
        );
      } else {
        console.log(
          `[worker ${workerId}] ${testCase.id} — ${result?.status || "failed"}: ${clean(result?.error) || `HTTP ${result?.httpStatus ?? "unknown"}`}`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, (_, index) => worker(index + 1)),
  );

  const compactResults = results.filter(Boolean);
  const completedAt = new Date().toISOString();
  report = summarize(compactResults, manifest, startedAt, completedAt);
} catch (error) {
  const completedAt = new Date().toISOString();
  report = {
    schema: "tcos.instacompEbay25BenchmarkReport.v1",
    generatedAt: completedAt,
    startedAt,
    completedAt,
    previewUrl: baseUrl,
    requestedTarget: target,
    manifestTarget: null,
    poolSize: 0,
    concurrency,
    summary: {
      attemptedCases: 0,
      completedCards: 0,
      incompleteCases: 1,
      targetMet: false,
      passedCards: 0,
      passRate: 0,
      averageScore: null,
      medianScore: null,
      lowestScore: null,
      highestScore: null,
      catalogEvidenceReturned: 0,
      catalogIdentityConfirmed: 0,
      catalogCoverageRate: 0,
      exactSoldSupportedCards: 0,
      exactSoldSupportRate: 0,
      trustedPriceCards: 0,
      providerErrorCards: 0,
      weakOrMislabeledSellerTitles: 0,
      cardsWithCriticalErrors: 0,
      cardsWithMajorErrors: 0,
      totalWeirdErrors: 0,
      criticalErrors: 0,
      majorErrors: 0,
      minorErrors: 0,
    },
    fieldAccuracy: [],
    weirdErrorCounts: [],
    completed: [],
    incomplete: [
      {
        ok: false,
        status: "runner_setup_error",
        error: error instanceof Error ? error.message : "Unknown setup error.",
      },
    ],
    allResults: [],
  };
}

fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, renderMarkdown(report));

console.log(`JSON report: ${jsonPath}`);
console.log(`Markdown report: ${markdownPath}`);
console.log(
  `Completed ${report.summary.completedCards}/${target}; average ${report.summary.averageScore ?? "n/a"}; catalog confirmed ${report.summary.catalogIdentityConfirmed}/${report.summary.completedCards}.`,
);

if (!report.summary.targetMet) {
  process.exitCode = 1;
}
