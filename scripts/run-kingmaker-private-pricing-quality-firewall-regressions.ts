import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = {
  migration: read(
    "supabase/migrations/20260804050000_private_pricing_coverage_quality_firewall.sql",
  ),
  runner: read("scripts/run-kingmaker-private-pricing-coverage-refresh.mjs"),
  server: read("src/lib/kingmaker-private-pricing-coverage-server.ts"),
  component: read(
    "src/app/admin/instacomp/pricing/_components/private-pricing-coverage.tsx",
  ),
};

const prohibitedPublisherName = String.fromCharCode(
  98,
  101,
  99,
  107,
  101,
  116,
  116,
);
for (const [name, contents] of Object.entries(files)) {
  assert.equal(
    contents.toLowerCase().includes(prohibitedPublisherName),
    false,
    `${name} contains prohibited publisher attribution`,
  );
}

for (const marker of [
  "tcos_kingmaker_private_pricing_attack_queue",
  "tcos_refresh_kingmaker_private_pricing_attack_queue",
  "actionability_status",
  "actionability_reasons",
  "actionable",
  "parser_review",
  "product_contains_price_text",
  "set_label_looks_like_pricing_instruction",
  "set_group_count",
  "aggregate_private_reference_only",
]) {
  assert.ok(files.migration.includes(marker), `Migration missing ${marker}`);
}

for (const marker of [
  "tcos_refresh_kingmaker_private_pricing_coverage_snapshot",
  "tcos_refresh_kingmaker_private_pricing_attack_queue",
  "baseRefresh",
  "attackRefresh",
  "actionableRows",
  "parserReviewRows",
  "pricesPromotedByThisOperation: 0",
]) {
  assert.ok(files.runner.includes(marker), `Refresh runner missing ${marker}`);
}

for (const marker of [
  "KINGMAKER_PRIVATE_PRICING_ACTIONABILITY",
  "actionabilityStatus",
  "actionabilityReasons",
  "setGroupCount",
  "actionableGroups",
  "parserReviewGroups",
  "sourceSnapshotRefreshedAt",
]) {
  assert.ok(files.server.includes(marker), `Server parser missing ${marker}`);
}

for (const marker of [
  "Parser-noise quarantine",
  "Actionable Rows",
  "Parser Review",
  "Actionable",
  "Parser review",
  "Correct or confirm the parsed release labels",
  "setGroupCount",
  "actionabilityReasons",
]) {
  assert.ok(files.component.includes(marker), `Coverage workspace missing ${marker}`);
}

for (const forbidden of [
  "rawText",
  "raw_text",
  "valueLow",
  "valueHigh",
  "originalFilename",
  "sourceSha256",
  "storageObjectPath",
]) {
  assert.equal(
    files.server.includes(forbidden),
    false,
    `Server exposes ${forbidden}`,
  );
  assert.equal(
    files.component.includes(forbidden),
    false,
    `Workspace exposes ${forbidden}`,
  );
}

const rankingStart = files.migration.indexOf(
  "row_number() over (",
  files.migration.indexOf("create or replace function public.tcos_kingmaker_private_pricing_coverage_report"),
);
const rankingEnd = files.migration.indexOf(
  ")::integer as priority_rank",
  rankingStart,
);
assert.ok(rankingStart >= 0 && rankingEnd > rankingStart, "Coverage ranking block is missing");
const rankingBlock = files.migration.slice(rankingStart, rankingEnd);
const actionableRank = rankingBlock.indexOf("when 'actionable' then 1");
const unlockRank = rankingBlock.indexOf("unresolved_rows desc");
assert.ok(
  actionableRank >= 0 && unlockRank >= 0 && actionableRank < unlockRank,
  "Actionable work does not rank before parser review",
);
assert.ok(
  files.migration.includes("'__all_sets__'::text as set_key"),
  "Missing-release work is not aggregated to the release level",
);
assert.ok(
  files.migration.includes("count(*)::integer as set_group_count"),
  "Release aggregation does not retain set-group coverage",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      actionableFirst: true,
      parserNoiseQuarantined: true,
      releaseAggregation: true,
      sourceDisclosure: false,
      automaticPromotion: false,
    },
    null,
    2,
  ),
);

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}
