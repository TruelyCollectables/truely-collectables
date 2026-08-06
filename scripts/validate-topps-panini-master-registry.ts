import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

type ArchiveFile = {
  manufacturer: "Topps" | "Panini";
  title: string;
  sport: string;
  year: string;
  url: string;
  finalUrl?: string;
  filename: string;
  archivePath: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
};

type ArchiveManifest = {
  schema: string;
  manufacturer: "Topps" | "Panini";
  generatedAt: string;
  totals: {
    requested: number;
    archived: number;
    failed: number;
  };
  files: ArchiveFile[];
  failures: Array<Record<string, unknown>>;
};

type ReceiptRow = {
  manufacturer: string;
  title: string;
  sport: string;
  year: string;
  filename: string;
  sourceUrl: string;
  sha256: string;
  sizeBytes: number;
  status: "adapter_required" | "validated" | "quarantined" | "imported" | "failed";
  adapterId: string | null;
  adapterVersion: string | null;
  counts: {
    sets: number;
    cards: number;
    parallels: number;
    identities: number;
  } | null;
  validationIssues: Array<{
    code: string;
    severity: string;
    message: string;
  }>;
  blocker: string | null;
  persistence: unknown | null;
};

type PreparedImport = {
  artifact: ChecklistSourceArtifact;
  row: ReceiptRow;
};

class ArchiveIntegrityError extends Error {}

const TOPPS_ROOT = resolve(
  process.cwd(),
  process.env.TOPPS_MASTER_ARCHIVE_ROOT || ".topps-seed-archive",
);
const PANINI_ROOT = resolve(
  process.cwd(),
  process.env.PANINI_MASTER_ARCHIVE_ROOT || ".panini-seed-archive",
);
const OUTPUT = resolve(
  process.cwd(),
  process.env.TOPPS_PANINI_REGISTRY_RECEIPT ||
    ".topps-panini-master/validation/registry-validation.json",
);
const APPLY = process.env.TOPPS_PANINI_REGISTRY_APPLY === "true";
const APPLY_CONFIRMATION = process.env.TOPPS_PANINI_REGISTRY_CONFIRM || "";
const REQUIRED_CONFIRMATION = "topps-baseball-football-v1";
const REGISTRY_READY_TOPPS_SPORTS = new Set(["Baseball", "Football"]);

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeFilename(value: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "checklist"
  );
}

function sourceUrl(file: ArchiveFile) {
  return file.finalUrl || file.url;
}

function limitedIssues(
  values: Array<{ code: string; severity: string; message: string }>,
) {
  return values.slice(0, 100).map((value) => ({
    code: value.code,
    severity: value.severity,
    message: value.message.slice(0, 500),
  }));
}

function readManifest(path: string, manufacturer: ArchiveManifest["manufacturer"]) {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ArchiveManifest;
  if (parsed.manufacturer !== manufacturer || !Array.isArray(parsed.files)) {
    throw new Error(`Invalid ${manufacturer} archive manifest at ${path}.`);
  }
  return parsed;
}

function resolveArchivePath(root: string, archivePath: string) {
  const candidate = resolve(root, archivePath);
  const rel = relative(root, candidate);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new ArchiveIntegrityError(
      `Archive path escapes its root: ${archivePath}`,
    );
  }
  return candidate;
}

