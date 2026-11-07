import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const RECEIPT_SCHEMA =
  "tcos.checklist.pokemonJapaneseOfficialVerification.v1";
const QUEUE_SCHEMA =
  "tcos.checklist.pokemonJapaneseOfficialDiscrepancyQueue.v1";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const directory = await mkdtemp(
    join(tmpdir(), "pokemon-ja-reused-product-quarantine-"),
  );
  const receiptPath = join(directory, "receipt.json");
  const queuePath = join(directory, "queue.json");

  try {
    const receipt = {
      schema: RECEIPT_SCHEMA,
      generatedAt: "2026-08-01T00:00:00.000Z",
      mode: "official_verification",
      officialSource: { authority: "pokemon-card.com" },
      attemptedSets: 3,
      statusCounts: { mismatch: 2, verified: 1 },
      totals: {
        registryCards: 246,
        officialCardsCollected: 448,
        officialProductCardsCollected: 448,
        excludedOfficialCards: 0,
        verifiedSets: 1,
        discrepancySets: 2,
        unmappedSets: 0,
        ambiguousSets: 0,
        mismatchedSets: 2,
        failedSets: 0,
        detailSamples: 0,
        printedNumberMismatches: 0,
      },
      rows: [
        {
          setId: "PMCG4",
          status: "mismatch",
          reasons: [
            "official_product_mapped_to_multiple_registry_sets",
            "official_card_count_mismatch",
            "official_set_code_mismatch",
          ],
          registryCardCount: 65,
          officialCollectedCount: 132,
          officialComparableCount: 132,
          officialExcludedCount: 0,
          detailEvidence: [],
        },
        {
          setId: "M-P",
          status: "mismatch",
          reasons: [
            "official_card_count_mismatch",
            "official_name_population_mismatch",
          ],
          registryCardCount: 83,
          officialCollectedCount: 114,
          officialComparableCount: 106,
          officialExcludedCount: 8,
          detailEvidence: [],
        },
        {
          setId: "SV2a",
          status: "verified",
          reasons: [],
          registryCardCount: 98,
          officialCollectedCount: 210,
          officialComparableCount: 210,
          officialExcludedCount: 0,
          detailEvidence: [],
        },
      ],
    };

    await writeFile(
      receiptPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("scripts/quarantine-pokemon-japanese-reused-products.ts"),
        "--receipt",
        receiptPath,
        "--queue",
        queuePath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert(
      result.status === 0,
      `Quarantine command failed: ${result.stderr || result.stdout}`,
    );

    const updated = JSON.parse(
      await readFile(receiptPath, "utf8"),
    );
    const queue = JSON.parse(await readFile(queuePath, "utf8"));
    const reused = updated.rows.find(
      (row: { setId?: string }) => row.setId === "PMCG4",
    );
    const realMismatch = updated.rows.find(
      (row: { setId?: string }) => row.setId === "M-P",
    );

    assert(
      reused?.status === "official_source_reused",
      `Reused product remained ${reused?.status}.`,
    );
    assert(
      realMismatch?.status === "mismatch",
      `Real source gap was hidden as ${realMismatch?.status}.`,
    );
    assert(
      updated.statusCounts.official_source_reused === 1 &&
        updated.statusCounts.mismatch === 1 &&
        updated.statusCounts.verified === 1,
      `Unexpected status counts: ${JSON.stringify(updated.statusCounts)}`,
    );
    assert(
      updated.totals.mismatchedSets === 1 &&
        updated.totals.ambiguousSets === 1 &&
        updated.totals.discrepancySets === 2 &&
        updated.totals.failedSets === 0,
      `Unexpected totals: ${JSON.stringify(updated.totals)}`,
    );
    assert(
      queue.schema === QUEUE_SCHEMA &&
        queue.rows.length === 2 &&
        queue.rows.some(
          (row: { setId?: string; status?: string }) =>
            row.setId === "PMCG4" &&
            row.status === "official_source_reused",
        ) &&
        queue.rows.some(
          (row: { setId?: string; status?: string }) =>
            row.setId === "M-P" && row.status === "mismatch",
        ),
      `Unexpected discrepancy queue: ${JSON.stringify(queue)}`,
    );

    console.log(
      JSON.stringify(
        {
          statusCounts: updated.statusCounts,
          totals: updated.totals,
          queueRows: queue.rows.map(
            (row: { setId?: string; status?: string }) => ({
              setId: row.setId,
              status: row.status,
            }),
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : error,
  );
  process.exitCode = 1;
});
