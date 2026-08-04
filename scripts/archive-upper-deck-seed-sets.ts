import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

type Seed = { title: string; sport?: string; category?: string; year: string; sourcePage?: string; url: string };
const MANUFACTURER = "Upper Deck";
const OUT = resolve(process.cwd(), ".upper-deck-seed-archive");
const seeds = JSON.parse(readFileSync(resolve(process.cwd(), "data/upper-deck-checklist-seeds.json"), "utf8")) as Seed[];
const PARALLEL = 12;

function slug(v: string) { return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown"; }
function trusted(url: string) { const h = new URL(url).hostname.toLowerCase(); return new URL(url).protocol === "https:" && (h === "upperdeck.com" || h === "www.upperdeck.com" || h.endsWith(".upperdeck.com")); }
function kind(bytes: Uint8Array, url: string) {
  const b = Buffer.from(bytes); const ascii = b.subarray(0, 8).toString("ascii"); const hex = b.subarray(0, 8).toString("hex");
  if (ascii.startsWith("%PDF-")) return { ext: ".pdf", mime: "application/pdf" };
  if (hex.startsWith("d0cf11e0a1b11ae1")) return { ext: ".xls", mime: "application/vnd.ms-excel" };
  if (ascii.startsWith("PK")) return { ext: ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  const e = extname(new URL(url).pathname).toLowerCase();
  if ([".csv", ".tsv", ".json", ".xml"].includes(e) && !b.subarray(0, 200).toString("utf8").toLowerCase().includes("<html")) return { ext: e, mime: e === ".csv" ? "text/csv" : e === ".tsv" ? "text/tab-separated-values" : e === ".json" ? "application/json" : "application/xml" };
  throw new Error(`unsupported or invalid file signature ${JSON.stringify(ascii)}`);
}
async function one(seed: Seed) {
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      if (!trusted(seed.url)) throw new Error(`untrusted host ${seed.url}`);
      const r = await fetch(seed.url, { headers: { "User-Agent": "Mozilla/5.0 TCOS-UpperDeck-Archive/1.0", Accept: "application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,*/*" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`); if (!trusted(r.url || seed.url)) throw new Error(`untrusted redirect ${r.url}`);
      const bytes = new Uint8Array(await r.arrayBuffer()); if (!bytes.length) throw new Error("empty file"); if (bytes.length > 80 * 1024 * 1024) throw new Error(`file too large ${bytes.length}`);
      const type = kind(bytes, r.url || seed.url); return { bytes, attempt, finalUrl: r.url || seed.url, type };
    } catch (e) { last = e; if (attempt < 4) await new Promise(r => setTimeout(r, attempt * 1200)); }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
async function main() {
  mkdirSync(OUT, { recursive: true }); const files: any[] = []; const failures: any[] = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++; if (i >= seeds.length) return; const seed = seeds[i];
      try {
        const { bytes, attempt, finalUrl, type } = await one(seed); const sha256 = createHash("sha256").update(bytes).digest("hex");
        const category = seed.sport || seed.category || "Miscellaneous"; const filename = `${slug(seed.title)}-${sha256.slice(0, 12)}${type.ext}`;
        const rel = `${MANUFACTURER}/${slug(category)}/${seed.year || "Unknown"}/${filename}`; const target = resolve(OUT, rel); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
        files.push({ manufacturer: MANUFACTURER, ...seed, finalUrl, filename, archivePath: rel, sha256, sizeBytes: bytes.length, mimeType: type.mime, extension: type.ext, attempts: attempt });
      } catch (e) { failures.push({ manufacturer: MANUFACTURER, ...seed, error: e instanceof Error ? e.message : String(e), retryEligible: true }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, Math.max(1, seeds.length)) }, worker));
  const manifest = { schema: "tcos.manufacturerChecklistArchiveManifest.v1", layout: "manufacturer/category-or-sport/year/file", manufacturer: MANUFACTURER, generatedAt: new Date().toISOString(), totals: { requested: seeds.length, archived: files.length, failed: failures.length }, files, failures };
  writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n"); console.log(JSON.stringify(manifest.totals)); if (seeds.length && !files.length) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
