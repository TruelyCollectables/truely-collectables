import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import { POKEMON_JAPANESE_HISTORICAL_RECONCILED_SCHEMA } from "../src/lib/checklist-registry/pokemon-japanese-historical-reconciled";

const BUNDLE_SUFFIX = ".pokemon-ja-historical-reconciled.bundle.json";

type BundleHeader = {
  schema?: string;
  set?: { id?: string; name?: string };
  official?: {
    product?: { url?: string };
    officialCardCount?: number;
    sourceNumberCrosswalkCount?: number;
    sourceEnergyAliasCount?: number;
    numberedAddedCardCount?: number;
    unnumberedAddedCardCount?: number;
  };
  baseSource?: { sourceCardCount?: number };
};

type ImportReceiptRow = {
  file: string;
  setId: string | null;
  setName: string | null;
  status: "validated" | "imported" | "already_imported" | "failed";
  adapterId: string | null;
  adapterVersion: string | null;
  counts: Record<string, number> | null;
  sourceCards: number | null;
  sourceNumberCrosswalks: number | null;
  sourceEnergyAliases: number | null;
  numberedOfficialAdditions: number | null;
  unnumberedOfficialAdditions: number | null;
  expectedOfficialCards: number | null;
  validationIssues: number;
  persistence: unknown;
  error: string | null;
};

function usage() {
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/import-pokemon-japanese-historical-safe-bundles.ts <bundle-file-or-directory> [--apply] [--receipt <path>] [--continue-on-error]",
      "",
      "Default behavior validates only. --apply requires Supabase service-role environment variables and supersedes the active set version with the complete reconciled version.",
    ].join("\n"),
  );
}

function argumentValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] || null;
}

