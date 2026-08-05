import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

type ArchiveFile = {
  manufacturer: "Topps";
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

type Manifest = {
  manufacturer: "Topps";
  generatedAt: string;
  totals: { requested: number; archived: number; failed: number };
  files: ArchiveFile[];
  failures: Array<Record<string, unknown>>;
};

type Row = {
  title: string;
  sport: string;
  year: string;
  filename: string;
  sourceUrl: string;
  status: "adapter_required" | "validated" | "quarantined" | "failed";
  adapterId: string | null;
  counts: { sets: number; cards: number; parallels: number; identities: number } | null;
  blocker: string | null;
  issues: Array<{ code: string; severity: string; message: string }>;
};

const ROOT = resolve(process.cwd(), process.env.TOPPS_ARCHIVE_ROOT || ".topps-seed-archive");
const OUTPUT = resolve(process.cwd(), process.env.TOPPS_VALIDATION_RECEIPT || ".topps-818-validation/receipt.json");
const READY_SPORTS = new Set(["Baseball", "Football"]);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safePath(root: string, archivePath: string): string {
  const path = resolve(root, archivePath);
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`Unsafe archive path: ${archivePath}`);
  return path;
}

function extractPdf(path: string): string {
  return execFileSync("pdftotext", ["-layout", "-nopgbrk", path, "-"], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 96 * 1024 * 1024,
  }).trim();
}

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "manifest.json"), "utf8")) as Manifest;
  if (manifest.manufacturer !== "Topps" || !Array.isArray(manifest.files)) throw new Error("Invalid Topps manifest");

  const rows: Row[] = [];
  for (const file of manifest.files) {
    const row: Row = {
      title: file.title,
      sport: file.sport,
      year: file.year,
      filename: file.filename,
      sourceUrl: file.finalUrl || file.url,
      status: "adapter_required",
      adapterId: null,
      counts: null,
      blocker: null,
      issues: [],
    };
    rows.push(row);

    if (!READY_SPORTS.has(file.sport)) {
      row.blocker = `topps_${file.sport.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_adapter_required`;
      continue;
    }
    if (file.mimeType !== "application/pdf") {
      row.status = "quarantined";
      row.blocker = "non_pdf_extractor_required";
      continue;
    }

    try {
      const path = safePath(ROOT, file.archivePath);
      const bytes = readFileSync(path);
      if (bytes.length !== file.sizeBytes) throw new Error(`Size mismatch: ${bytes.length}/${file.sizeBytes}`);
      if (sha256(bytes) !== file.sha256) throw new Error("SHA-256 mismatch");
      const text = extractPdf(path);
      if (text.length < 50) throw new Error(`PDF extraction produced ${text.length} characters`);
      const artifact: ChecklistSourceArtifact = {
        sourceUrl: row.sourceUrl,
        originalFilename: `${file.filename}.txt`,
        mimeType: "text/plain",
        content: text,
        archiveContent: bytes,
        archiveFilename: file.filename,
        archiveMimeType: file.mimeType,
        retrievedAt: manifest.generatedAt,
        authority: "official_manufacturer",
        redistributionAllowed: false,
      };
      const result = await importChecklistArtifact({ artifact, validateOnly: true });
      row.adapterId = result.adapter.id;
      row.counts = result.plan.validation.counts;
      row.issues = result.plan.validation.issues.slice(0, 50).map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message.slice(0, 500),
      }));
      if (!result.ok || row.issues.some((issue) => issue.severity === "error")) {
        row.status = "quarantined";
        row.blocker = "registry_validation_failed";
      } else {
        row.status = "validated";
      }
    } catch (error) {
      row.status = "failed";
      row.blocker = "integrity_extraction_or_parser_failure";
      row.issues = [{
        code: row.blocker,
        severity: "error",
        message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      }];
    }
  }

  const totals = {
    files: rows.length,
    validated: rows.filter((row) => row.status === "validated").length,
    quarantined: rows.filter((row) => row.status === "quarantined").length,
    adapterRequired: rows.filter((row) => row.status === "adapter_required").length,
    failed: rows.filter((row) => row.status === "failed").length,
    sets: rows.reduce((sum, row) => sum + (row.counts?.sets || 0), 0),
    cards: rows.reduce((sum, row) => sum + (row.counts?.cards || 0), 0),
    parallels: rows.reduce((sum, row) => sum + (row.counts?.parallels || 0), 0),
    identities: rows.reduce((sum, row) => sum + (row.counts?.identities || 0), 0),
  };
  const receipt = {
    schema: "tcos.topps818RegistryValidation.v1",
    generatedAt: new Date().toISOString(),
    mode: "validate_only",
    archive: manifest.totals,
    totals,
    rows,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(totals));
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
