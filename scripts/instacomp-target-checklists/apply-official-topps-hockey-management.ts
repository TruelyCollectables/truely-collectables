import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseToppsHockeyTextChecklist } from "../../src/lib/checklist-registry/topps-hockey-text-adapter";
import { persistPlanManagement, preflightReleaseManagement } from "./management-staged-registry-writer.mjs";

const ROOT = resolve(process.env.TOPPS_HOCKEY_SOURCE_ROOT || "");
const OUTPUT = resolve(process.env.TOPPS_HOCKEY_RECEIPT || `${ROOT}/topps-hockey-production-receipt.json`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TARGETS = [
  {
    key: "2021-nhl-stickers",
    title: "2021 Topps NHL Stickers",
    sourceUrl: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/CheckList_21NHLS_VERSION2.pdf",
    minCards: 600,
  },
  {
    key: "2022-23-nhl-sticker-album",
    title: "2022-23 Topps NHL Sticker Album",
    sourceUrl: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2022NHLStickerAlbumChecklist.pdf",
    minCards: 620,
  },
  {
    key: "2022-23-chrome-nhl-stickers",
    title: "2022-23 Topps Chrome NHL Stickers",
    sourceUrl: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2022-23ToppsChromeNHLStickersChecklist.pdf",
    minCards: 360,
  },
  {
    key: "2024-25-nhl-sticker-collection",
    title: "2024-25 Topps NHL Sticker Collection",
    sourceUrl: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/NHL2501-CheckList_24NHLS_VERSION1.pdf",
    minCards: 700,
  },
  {
    key: "2025-26-nhl-sticker-collection",
    title: "2025-26 Topps NHL Sticker Collection",
    sourceUrl: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025-26_NHL_Sticker_Collection_-_CheckList_25NHLS.pdf?v=1771437045",
    minCards: 720,
  },
] as const;

if (!ROOT || !existsSync(ROOT)) throw new Error(`TOPPS_HOCKEY_SOURCE_ROOT is missing: ${ROOT}`);

const receipt: Record<string, any> = {
  schema: "tcos.officialToppsHockeyProduction.v1",
  targetCount: TARGETS.length,
  authority: "official_manufacturer",
  results: [],
};
function save() {
  receipt.updatedAt = new Date().toISOString();
  receipt.liveCount = receipt.results.filter((r: any) => r.status === "already_live" || r.status === "persisted").length;
  receipt.persistedCount = receipt.results.filter((r: any) => r.status === "persisted").length;
  receipt.alreadyLiveCount = receipt.results.filter((r: any) => r.status === "already_live").length;
  receipt.failedCount = receipt.results.filter((r: any) => r.status === "failed").length;
  receipt.unresolvedCount = TARGETS.length - receipt.liveCount;
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
}

for (const target of TARGETS) {
  const row: Record<string, any> = { key: target.key, title: target.title, sourceUrl: target.sourceUrl };
  receipt.results.push(row);
  try {
    const pdfPath = resolve(ROOT, `${target.key}.pdf`);
    const textPath = resolve(ROOT, `${target.key}.txt`);
    if (!existsSync(pdfPath) || !existsSync(textPath)) throw new Error(`Missing official source files for ${target.key}`);
    const pdf = readFileSync(pdfPath);
    const text = readFileSync(textPath, "utf8");
    if (pdf.length < 10_000 || text.trim().length < 1_000) throw new Error(`Official source extraction is too small for ${target.key}`);

    const plan = parseToppsHockeyTextChecklist({
      sourceUrl: target.sourceUrl,
      originalFilename: `${target.title}.txt`,
      mimeType: "text/plain",
      content: text,
      archiveContent: pdf,
      archiveFilename: basename(new URL(target.sourceUrl).pathname) || `${target.key}.pdf`,
      archiveMimeType: "application/pdf",
      retrievedAt: new Date().toISOString(),
      authority: "official_manufacturer",
      redistributionAllowed: false,
      targetContext: { sport: "Hockey", season: target.title.match(/^(\d{4}(?:-\d{2})?)/)?.[1] || null, manufacturer: "Topps", product: target.title },
    });

    row.releaseSlug = plan.release.releaseSlug;
    row.validation = plan.validation;
    if (plan.validation.status !== "passed") throw new Error(`Topps parser validation failed: ${JSON.stringify(plan.validation.issues).slice(0, 2000)}`);
    if (plan.validation.counts.cards < target.minCards) throw new Error(`Parsed only ${plan.validation.counts.cards} cards; minimum is ${target.minCards}`);
    if (plan.validation.counts.identities !== plan.validation.counts.cards) throw new Error(`Identity/card count mismatch ${plan.validation.counts.identities}/${plan.validation.counts.cards}`);
    if (plan.validation.counts.sets < 2) throw new Error(`Parsed only ${plan.validation.counts.sets} set sections`);

    const before = await preflightReleaseManagement(plan.release.releaseSlug);
    row.preflight = before;
    if (before.complete) {
      row.status = "already_live";
      save();
      continue;
    }

    let transaction: any = null;
    let last: unknown = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        transaction = await persistPlanManagement(plan, pdf);
        last = null;
        break;
      } catch (error) {
        last = error;
        row[`attempt${attempt}`] = error instanceof Error ? error.message : String(error);
        if (attempt < 4) await sleep(5000 * attempt);
      }
    }
    if (last) throw last;
    row.transaction = transaction;
    const after = await preflightReleaseManagement(plan.release.releaseSlug);
    row.postflight = after;
    if (!after.complete) throw new Error(`Production postflight incomplete for ${plan.release.releaseSlug}`);
    row.status = "persisted";
  } catch (error) {
    row.status = "failed";
    row.error = error instanceof Error ? error.message : String(error);
  }
  save();
}

save();
console.log(JSON.stringify({ targetCount: receipt.targetCount, liveCount: receipt.liveCount, alreadyLiveCount: receipt.alreadyLiveCount, persistedCount: receipt.persistedCount, failedCount: receipt.failedCount, unresolvedCount: receipt.unresolvedCount }, null, 2));
if (receipt.liveCount !== TARGETS.length || receipt.failedCount !== 0 || receipt.unresolvedCount !== 0) process.exitCode = 2;
