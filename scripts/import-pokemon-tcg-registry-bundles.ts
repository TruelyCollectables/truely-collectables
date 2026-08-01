import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { importChecklistArtifact } from "../src/lib/checklist-registry/server";

const SOURCE_REPOSITORY =
  "https://github.com/PokemonTCG/pokemon-tcg-data";
const BUNDLE_SUFFIX = ".pokemon-tcg-data.bundle.json";

type BundleHeader = {
  schema?: string;
  set?: { id?: string; name?: string };
};

type ImportReceiptRow = {
  file: string;
  setId: string | null;
  setName: string | null;
  status: "validated" | "imported" | "already_imported" | "failed";
  adapterId: string | null;
  adapterVersion: string | null;
  counts: Record<string, number> | null;
  validationIssues: number;
  persistence: unknown;
  error: string | null;
};

function usage() {
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/import-pokemon-tcg-registry-bundles.ts <bundle-file-or-directory> [--apply] [--receipt <path>] [--continue-on-error]",
      "",
      "Default behavior validates only. --apply requires production Supabase service-role environment variables.",
    ].join("\n"),
  );
}

function argumentValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] || null;
}

async function collectBundleFiles(inputPath: string) {
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
  return parsed;
}

function sourceUrlForSet(setId: string | null) {
  if (!setId) return SOURCE_REPOSITORY;
  return `${SOURCE_REPOSITORY}/blob/master/cards/en/${encodeURIComponent(setId)}.json`;
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
      `.codex-run/pokemon-registry-${apply ? "import" : "validation"}-receipt.json`,
  );
  const files = await collectBundleFiles(inputArgument);
  if (!files.length) {
    throw new Error(`No *${BUNDLE_SUFFIX} files were found.`);
  }

  const rows: ImportReceiptRow[] = [];
  for (const file of files) {
    let setId: string | null = null;
    let setName: string | null = null;

    try {
      const content = await readFile(file);
      const header = readHeader(content);
      setId = String(header.set?.id || "").trim() || null;
      setName = String(header.set?.name || "").trim() || null;
      const sourceUrl = sourceUrlForSet(setId);

      if (!sourceUrl.startsWith(`${SOURCE_REPOSITORY}/`)) {
        throw new Error("Pokémon source URL escaped the approved reference repository.");
      }

      const result = await importChecklistArtifact({
        validateOnly: !apply,
        artifact: {
          sourceUrl,
          originalFilename: basename(file),
          mimeType: "application/json",
          content,
          retrievedAt: new Date().toISOString(),
          authority: "approved_reference_dataset",
          redistributionAllowed: false,
        },
      });

      if (!result.ok) {
        const issues = result.plan.validation.issues
          .map((issue) => `${issue.code}: ${issue.message}`)
          .join("; ");
        throw new Error(issues || "Checklist validation failed.");
      }

      const persistence = result.persistence as
        | { idempotent?: boolean; status?: string }
        | null;
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
      return sum;
    },
    { sets: 0, cards: 0, parallels: 0, identities: 0 },
  );
  const receipt = {
    schema: "tcos.checklist.pokemonBulkImportReceipt.v1",
    mode: apply ? "apply" : "validate_only",
    generatedAt: new Date().toISOString(),
    sourceRepository: SOURCE_REPOSITORY,
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
