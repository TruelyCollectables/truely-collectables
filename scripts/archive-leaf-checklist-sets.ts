import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

type Seed = {
  title: string;
  category: string;
  year: string;
  sourcePage: string;
  url: string;
};

const OUT = resolve(process.cwd(), ".leaf-checklist-archive");
const seeds = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/leaf-checklist-seeds.json"), "utf8"),
) as Seed[];

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".zip": "application/zip",
};

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function trusted(url: string) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol === "https:" && (
    host === "leaftradingcards.com" ||
    host === "www.leaftradingcards.com" ||
    host === "cdn.prod.website-files.com" ||
    host === "docs.google.com" ||
    host === "drive.google.com"
  );
}

function validateBytes(bytes: Uint8Array, extension: string) {
  if (!bytes.length) throw new Error("empty file");
  if (bytes.length > 50 * 1024 * 1024) throw new Error(`file exceeds 50 MiB (${bytes.length} bytes)`);
  if (extension === ".pdf" && Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new Error("PDF signature missing");
  }
  if ([".xlsx", ".zip"].includes(extension)) {
    const signature = Buffer.from(bytes.subarray(0, 2)).toString("hex");
    if (signature !== "504b") throw new Error("ZIP/XLSX signature missing");
  }
}

async function download(seed: Seed) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (!trusted(seed.sourcePage) || !trusted(seed.url)) throw new Error("untrusted Leaf source or asset host");
      const response = await fetch(seed.url, {
        headers: { "User-Agent": "TCOS-Leaf-Checklist-Archive/1.0", Accept: "*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(90_000),
      });
      if (!trusted(response.url || seed.url)) throw new Error(`untrusted redirect: ${response.url}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const extension = extname(new URL(response.url || seed.url).pathname).toLowerCase() || extname(new URL(seed.url).pathname).toLowerCase();
      if (!MIME_BY_EXT[extension]) throw new Error(`unsupported checklist extension: ${extension || "none"}`);
      validateBytes(bytes, extension);
      return { bytes, attempt, finalUrl: response.url || seed.url, extension, mimeType: MIME_BY_EXT[extension] };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 2_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const files: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];

  for (const seed of seeds) {
    try {
      const result = await download(seed);
      const sha256 = createHash("sha256").update(result.bytes).digest("hex");
      const filename = `${slug(seed.title)}-${sha256.slice(0, 12)}${result.extension}`;
      const relativePath = `${slug(seed.category)}/${seed.year}/${filename}`;
      const target = resolve(OUT, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, result.bytes);
      files.push({
        manufacturer: "Leaf",
        ...seed,
        finalUrl: result.finalUrl,
        archivePath: relativePath,
        filename,
        sha256,
        sizeBytes: result.bytes.length,
        mimeType: result.mimeType,
        attempts: result.attempt,
      });
    } catch (error) {
      failures.push({
        manufacturer: "Leaf",
        ...seed,
        error: error instanceof Error ? error.message : String(error),
        retryEligible: true,
      });
    }
  }

  const manifest = {
    schema: "tcos.manufacturerChecklistArchiveManifest.v1",
    manufacturer: "Leaf",
    generatedAt: new Date().toISOString(),
    totals: { requested: seeds.length, archived: files.length, failed: failures.length },
    byCategory: files.reduce<Record<string, number>>((totals, file) => {
      const category = String(file.category);
      totals[category] = (totals[category] || 0) + 1;
      return totals;
    }, {}),
    files,
    failures,
  };

  writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest.totals));
  if (!files.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
