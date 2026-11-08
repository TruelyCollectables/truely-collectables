import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DIRECTORY = resolve(
  process.cwd(),
  process.env.HOCKEY_CHECKLIST_SHARD_DIRECTORY || ".hockey-checklist-reconcile",
);
const OUTPUT = resolve(
  process.cwd(),
  process.env.HOCKEY_CHECKLIST_OUTPUT || ".hockey-checklist-reconcile/receipt.json",
);
const EXPECTED_SHARDS = Math.max(
  1,
  Math.min(16, Number(process.env.HOCKEY_CHECKLIST_SHARD_COUNT || 4)),
);

type Result = Record<string, unknown> & {
  sourceUrl?: string;
  status?: string;
  unchanged?: boolean;
};

type ShardReceipt = {
  source?: string;
  boundary?: string;
  latestExpected?: string;
  categoryPages?: unknown[];
  candidateCount?: number;
  shardCount?: number;
  shardIndex?: number;
  selectedCandidateCount?: number;
  selectedSourceUrls?: string[];
  results?: Result[];
};

function loadReceipts() {
  if (!existsSync(DIRECTORY)) return [];
  return readdirSync(DIRECTORY)
    .filter((name) => /^shard-\d+\.json$/i.test(name))
    .map((name) => {
      const path = resolve(DIRECTORY, name);
      return JSON.parse(readFileSync(path, "utf8")) as ShardReceipt;
    });
}

function main() {
  const completedAt = new Date().toISOString();
  const shards = loadReceipts();
  const shardByIndex = new Map<number, ShardReceipt>();
  for (const shard of shards) {
    if (Number.isInteger(shard.shardIndex)) shardByIndex.set(shard.shardIndex as number, shard);
  }

  const first = shards[0] || {};
  const candidateCount = Number(first.candidateCount || 0);
  const resultsByUrl = new Map<string, Result>();
  const expectedUrls = new Set<string>();
  const structuralErrors: Result[] = [];

  for (let index = 0; index < EXPECTED_SHARDS; index += 1) {
    const shard = shardByIndex.get(index);
    if (!shard) {
      structuralErrors.push({
        sourceUrl: `shard:${index}`,
        status: "failed",
        message: `Missing hockey reconcile shard ${index}/${EXPECTED_SHARDS}.`,
      });
      continue;
    }
    if (shard.shardCount !== EXPECTED_SHARDS) {
      structuralErrors.push({
        sourceUrl: `shard:${index}`,
        status: "failed",
        message: `Shard ${index} reported shardCount=${shard.shardCount}; expected ${EXPECTED_SHARDS}.`,
      });
    }
    for (const sourceUrl of shard.selectedSourceUrls || []) expectedUrls.add(sourceUrl);
    for (const result of shard.results || []) {
      if (result.sourceUrl) resultsByUrl.set(result.sourceUrl, result);
    }
  }

  for (const sourceUrl of expectedUrls) {
    if (!resultsByUrl.has(sourceUrl)) {
      resultsByUrl.set(sourceUrl, {
        sourceUrl,
        status: "failed",
        message: "Shard completed without a terminal result for this source.",
      });
    }
  }

  const results = [...resultsByUrl.values()].sort((left, right) =>
    String(left.sourceUrl || "").localeCompare(String(right.sourceUrl || "")),
  );
  const unresolved = [
    ...results.filter((result) => !["imported", "unchanged"].includes(String(result.status || ""))),
    ...structuralErrors,
  ];
  if (candidateCount && expectedUrls.size !== candidateCount) {
    unresolved.push({
      sourceUrl: "aggregate:candidate-coverage",
      status: "failed",
      message: `Shard source coverage was ${expectedUrls.size}/${candidateCount}.`,
    });
  }
  if (candidateCount && results.length !== candidateCount) {
    unresolved.push({
      sourceUrl: "aggregate:result-coverage",
      status: "failed",
      message: `Terminal source coverage was ${results.length}/${candidateCount}.`,
    });
  }

  const counts = results.reduce<Record<string, number>>((acc, result) => {
    const status = String(result.status || "unknown");
    acc[status] = (acc[status] || 0) + 1;
    if (result.unchanged === true) acc.unchanged = (acc.unchanged || 0) + 1;
    return acc;
  }, {});
  const passed = candidateCount > 0 && results.length === candidateCount && unresolved.length === 0;
  const receipt = {
    schema: "tcos.hockeyChecklistReconcileReceipt.v2",
    source: first.source || "https://upperdeck.com/checklist-category/hockey/",
    boundary: first.boundary || null,
    latestExpected: first.latestExpected || "2026-27 MVP",
    categoryPages: first.categoryPages || [],
    candidateCount,
    shardCount: EXPECTED_SHARDS,
    completedAt,
    status: passed ? "passed" : "failed",
    completedCount: results.length,
    counts,
    unresolvedCount: unresolved.length,
    unresolved,
    results,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
  if (!passed) process.exitCode = 1;
}

main();
