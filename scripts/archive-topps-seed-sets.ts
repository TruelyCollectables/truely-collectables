import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

type Seed = { title: string; sport: string; year: string; url: string; sourcePage?: string };

type DownloadResult = {
  bytes: Uint8Array;
  attempt: number;
  finalUrl: string;
  extension: string;
  mimeType: string;
  candidateIndex: number;
};

const OUT = resolve(process.cwd(), ".topps-seed-archive");
const seeds = JSON.parse(readFileSync(resolve(process.cwd(), "data/topps-checklist-seeds.json"), "utf8")) as Seed[];
const SHOPIFY_ROOT = "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/";

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function trusted(url: string) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol === "https:" && (host === "cdn.shopify.com" || host === "topps.com" || host === "www.topps.com" || host.endsWith(".topps.com"));
}

function cleanDiscoveredUrl(value: string) {
  return value
    .trim()
    .replace(/\]\([^)]*$/g, "")
    .replace(/[)*\],.;]+$/g, "")
    .replace(/%2520/gi, "%20");
}

function decodedFilename(url: string) {
  const parsed = new URL(url);
  const raw = parsed.pathname.split("/").filter(Boolean).pop() || "checklist.pdf";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function candidateUrls(seedUrl: string) {
  const values = new Set<string>();
  const add = (value: string) => {
    try {
      const parsed = new URL(cleanDiscoveredUrl(value));
      parsed.hash = "";
      values.add(parsed.toString());
    } catch {
      // Ignore malformed candidates.
    }
  };

  const cleaned = cleanDiscoveredUrl(seedUrl);
  add(cleaned);

  // Reader markdown occasionally converted encoded spaces into the literal token `_20`.
  add(cleaned.replace(/_20/g, "%20"));
  add(cleaned.replace(/_20/g, " "));

  try {
    const parsed = new URL(cleaned);
    const filename = decodedFilename(cleaned)
      .replace(/_20/g, " ")
      .replace(/\[\d+\](?=\.[^.]+$)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const encodedFilename = encodeURIComponent(filename).replace(/%2F/gi, "/");

    // Strip stale cache-busting versions while retaining a versioned candidate first.
    const withoutQuery = new URL(parsed.toString());
    withoutQuery.search = "";
    add(withoutQuery.toString());

    // Legacy Topps media assets are often mirrored in the current Shopify file bucket.
    add(`${SHOPIFY_ROOT}${encodedFilename}`);
    add(`${SHOPIFY_ROOT}${filename}`);

    // Try both common legacy media roots for assets that moved before Shopify migration.
    add(`https://www.topps.com/media/pdf/${encodedFilename}`);
    add(`https://www.topps.com/media/${encodedFilename}`);

    // Common stale filename artifacts from catalog markup.
    for (const repaired of [
      filename.replace(/^22022/i, "2022"),
      filename.replace(/=/g, "-"),
      filename.replace(/\(([^)]*)\)/g, "$1"),
      filename.replace(/&/g, "and"),
    ]) {
      if (repaired !== filename) add(`${SHOPIFY_ROOT}${encodeURIComponent(repaired)}`);
    }
  } catch {
    // The original URL remains available for the normal failure report.
  }

  return [...values].filter(trusted);
}

function extensionFrom(url: string, contentType: string) {
  const pathname = new URL(url).pathname;
  const supplied = extname(pathname).toLowerCase().replace(".", "");
  if (["pdf", "xls", "xlsx", "csv", "tsv", "json", "xml", "html", "htm", "zip"].includes(supplied)) {
    return supplied === "htm" ? "html" : supplied;
  }
  const mime = contentType.toLowerCase();
  if (mime.includes("spreadsheetml")) return "xlsx";
  if (mime.includes("ms-excel")) return "xls";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("csv")) return "csv";
  if (mime.includes("json")) return "json";
  if (mime.includes("xml")) return "xml";
  if (mime.includes("zip")) return "zip";
  return "bin";
}

