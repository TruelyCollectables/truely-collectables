import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve(process.cwd(), ".topps-seed-archive");
const seeds = [
  { title: "2026 Topps Series 1 Baseball", sport: "Baseball", year: "2026", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Topps_Series_1_Baseball_Checklist_2-23.pdf?v=1772557808" },
  { title: "2026 Topps Series 2 Baseball", sport: "Baseball", year: "2026", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Topps_Series_2_Baseball_Checklist_5-11.pdf?v=1778521905" },
  { title: "2026 Topps Chrome Baseball", sport: "Baseball", year: "2026", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Topps_Chrome_Baseball_Checklist_Final_7.22.pdf?v=1785169183" },
  { title: "2026 Topps Finest Baseball", sport: "Baseball", year: "2026", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/CheckList_26TFBB_VERSION3.pdf?v=1783523381" },
  { title: "2025 Topps Finest Football", sport: "Football", year: "2025", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025_Topps_Finest_Checklist_042326.pdf?v=1776986521" },
  { title: "2025 Topps Signature Class Football", sport: "Football", year: "2025", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/Checklist_25CSFB_VERSION2.pdf?v=1777921828" },
  { title: "2025 Topps Chrome Black Football", sport: "Football", year: "2025", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025_Topps_Chrome_Black_Football_Checklist.pdf?v=1780925886" },
  { title: "2024 Topps Chrome Football", sport: "Football", year: "2024", url: "https://www.topps.com/media/pdf/NFL2402-2024ToppsChromeFBChecklist.pdf" },
  { title: "2024 Topps Chrome Sapphire Football", sport: "Football", year: "2024", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/NFL2402-CheckList_24CFBL_Sapphire_1.pdf" },
  { title: "2025-26 Topps NHL Sticker Collection", sport: "Hockey", year: "2025-26", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025-26_NHL_Sticker_Collection_-_CheckList_25NHLS.pdf?v=1771437045" },
  { title: "2025-26 Topps Basketball", sport: "Basketball", year: "2025-26", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025-26_Topps_Basketball_Checklist.pdf?v=1759329649" },
  { title: "2025-26 Topps Cosmic Chrome Basketball", sport: "Basketball", year: "2025-26", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025-26_Topps_Cosmic_Chrome_Basketball_Checklist.pdf?v=1774549583" },
  { title: "2025-26 Topps Finest Basketball", sport: "Basketball", year: "2025-26", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025-2026_Topps_Finest_Basketball_Checklist.pdf?v=1771360733" },
  { title: "2025-26 Topps Hoops Basketball", sport: "Basketball", year: "2025-26", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025-26_Topps_Hoops_Basketball_Checklist.pdf?v=1776110447" },
  { title: "2025-26 Topps NBL Basketball", sport: "Basketball", year: "2025-26", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/26NBLC_Checklist_Final.pdf?v=1780091079" },
  { title: "2025-26 Topps Premier League", sport: "Soccer", year: "2025-26", url: "https://cdn.shopify.com/s/files/1/0739/2015/1805/files/Topps_Premier_League_2026_Hobby_Checklist.pdf?v=1756731624" },
  { title: "2025 Topps Finest WWE", sport: "Wrestling", year: "2025", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025_Topps_Finest_WWE_-_Checklist.pdf?v=1758820316" },
  { title: "2025 Topps Royalty WWE", sport: "Wrestling", year: "2025", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/CheckList_25RWWE_f1866dc1-a96b-4573-9ba9-780a73093535.pdf?v=1777641349" },
  { title: "2025 Topps Chrome Formula 1", sport: "Racing", year: "2025", url: "https://cdn.shopify.com/s/files/1/0739/2015/1805/files/2025_Topps_Chrome_F1_Checklist_d8cc4eea-5fa5-45b4-8fe7-b060a2d61136.pdf?v=1768582694" },
  { title: "2025 Topps Dynasty Formula 1", sport: "Racing", year: "2025", url: "https://cdn.shopify.com/s/files/1/0739/2015/1805/files/2025_Topps_Dynasty_F1_Checklist.pdf?v=1763393153" },
  { title: "2024 Topps Chrome Formula 1", sport: "Racing", year: "2024", url: "https://www.topps.com/media/amasty/amfile/attach/Gl7cNB3DyuXugPLzrfosXAxdxb3g2o5Z.pdf" },
  { title: "2025 Topps Royalty UFC", sport: "UFC", year: "2025", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/CheckList_25RUFC_2025_Topps_Royalty_UFC.pdf?v=1770129272" },
  { title: "2025 Topps Finest UFC", sport: "UFC", year: "2025", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/CheckList_25TFUF_FINAL.pdf?v=1760131479" },
] as const;

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function isTrustedToppsAsset(url: string) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol === "https:"
    && (host === "cdn.shopify.com" || host === "topps.com" || host === "www.topps.com" || host.endsWith(".topps.com"));
}

async function downloadWithRetry(seed: (typeof seeds)[number]) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (!isTrustedToppsAsset(seed.url)) throw new Error(`Untrusted Topps asset host: ${seed.url}`);
      const response = await fetch(seed.url, {
        headers: { "User-Agent": "TCOS-Topps-Seed-Archive/2.1", Accept: "application/pdf,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(90_000),
      });
      if (!isTrustedToppsAsset(response.url || seed.url)) throw new Error(`Untrusted redirect: ${response.url}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw new Error("empty file");
      if (bytes.length > 50 * 1024 * 1024) throw new Error(`file exceeds 50 MiB (${bytes.length} bytes)`);
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
      const rel = `${seed.sport}/${seed.year}/${filename}`;
      const target = resolve(OUT, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      files.push({ ...seed, finalUrl, filename, archivePath: rel, sha256, sizeBytes: bytes.length, mimeType: "application/pdf", attempts: attempt });
    } catch (error) {
      failures.push({ ...seed, error: error instanceof Error ? error.message : String(error), retryEligible: true });
    }
  }
  const manifest = {
    schema: "tcos.topps.seedArchiveManifest.v1",
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
