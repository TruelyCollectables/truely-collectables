import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

type Seed = { title: string; sport?: string; category?: string; year: string; sourcePage?: string; url: string };
type FileType = { ext: string; mime: string };
type Download = { bytes: Uint8Array; attempt: number; finalUrl: string; type: FileType; resolvedFrom?: string };

const MANUFACTURER = "Upper Deck";
const OUT = resolve(process.cwd(), ".upper-deck-seed-archive");
const seeds = JSON.parse(readFileSync(resolve(process.cwd(), "data/upper-deck-checklist-seeds.json"), "utf8")) as Seed[];
const PARALLEL = 10;
const FILE_RE = /\.(pdf|xlsx?|csv|tsv|zip)(?:$|[?#])/i;
const CHECKLIST_RE = /(checklist|check-list|check_list|public[_-]?cl|\bcl(?:[_-]|\b))/i;

function slug(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function trusted(url: string) {
  const parsed = new URL(url);
  const h = parsed.hostname.toLowerCase();
  return parsed.protocol === "https:" && (h === "upperdeck.com" || h === "www.upperdeck.com" || h.endsWith(".upperdeck.com"));
}

function fileType(bytes: Uint8Array, url: string): FileType {
  const b = Buffer.from(bytes);
  const ascii = b.subarray(0, 8).toString("ascii");
  const hex = b.subarray(0, 8).toString("hex");
  const preview = b.subarray(0, 500).toString("utf8").trimStart().toLowerCase();
  if (ascii.startsWith("%PDF-")) return { ext: ".pdf", mime: "application/pdf" };
  if (hex.startsWith("d0cf11e0a1b11ae1")) return { ext: ".xls", mime: "application/vnd.ms-excel" };
  if (ascii.startsWith("PK")) return { ext: ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  const e = extname(new URL(url).pathname).toLowerCase();
  if ([".csv", ".tsv"].includes(e) && !preview.includes("<html") && !preview.startsWith("<!doctype")) {
    return { ext: e, mime: e === ".csv" ? "text/csv" : "text/tab-separated-values" };
  }
  throw new Error(`unsupported or invalid file signature ${JSON.stringify(ascii)}`);
}

function decodeHtml(value: string) {
  return value
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractAssetCandidates(html: string, base: string) {
  const candidates = new Set<string>();
  const normalized = decodeHtml(html);
  const patterns = [
    /(?:href|src)\s*=\s*["']([^"']+)["']/gi,
    /https:\/\/[^\s"'<>\\]+/gi,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const raw = decodeHtml(match[1] || match[0]).replace(/[),.;]+$/, "");
      try {
        const url = new URL(raw, base);
        url.hash = "";
        const value = url.toString();
        if (!trusted(value)) continue;
        if (!FILE_RE.test(url.pathname)) continue;
        if (!CHECKLIST_RE.test(value) && !/wp-content\/uploads/i.test(url.pathname)) continue;
        candidates.add(value);
      } catch {
        // Ignore malformed page links.
      }
    }
  }
  return [...candidates].sort((a, b) => {
    const ac = CHECKLIST_RE.test(a) ? 1 : 0;
    const bc = CHECKLIST_RE.test(b) ? 1 : 0;
    return bc - ac || a.localeCompare(b);
  });
}

async function fetchBytes(url: string) {
  if (!trusted(url)) throw new Error(`untrusted host ${url}`);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TCOS-UpperDeck-Archive/2.0)",
      Accept: "application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/html,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const finalUrl = response.url || url;
  if (!trusted(finalUrl)) throw new Error(`untrusted redirect ${finalUrl}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error("empty file");
  if (bytes.length > 80 * 1024 * 1024) throw new Error(`file too large ${bytes.length}`);
  return { bytes, finalUrl, contentType: response.headers.get("content-type") || "" };
}

async function resolveAndDownload(seed: Seed, attempt: number): Promise<Download> {
  const first = await fetchBytes(seed.url);
  try {
    return { ...first, attempt, type: fileType(first.bytes, first.finalUrl) };
  } catch (directError) {
    const preview = Buffer.from(first.bytes.subarray(0, 800)).toString("utf8").trimStart().toLowerCase();
    const isHtml = first.contentType.includes("html") || preview.startsWith("<!doctype") || preview.startsWith("<html");
    if (!isHtml) throw directError;
    const html = Buffer.from(first.bytes).toString("utf8");
    const candidates = extractAssetCandidates(html, first.finalUrl);
    if (!candidates.length) throw new Error("checklist page contains no trusted downloadable checklist asset");
    let last: unknown;
    for (const candidate of candidates.slice(0, 12)) {
      try {
        const downloaded = await fetchBytes(candidate);
        return {
          ...downloaded,
          attempt,
          type: fileType(downloaded.bytes, downloaded.finalUrl),
          resolvedFrom: seed.url,
        };
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof Error ? last : new Error("all extracted checklist assets failed");
  }
}

async function one(seed: Seed) {
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await resolveAndDownload(seed, attempt);
    } catch (error) {
      last = error;
      if (attempt < 4) await new Promise((done) => setTimeout(done, attempt * 1500));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const files: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= seeds.length) return;
      const seed = seeds[index];
      try {
        const { bytes, attempt, finalUrl, type, resolvedFrom } = await one(seed);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const category = seed.sport || seed.category || "Miscellaneous";
        const filename = `${slug(seed.title)}-${sha256.slice(0, 12)}${type.ext}`;
        const rel = `${MANUFACTURER}/${slug(category)}/${seed.year || "Unknown"}/${filename}`;
        const target = resolve(OUT, rel);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes);
        files.push({
          manufacturer: MANUFACTURER,
          ...seed,
          finalUrl,
          resolvedFrom,
          filename,
          archivePath: rel,
          sha256,
          sizeBytes: bytes.length,
          mimeType: type.mime,
          extension: type.ext,
          attempts: attempt,
        });
      } catch (error) {
        failures.push({
          manufacturer: MANUFACTURER,
          ...seed,
          error: error instanceof Error ? error.message : String(error),
          retryEligible: true,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL, Math.max(1, seeds.length)) }, worker));
  const manifest = {
    schema: "tcos.manufacturerChecklistArchiveManifest.v1",
    layout: "manufacturer/category-or-sport/year/file",
    manufacturer: MANUFACTURER,
    generatedAt: new Date().toISOString(),
    totals: { requested: seeds.length, archived: files.length, failed: failures.length },
    files,
    failures,
  };
  writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest.totals));
  if (seeds.length && !files.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