function mimeFor(extension: string, responseType: string) {
  if (responseType && !responseType.includes("octet-stream")) return responseType.split(";")[0];
  return ({
    pdf: "application/pdf",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    json: "application/json",
    xml: "application/xml",
    html: "text/html",
    zip: "application/zip",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

function validate(bytes: Uint8Array, extension: string, contentType: string) {
  if (!bytes.length) throw new Error("empty file");
  if (bytes.length > 50 * 1024 * 1024) throw new Error(`file exceeds 50 MiB (${bytes.length} bytes)`);
  const head = Buffer.from(bytes.subarray(0, 16));
  const ascii = head.toString("ascii");
  const loweredType = contentType.toLowerCase();

  if (extension === "pdf" && !ascii.startsWith("%PDF-")) throw new Error("PDF signature missing");
  if (extension === "xls" && !(head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0)) {
    throw new Error("XLS signature missing");
  }
  if (["xlsx", "zip"].includes(extension) && !(head[0] === 0x50 && head[1] === 0x4b)) {
    throw new Error(`${extension.toUpperCase()} ZIP signature missing`);
  }
  if (loweredType.includes("text/html") && !["html"].includes(extension)) throw new Error("received HTML instead of checklist file");
}

async function download(seed: Seed): Promise<DownloadResult> {
  const candidates = candidateUrls(seed.url);
  const errors: string[] = [];
  let attempt = 0;

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    for (let candidateAttempt = 1; candidateAttempt <= 2; candidateAttempt += 1) {
      attempt += 1;
      try {
        const response = await fetch(candidate, {
          headers: { "User-Agent": "TCOS-Topps-Archive/5.0", Accept: "application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,*/*" },
          redirect: "follow",
          signal: AbortSignal.timeout(30_000),
        });
        if (!trusted(response.url || candidate)) throw new Error(`Untrusted redirect: ${response.url}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const contentType = response.headers.get("content-type") || "application/octet-stream";
        const extension = extensionFrom(response.url || candidate, contentType);
        validate(bytes, extension, contentType);
        return {
          bytes,
          attempt,
          finalUrl: response.url || candidate,
          extension,
          mimeType: mimeFor(extension, contentType),
          candidateIndex,
        };
      } catch (error) {
        errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
        if (candidateAttempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
      }
    }
  }

  throw new Error(errors.slice(-8).join(" | ") || "No valid official Topps candidate URL");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const files: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];
  for (const seed of seeds) {
    try {
      const result = await download(seed);
      const sha256 = createHash("sha256").update(result.bytes).digest("hex");
      const filename = `${slug(seed.title)}-${sha256.slice(0, 12)}.${result.extension}`;
      const relativePath = `Topps/${slug(seed.sport)}/${seed.year}/${filename}`;
      const target = resolve(OUT, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, result.bytes);
      files.push({
        manufacturer: "Topps",
        ...seed,
        finalUrl: result.finalUrl,
        archivePath: relativePath,
        filename,
        sha256,
        sizeBytes: result.bytes.length,
        mimeType: result.mimeType,
        attempts: result.attempt,
        repairedUrl: result.finalUrl !== seed.url,
        candidateIndex: result.candidateIndex,
      });
    } catch (error) {
      failures.push({ manufacturer: "Topps", ...seed, error: error instanceof Error ? error.message : String(error), retryEligible: true });
    }
  }
  const manifest = {
    schema: "tcos.manufacturerChecklistArchiveManifest.v2",
    manufacturer: "Topps",
    generatedAt: new Date().toISOString(),
    totals: { requested: seeds.length, archived: files.length, failed: failures.length },
    repaired: files.filter((file) => file.repairedUrl).length,
    byCategory: files.reduce<Record<string, number>>((totals, file) => { const category = String(file.sport); totals[category] = (totals[category] || 0) + 1; return totals; }, {}),
    files,
    failures,
  };
  writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ ...manifest.totals, repaired: manifest.repaired }));
  if (!files.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
