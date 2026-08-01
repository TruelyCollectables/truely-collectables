import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import { POKEMON_JAPANESE_MP_RECONCILED_SCHEMA } from "../src/lib/checklist-registry/pokemon-japanese-mp-reconciled";

const BUNDLE_SUFFIX = ".pokemon-ja-mp-reconciled.bundle.json";

type BundleHeader = {
  schema?: string;
  set?: { id?: string; name?: string; officialCardCount?: number };
  official?: {
    product?: { url?: string };
    officialCardCount?: number;
    addedCardCount?: number;
    numberedAddedCardCount?: number;
    unnumberedAddedCardCount?: number;
  };
};

type ReceiptRow = {
  file: string;
  setId: string | null;
  setName: string | null;
  status: "validated" | "imported" | "already_imported" | "failed";
  adapterId: string | null;
  adapterVersion: string | null;
  counts: Record<string, number> | null;
  expectedOfficialCards: number | null;
  addedOfficialCards: number | null;
  numberedAddedCards: number | null;
  unnumberedAddedCards: number | null;
  unnumberedVariations: number;
  validationIssues: number;
  persistence: unknown;
  error: string | null;
};

function usage() {
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/import-pokemon-japanese-mp-reconciled-bundle.ts <bundle-file-or-directory> [--apply] [--receipt <path>] [--continue-on-error]",
      "",
      "Default behavior validates only. --apply requires Supabase service-role environment variables and supersedes the active M-P version with the complete 114-card official-reconciled version.",
    ].join("\n"),
  );
}

function argumentValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] || null;
}

async function collectFiles(inputPath: string) {
  const resolved = resolve(inputPath);
  const inputStat = await stat(resolved);
  if (inputStat.isFile()) return [resolved];
  if (!inputStat.isDirectory()) {
    throw new Error(`${resolved} must be a bundle file or directory.`);
  }
  return (await readdir(resolved))
    .filter((fileName) => fileName.endsWith(BUNDLE_SUFFIX))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => join(resolved, fileName));
}

function readHeader(content: Buffer): BundleHeader {
  const parsed = JSON.parse(content.toString("utf8")) as BundleHeader;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Bundle must contain a JSON object.");
  }
  if (parsed.schema !== POKEMON_JAPANESE_MP_RECONCILED_SCHEMA) {
    throw new Error(`Unsupported M-P reconciliation schema: ${String(parsed.schema)}.`);
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
      `.codex-run/pokemon-ja-mp-reconciled-${apply ? "import" : "validation"}-receipt.json`,
  );
  const files = await collectFiles(inputArgument);
  if (!files.length) throw new Error(`No *${BUNDLE_SUFFIX} files were found.`);

  const rows: ReceiptRow[] = [];
  for (const file of files) {
    let setId: string | null = null;
    let setName: string | null = null;
    let expectedOfficialCards: number | null = null;
    let addedOfficialCards: number | null = null;
    let numberedAddedCards: number | null = null;
    let unnumberedAddedCards: number | null = null;
    try {
      const content = await readFile(file);
      const header = readHeader(content);
      setId = String(header.set?.id || "").trim() || null;
      setName = String(header.set?.name || "").trim() || null;
      expectedOfficialCards = Number.isInteger(header.official?.officialCardCount)
        ? Number(header.official?.officialCardCount)
        : null;
      addedOfficialCards = Number.isInteger(header.official?.addedCardCount)
        ? Number(header.official?.addedCardCount)
        : null;
      numberedAddedCards = Number.isInteger(
        header.official?.numberedAddedCardCount,
      )
        ? Number(header.official?.numberedAddedCardCount)
        : null;
      unnumberedAddedCards = Number.isInteger(
        header.official?.unnumberedAddedCardCount,
      )
        ? Number(header.official?.unnumberedAddedCardCount)
        : null;

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
        setId !== "M-P" ||
        expectedOfficialCards !== 114 ||
        addedOfficialCards !== 31 ||
        numberedAddedCards !== 16 ||
        unnumberedAddedCards !== 15 ||
        result.plan.validation.counts.cards !== 114 ||
        result.plan.validation.counts.identities !== 114
      ) {
        throw new Error(
          `Unexpected validated M-P population: ${JSON.stringify({
            setId,
            expectedOfficialCards,
            addedOfficialCards,
            numberedAddedCards,
            unnumberedAddedCards,
            counts: result.plan.validation.counts,
          })}`,
        );
      }
      const unnumberedVariations = result.plan.cards.filter(
        (card) =>
          card.cardNumber === "UNNUMBERED" &&
          /^Official Card \d+$/.test(card.variation || ""),
      ).length;
      if (unnumberedVariations !== 15) {
        throw new Error(
          `Validated ${unnumberedVariations} source-disambiguated unnumbered M-P cards; expected 15.`,
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
        expectedOfficialCards,
        addedOfficialCards,
        numberedAddedCards,
        unnumberedAddedCards,
        unnumberedVariations,
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
        expectedOfficialCards,
        addedOfficialCards,
        numberedAddedCards,
        unnumberedAddedCards,
        unnumberedVariations: 0,
        validationIssues: 0,
        persistence: null,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!continueOnError) break;
    }
  }

  const failed = rows.filter((row) => row.status === "failed");
  const receipt = {
    schema: "tcos.checklist.pokemonJapaneseMPReconciledImportReceipt.v1",
    mode: apply ? "apply" : "validate_only",
    generatedAt: new Date().toISOString(),
    input: resolve(inputArgument),
    attemptedFiles: rows.length,
    successfulFiles: rows.length - failed.length,
    failedFiles: failed.length,
    totals: rows.reduce(
      (sum, row) => {
        sum.sets += row.counts?.sets || 0;
        sum.cards += row.counts?.cards || 0;
        sum.parallels += row.counts?.parallels || 0;
        sum.identities += row.counts?.identities || 0;
        sum.addedOfficialCards += row.addedOfficialCards || 0;
        sum.numberedAddedCards += row.numberedAddedCards || 0;
        sum.unnumberedAddedCards += row.unnumberedAddedCards || 0;
        sum.unnumberedVariations += row.unnumberedVariations;
        return sum;
      },
      {
        sets: 0,
        cards: 0,
        parallels: 0,
        identities: 0,
        addedOfficialCards: 0,
        numberedAddedCards: 0,
        unnumberedAddedCards: 0,
        unnumberedVariations: 0,
      },
    ),
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
