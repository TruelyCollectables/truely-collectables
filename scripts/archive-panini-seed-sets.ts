import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Seed = { title: string; sport: string; year: string; url: string };

const MANUFACTURER = "Panini";
const OUT = resolve(process.cwd(), ".panini-seed-archive");
const seeds = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/panini-checklist-seeds.json"), "utf8"),
) as Seed[];

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function isTrustedPaniniAsset(url: string) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol === "https:"
    && (host === "paniniamerica.net"
      || host === "www.paniniamerica.net"
      || host === "blog.paniniamerica.net"
      || host === "assets.paniniamerica.net"
      || host.endsWith(".paniniamerica.net"));
}

function assertPdf(bytes: Uint8Array) {
  const signature = Buffer.from(bytes.subarray(0, 5)).toString("ascii");
  if (signature !== "%PDF-") throw new Error(`download is not a PDF (signature ${JSON.stringify(signature)})`);
}

async function downloadWithRetry(seed: Seed) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (!isTrustedPaniniAsset(seed.url)) throw new Error(`Untrusted Panini asset host: ${seed.url}`);
      const response = await fetch(seed.url, {
        headers: { "User-Agent": "TCOS-Panini-Archive/1.0", Accept: "application/pdf,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(90_000),
      });
      if (!isTrustedPaniniAsset(response.url || seed.url)) throw new Error(`Untrusted redirect: ${response.url}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw new Error("empty file");
      if (bytes.length > 50 * 1024 * 1024) throw new Error(`file exceeds 50 MiB (${bytes.length} bytes)`);
      assertPdf(bytes);
      return { bytes, attempt, finalUrl: response.url || seed.url };
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
      const { bytes, attempt, finalUrl } = await downloadWithRetry(seed);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const filename = `${slug(seed.title)}-${sha256.slice(0, 12)}.pdf`;
      const rel = `${MANUFACTURER}/${slug(seed.sport)}/${seed.year}/${filename}`;
      const target = resolve(OUT, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      files.push({
        manufacturer: MANUFACTURER,
        ...seed,
        finalUrl,
        filename,
        archivePath: rel,
        sha256,
        sizeBytes: bytes.length,
        mimeType: "application/pdf",
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
