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
  { title: "2025 Topps Royalty UFC", sport: "UFC", year: "2025", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/CheckList_25RUFC_2025_Topps_Royalty_UFC.pdf?v=1770129272" },
  { title: "2025 Topps Finest UFC", sport: "UFC", year: "2025", url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/CheckList_25TFUF_FINAL.pdf?v=1760131479" },
] as const;

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const files: Array<Record<string, unknown>> = [];
  for (const seed of seeds) {
    const parsed = new URL(seed.url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "cdn.shopify.com") {
      throw new Error(`Untrusted Topps asset host: ${seed.url}`);
    }
    const response = await fetch(seed.url, {
      headers: { "User-Agent": "TCOS-Topps-Seed-Archive/1.0", Accept: "application/pdf" },
      redirect: "follow",
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`${seed.title}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error(`${seed.title}: empty file`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const filename = `${slug(seed.title)}-${sha256.slice(0, 12)}.pdf`;
    const rel = `${seed.sport}/${seed.year}/${filename}`;
    const target = resolve(OUT, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    files.push({ ...seed, filename, archivePath: rel, sha256, sizeBytes: bytes.length, mimeType: "application/pdf" });
  }
  const manifest = {
    schema: "tcos.topps.seedArchiveManifest.v1",
    generatedAt: new Date().toISOString(),
    totals: { requested: seeds.length, archived: files.length },
    files,
  };
  writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest.totals));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