async function collectBundleFiles(inputPath: string): Promise<string[]> {
  const resolved = resolve(inputPath);
  const inputStat = await stat(resolved);
  if (inputStat.isFile()) return [resolved];
  if (!inputStat.isDirectory()) {
    throw new Error(`${resolved} must be a bundle file or directory.`);
  }
  const files: string[] = [];
  for (const entry of await readdir(resolved, { withFileTypes: true })) {
    const child = join(resolved, entry.name);
    if (entry.isDirectory()) files.push(...(await collectBundleFiles(child)));
    else if (entry.isFile() && entry.name.endsWith(BUNDLE_SUFFIX)) {
      files.push(child);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function readHeader(content: Buffer): BundleHeader {
  const parsed = JSON.parse(content.toString("utf8")) as BundleHeader;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Bundle must contain a JSON object.");
  }
  if (parsed.schema !== POKEMON_JAPANESE_HISTORICAL_RECONCILED_SCHEMA) {
    throw new Error(
      `Unsupported historical reconciliation schema: ${String(parsed.schema)}.`,
    );
  }
  return parsed;
}

function officialSourceUrl(header: BundleHeader) {
  const url = String(header.official?.product?.url || "").trim();
  if (!/^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(url)) {
    throw new Error(`Invalid official Pokémon source URL: ${url}`);
  }
  return url;
}

function integer(value: unknown) {
  return Number.isInteger(value) ? Number(value) : null;
}

async function main() {
  const inputArgument = process.argv[2];
  if (!inputArgument || inputArgument.startsWith("--")) {
    usage();
    process.exitCode = 1;
    return;
  }

  const apply = process.argv.includes("--apply");
  const continueOnError = process.argv.includes("--continue-on-error");
  const receiptPath = resolve(
    argumentValue("--receipt") ||
      `.codex-run/pokemon-ja-historical-safe-${apply ? "import" : "validation"}-receipt.json`,
  );
  const files = await collectBundleFiles(inputArgument);
  if (!files.length) {
    throw new Error(`No *${BUNDLE_SUFFIX} files were found.`);
  }

  const rows: ImportReceiptRow[] = [];
  for (const file of files) {
    let setId: string | null = null;
    let setName: string | null = null;
    let sourceCards: number | null = null;
    let sourceNumberCrosswalks: number | null = null;
    let sourceEnergyAliases: number | null = null;
    let numberedOfficialAdditions: number | null = null;
    let unnumberedOfficialAdditions: number | null = null;
    let expectedOfficialCards: number | null = null;
    try {
      const content = await readFile(file);
      const header = readHeader(content);
      setId = String(header.set?.id || "").trim() || null;
      setName = String(header.set?.name || "").trim() || null;
      sourceCards = integer(header.baseSource?.sourceCardCount);
      sourceNumberCrosswalks = integer(
        header.official?.sourceNumberCrosswalkCount,
      );
      sourceEnergyAliases = integer(header.official?.sourceEnergyAliasCount);
      numberedOfficialAdditions = integer(
        header.official?.numberedAddedCardCount,
      );
      unnumberedOfficialAdditions = integer(
        header.official?.unnumberedAddedCardCount,
      );
      expectedOfficialCards = integer(header.official?.officialCardCount);

      const result = await importChecklistArtifact({
        validateOnly: !apply,
        artifact: {
          sourceUrl: officialSourceUrl(header),
          originalFilename: basename(file),
          mimeType: "application/json",
          content,
          retrievedAt: new Date().toISOString(),
          authority: "official_manufacturer",
          redistributionAllowed: false,
        },
      });
      if (!result.ok) {
        const issues = result.plan.validation.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => `${issue.code}: ${issue.message}`)
          .join("; ");
        throw new Error(issues || "Checklist validation failed.");
      }
      if (
        expectedOfficialCards !== null &&
        result.plan.validation.counts.cards !== expectedOfficialCards
      ) {
        throw new Error(
          `Validated ${result.plan.validation.counts.cards} cards; bundle expects ${expectedOfficialCards}.`,
        );
      }
      const persistence = result.persistence as { idempotent?: boolean } | null;
      rows.push({
        file,
        setId,
        setName,
        status: !apply
          ? "validated"
          : persistence?.idempotent
            ? "already_imported"
            : "imported",
        adapterId: result.adapter.id,
        adapterVersion: result.adapter.version,
        counts: result.plan.validation.counts,
        sourceCards,
        sourceNumberCrosswalks,
        sourceEnergyAliases,
        numberedOfficialAdditions,
        unnumberedOfficialAdditions,
        expectedOfficialCards,
        validationIssues: result.plan.validation.issues.length,
        persistence: result.persistence,
        error: null,
      });
    } catch (error) {
      rows.push({
        file,
        setId,
        setName,
        status: "failed",
        adapterId: null,
        adapterVersion: null,
        counts: null,
        sourceCards,
        sourceNumberCrosswalks,
        sourceEnergyAliases,
        numberedOfficialAdditions,
        unnumberedOfficialAdditions,
        expectedOfficialCards,
        validationIssues: 0,
        persistence: null,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!continueOnError) break;
    }
  }

  const failed = rows.filter((row) => row.status === "failed");
  const totals = rows.reduce(
    (sum, row) => {
      sum.sets += row.counts?.sets || 0;
      sum.cards += row.counts?.cards || 0;
      sum.parallels += row.counts?.parallels || 0;
      sum.identities += row.counts?.identities || 0;
      sum.sourceCards += row.sourceCards || 0;
      sum.sourceNumberCrosswalks += row.sourceNumberCrosswalks || 0;
      sum.sourceEnergyAliases += row.sourceEnergyAliases || 0;
      sum.numberedOfficialAdditions += row.numberedOfficialAdditions || 0;
      sum.unnumberedOfficialAdditions +=
        row.unnumberedOfficialAdditions || 0;
      return sum;
    },
    {
      sets: 0,
      cards: 0,
      parallels: 0,
      identities: 0,
      sourceCards: 0,
      sourceNumberCrosswalks: 0,
      sourceEnergyAliases: 0,
      numberedOfficialAdditions: 0,
      unnumberedOfficialAdditions: 0,
    },
  );
  const receipt = {
    schema:
      "tcos.checklist.pokemonJapaneseHistoricalSafeBundleImportReceipt.v1",
    mode: apply ? "apply" : "validate_only",
    generatedAt: new Date().toISOString(),
    input: resolve(inputArgument),
    attemptedFiles: rows.length,
    successfulFiles: rows.length - failed.length,
    failedFiles: failed.length,
    totals,
    rows,
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
