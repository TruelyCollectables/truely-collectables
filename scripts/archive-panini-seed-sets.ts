import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

type Seed = { title: string; sport: string; year: string; url: string };

const MANUFACTURER = "Panini";
const OUT = resolve(process.cwd(), ".panini-seed-archive");
const seeds = JSON.parse(readFileSync(resolve(process.cwd(), "data/panini-checklist-seeds.json"), "utf8")) as Seed[];

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function isTrustedPaniniAsset(url: string) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol === "https:" && (
    host === "paniniamerica.net" || host === "www.paniniamerica.net" ||
    host === "blog.paniniamerica.net" || host === "assets.paniniamerica.net" ||
    host.endsWith(".paniniamerica.net")
  );
}

function identifyFile(bytes: Uint8Array, url: string, contentType: string | null) {
  const first8 = Buffer.from(bytes.subarray(0, 8));
  const ascii5 = Buffer.from(bytes.subarray(0, 5)).toString("ascii");
  const urlExt = extname(new URL(url).pathname).toLowerCase();

  if (ascii5 === "%PDF-") return { extension: ".pdf", mimeType: "application/pdf" };
  if (first8.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return { extension: urlExt === ".xlsm" ? ".xlsm" : ".xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  }
  if (first8.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return { extension: ".xls", mimeType: "application/vnd.ms-excel" };
  }
  if (urlExt === ".csv" || contentType?.includes("text/csv")) return { extension: ".csv", mimeType: "text/csv" };
  throw new Error(`unsupported checklist file signature (${JSON.stringify(ascii5)})`);
}

async function downloadWithRetry(seed: Seed) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      if (!isTrustedPaniniAsset(seed.url)) throw new Error(`Untrusted Panini asset host: ${seed.url}`);
      const response = await fetch(seed.url, {
        headers: {
          "User-Agent": "TCOS-Panini-Archive/2.0",
          Accept: "application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,*/*",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(45_000),
      });
      if (!isTrustedPaniniAsset(response.url || seed.url)) throw new Error(`Untrusted redirect: ${response.url}`);
      if (response.status === 429) throw new Error("HTTP 429 rate limited");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw new Error("empty file");
      if (bytes.length > 75 * 1024 * 1024) throw new Error(`file exceeds 75 MiB (${bytes.length} bytes)`);
      const finalUrl = response.url || seed.url;
      const fileType = identifyFile(bytes, finalUrl, response.headers.get("content-type"));
      return { bytes, attempt, finalUrl, ...fileType };
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 4_000));
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
      const result = await downloadWithRetry(seed);
      const sha256 = createHash("sha256").update(result.bytes).digest("hex");
      const filename = `${slug(seed.title)}-${sha256.slice(0, 12)}${result.extension}`;
      const rel = `${MANUFACTURER}/${slug(seed.sport)}/${seed.year}/${filename}`;
      const target = resolve(OUT, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, result.bytes);
      files.push({
        manufacturer: MANUFACTURER,
        ...seed,
        finalUrl: result.finalUrl,
        filename,
        archivePath: rel,
        sha256,
        sizeBytes: result.bytes.length,
        mimeType: result.mimeType,
        attempts: result.attempt,
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

  const manifest = {
    schema: "tcos.manufacturerChecklistArchiveManifest.v1",
    layout: "manufacturer/category-or-sport/year/file",
    manufacturer: MANUFACTURER,
    generatedAt: new Date().toISOString(),
    totals: { requested: seeds.length, archived: files.length, failed: failures.length },
    bySport: files.reduce<Record<string, number>>((totals, file) => {
      const sport = String(file.sport);
      totals[sport] = (totals[sport] || 0) + 1;
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
