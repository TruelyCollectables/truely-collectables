import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import { POKEMON_JAPANESE_VARIANT_RECONCILED_SCHEMA } from "../src/lib/checklist-registry/pokemon-japanese-variant-reconciled";

const BUNDLE_SUFFIX = ".pokemon-ja-variant-reconciled.bundle.json";

type BundleHeader = {
  schema?: string;
  set?: { id?: string; name?: string };
  official?: {
    product?: { url?: string };
    baseCardCount?: number;
    officialPrintingCount?: number;
    sourceBasePrintingCount?: number;
    sourceReversePokeballPrintingCount?: number;
    numberedAddedCardCount?: number;
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
  reversePokeballPrintings: number | null;
  numberedOfficialAdditions: number | null;
  expectedBaseCards: number | null;
  expectedOfficialPrintings: number | null;
  validationIssues: number;
  persistence: unknown;
  error: string | null;
};

function usage() {
  console.error(
    [
      "Usage:",
      "  node --import tsx scripts/import-pokemon-japanese-variant-reconciled-bundles.ts <bundle-file-or-directory> [--apply] [--receipt <path>] [--continue-on-error]",
      "",
      "Default behavior validates only. --apply requires Supabase service-role environment variables and supersedes the active set version.",
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
  if (parsed.schema !== POKEMON_JAPANESE_VARIANT_RECONCILED_SCHEMA) {
    throw new Error(
      `Unsupported variant reconciliation schema: ${String(parsed.schema)}.`,
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
      `.codex-run/pokemon-ja-variant-reconciled-${apply ? "import" : "validation"}-receipt.json`,
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
    let reversePokeballPrintings: number | null = null;
    let numberedOfficialAdditions: number | null = null;
    let expectedBaseCards: number | null = null;
    let expectedOfficialPrintings: number | null = null;
    try {
      const content = await readFile(file);
      const header = readHeader(content);
      setId = String(header.set?.id || "").trim() || null;
      setName = String(header.set?.name || "").trim() || null;
      sourceCards = integer(header.baseSource?.sourceCardCount);
      reversePokeballPrintings = integer(
        header.official?.sourceReversePokeballPrintingCount,
      );
      numberedOfficialAdditions = integer(
        header.official?.numberedAddedCardCount,
      );
      expectedBaseCards = integer(header.official?.baseCardCount);
      expectedOfficialPrintings = integer(
        header.official?.officialPrintingCount,
      );

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
        expectedBaseCards !== null &&
        result.plan.validation.counts.cards !== expectedBaseCards
      ) {
        throw new Error(
          `Validated ${result.plan.validation.counts.cards} base cards; bundle expects ${expectedBaseCards}.`,
        );
      }
      if (
        expectedOfficialPrintings !== null &&
        result.plan.validation.counts.identities !== expectedOfficialPrintings
      ) {
        throw new Error(
          `Validated ${result.plan.validation.counts.identities} physical-printing identities; bundle expects ${expectedOfficialPrintings}.`,
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
        reversePokeballPrintings,
        numberedOfficialAdditions,
        expectedBaseCards,
        expectedOfficialPrintings,
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
        reversePokeballPrintings,
        numberedOfficialAdditions,
        expectedBaseCards,
        expectedOfficialPrintings,
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
      sum.baseCards += row.counts?.cards || 0;
      sum.parallelDefinitions += row.counts?.parallels || 0;
      sum.officialPrintings += row.counts?.identities || 0;
      sum.sourceCards += row.sourceCards || 0;
      sum.reversePokeballPrintings += row.reversePokeballPrintings || 0;
      sum.numberedOfficialAdditions += row.numberedOfficialAdditions || 0;
      return sum;
    },
    {
      sets: 0,
      baseCards: 0,
      parallelDefinitions: 0,
      officialPrintings: 0,
      sourceCards: 0,
      reversePokeballPrintings: 0,
      numberedOfficialAdditions: 0,
    },
  );
  const receipt = {
    schema:
      "tcos.checklist.pokemonJapaneseVariantReconciledImportReceipt.v1",
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