function verifyArchiveFile(root: string, file: ArchiveFile) {
  const path = resolveArchivePath(root, file.archivePath);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new ArchiveIntegrityError(
      `Archive file is missing: ${file.archivePath} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (bytes.byteLength !== file.sizeBytes) {
    throw new ArchiveIntegrityError(
      `Archive size mismatch for ${file.archivePath}: ${bytes.byteLength}/${file.sizeBytes}`,
    );
  }
  const digest = sha256(bytes);
  if (digest !== file.sha256) {
    throw new ArchiveIntegrityError(
      `Archive SHA-256 mismatch for ${file.archivePath}: ${digest}/${file.sha256}`,
    );
  }
  return { path, bytes };
}

function extractToppsPdf(path: string) {
  const text = execFileSync(
    "pdftotext",
    ["-layout", "-nopgbrk", path, "-"],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    },
  ).trim();
  if (text.length < 50) {
    throw new Error(`PDF extraction produced only ${text.length} characters.`);
  }
  return text;
}

function baseRow(file: ArchiveFile): ReceiptRow {
  return {
    manufacturer: file.manufacturer,
    title: file.title,
    sport: file.sport,
    year: file.year,
    filename: file.filename,
    sourceUrl: sourceUrl(file),
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    status: "adapter_required",
    adapterId: null,
    adapterVersion: null,
    counts: null,
    validationIssues: [],
    blocker: null,
    persistence: null,
  };
}

async function validateToppsFile(
  manifest: ArchiveManifest,
  file: ArchiveFile,
  rows: ReceiptRow[],
  prepared: PreparedImport[],
) {
  const row = baseRow(file);
  rows.push(row);

  if (!REGISTRY_READY_TOPPS_SPORTS.has(file.sport)) {
    row.blocker = `topps_${safeFilename(file.sport).toLowerCase()}_raw_adapter_required`;
    return;
  }
  if (file.mimeType !== "application/pdf") {
    row.status = "quarantined";
    row.blocker = `topps_${file.sport.toLowerCase()}_${safeFilename(file.mimeType).toLowerCase()}_extractor_required`;
    return;
  }

  try {
    const archive = verifyArchiveFile(TOPPS_ROOT, file);
    const text = extractToppsPdf(archive.path);
    const artifact: ChecklistSourceArtifact = {
      sourceUrl: sourceUrl(file),
      originalFilename: `${safeFilename(file.title)}.txt`,
      mimeType: "text/plain",
      content: text,
      archiveContent: archive.bytes,
      archiveFilename: file.filename,
      archiveMimeType: file.mimeType,
      retrievedAt: manifest.generatedAt,
      authority: "official_manufacturer",
      redistributionAllowed: false,
    };
    const validation = await importChecklistArtifact({
      artifact,
      validateOnly: true,
    });
    const issues = limitedIssues(validation.plan.validation.issues);
    const errors = issues.filter((issue) => issue.severity === "error");
    row.adapterId = validation.adapter.id;
    row.adapterVersion = validation.adapter.version;
    row.counts = validation.plan.validation.counts;
    row.validationIssues = issues;

    if (!validation.ok || errors.length > 0) {
      row.status = "quarantined";
      row.blocker = "registry_validation_required";
      return;
    }

    row.status = "validated";
    prepared.push({ artifact, row });
  } catch (error) {
    row.status = error instanceof ArchiveIntegrityError ? "failed" : "quarantined";
    row.blocker =
      error instanceof ArchiveIntegrityError
        ? "archive_integrity_failure"
        : "registry_parser_or_extraction_failure";
    row.validationIssues = [
      {
        code: row.blocker,
        severity: "error",
        message: (error instanceof Error ? error.message : String(error)).slice(
          0,
          500,
        ),
      },
    ];
  }
}

function classifyPaniniFile(file: ArchiveFile, rows: ReceiptRow[]) {
  const row = baseRow(file);
  row.blocker =
    file.mimeType === "application/pdf"
      ? "panini_pdf_to_structured_adapter_required"
      : file.mimeType ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ? "panini_xlsx_to_structured_adapter_required"
        : file.mimeType === "application/vnd.ms-excel"
          ? "panini_xls_to_structured_adapter_required"
          : "panini_raw_to_structured_adapter_required";
  rows.push(row);
}

function totals(rows: ReceiptRow[]) {
  const result = {
    files: rows.length,
    adapterRequired: 0,
    validated: 0,
    quarantined: 0,
    imported: 0,
    failed: 0,
    sets: 0,
    cards: 0,
    parallels: 0,
    identities: 0,
  };
  for (const row of rows) {
    if (row.status === "adapter_required") result.adapterRequired += 1;
    if (row.status === "validated") result.validated += 1;
    if (row.status === "quarantined") result.quarantined += 1;
    if (row.status === "imported") result.imported += 1;
    if (row.status === "failed") result.failed += 1;
    if (row.counts) {
      result.sets += row.counts.sets;
      result.cards += row.counts.cards;
      result.parallels += row.counts.parallels;
      result.identities += row.counts.identities;
    }
  }
  return result;
}

async function main() {
  if (APPLY && APPLY_CONFIRMATION !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `Apply mode requires TOPPS_PANINI_REGISTRY_CONFIRM=${REQUIRED_CONFIRMATION}.`,
    );
  }

  const toppsManifest = readManifest(
    resolve(TOPPS_ROOT, "manifest.json"),
    "Topps",
  );
  const paniniManifest = readManifest(
    resolve(PANINI_ROOT, "manifest.json"),
    "Panini",
  );
  const rows: ReceiptRow[] = [];
  const prepared: PreparedImport[] = [];

  for (const file of toppsManifest.files) {
    await validateToppsFile(toppsManifest, file, rows, prepared);
  }
  for (const file of paniniManifest.files) {
    try {
      verifyArchiveFile(PANINI_ROOT, file);
      classifyPaniniFile(file, rows);
    } catch (error) {
      const row = baseRow(file);
      row.status = "failed";
      row.blocker = "archive_integrity_failure";
      row.validationIssues = [
        {
          code: "archive_integrity_failure",
          severity: "error",
          message: (error instanceof Error ? error.message : String(error)).slice(
            0,
            500,
          ),
        },
      ];
      rows.push(row);
    }
  }

  const preflight = totals(rows);
  if (APPLY) {
    const supportedBlockers = rows.filter(
      (row) =>
        row.manufacturer === "Topps" &&
        REGISTRY_READY_TOPPS_SPORTS.has(row.sport) &&
        row.status !== "validated",
    );
    if (preflight.failed > 0 || supportedBlockers.length > 0) {
      throw new Error(
        `Apply preflight blocked: ${preflight.failed} integrity failures and ${supportedBlockers.length} supported Topps files are not validated.`,
      );
    }

    for (const item of prepared) {
      try {
        const imported = await importChecklistArtifact({
          artifact: item.artifact,
        });
        if (!imported.ok || imported.validatedOnly) {
          throw new Error(
            "Validated checklist did not complete Registry persistence.",
          );
        }
        item.row.status = "imported";
        item.row.persistence = imported.persistence;
      } catch (error) {
        item.row.status = "failed";
        item.row.blocker = "registry_persistence_failure";
        item.row.validationIssues.push({
          code: "registry_persistence_failure",
          severity: "error",
          message: (error instanceof Error ? error.message : String(error)).slice(
            0,
            500,
          ),
        });
        break;
      }
    }
  }

  const receipt = {
    schema: "tcos.checklist.toppsPaniniMasterRegistryReceipt.v1",
    generatedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "validate_only",
    scope: {
      registryReadyNow: ["Topps Baseball", "Topps Football"],
      adapterBacklog: [
        "Topps Basketball",
        "Topps Hockey",
        "Topps Soccer",
        "Topps Wrestling",
        "Topps Racing",
        "Topps UFC",
        "Topps Boxing",
        "Topps Non-Sport",
        "Panini PDF",
        "Panini XLSX",
        "Panini XLS",
      ],
    },
    manifests: {
      topps: {
        generatedAt: toppsManifest.generatedAt,
        archived: toppsManifest.totals.archived,
        failed: toppsManifest.totals.failed,
      },
      panini: {
        generatedAt: paniniManifest.generatedAt,
        archived: paniniManifest.totals.archived,
        failed: paniniManifest.totals.failed,
      },
    },
    totals: totals(rows),
    rows,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));

  if (receipt.totals.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
