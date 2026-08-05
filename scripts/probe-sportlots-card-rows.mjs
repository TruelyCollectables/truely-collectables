import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const OUT = resolve(process.cwd(), ".sportlots-cardrow-probe");
mkdirSync(OUT, { recursive: true });

const targets = [
  ["baseball-topps-red-rainbow", "https://www.sportlots.com/Baseball/sets/2026-Topps-Red-Rainbow-Foil.tpl"],
  ["baseball-topps-golden-mirror", "https://www.sportlots.com/Baseball/sets/2026-Topps-Golden-Mirror-Variation.tpl"],
  ["baseball-topps-companion-box", "https://www.sportlots.com/Baseball/sets/2026-Topps-Companion-Card-(Super-Box-Exclusive).tpl"],
  ["baseball-topps-holiday-leafy-green", "https://www.sportlots.com/Baseball/sets/2026-Topps-Holiday-Leafy-Green.tpl"],
  ["baseball-topps-oversized", "https://www.sportlots.com/Baseball/sets/2026-Topps-Oversized.tpl"],
  ["baseball-topps-player-number", "https://www.sportlots.com/Baseball/sets/2026-Topps-Player-Number-Variation.tpl"],
  ["baseball-topps-team-color-border", "https://www.sportlots.com/Baseball/sets/2026-Topps-Team-Color-Border-Variation.tpl"],
  ["baseball-topps-true-photo", "https://www.sportlots.com/Baseball/sets/2026-Topps-True-Photo-Variation.tpl"],
  ["baseball-topps-1952-autos", "https://www.sportlots.com/Baseball/sets/2026-Topps-1952-Variation-Autos.tpl"],
  ["baseball-topps-real-one-autos", "https://www.sportlots.com/Baseball/sets/2026-Topps-Flagship-Real-One-Autos.tpl"],
  ["baseball-topps-real-one-relics", "https://www.sportlots.com/Baseball/sets/2026-Topps-Real-One-Relics.tpl"],
  ["baseball-topps-1991-autos", "https://www.sportlots.com/Baseball/sets/2026-Topps-1991-Topps-Autos.tpl"],
  ["baseball-topps-baseball-stars-autos", "https://www.sportlots.com/Baseball/sets/2026-Topps-Baseball-Stars-Autos.tpl"],
  ["baseball-topps-1991-relics", "https://www.sportlots.com/Baseball/sets/2026-Topps-1991-Topps-Relics.tpl"],
  ["baseball-topps-city-connect-swatch", "https://www.sportlots.com/Baseball/sets/2026-Topps-City-Connect-Swatch-Collection.tpl"],
  ["baseball-topps-1991", "https://www.sportlots.com/Baseball/sets/2026-Topps-1991-Topps.tpl"],
  ["baseball-bowman-chrome-prospects", "https://www.sportlots.com/Baseball/sets/2026-Bowman-Chrome-Prospects.tpl"],
  ["baseball-panini-prizm-stars-stripes", "https://www.sportlots.com/Baseball/sets/2026-Panini-Prizm-Stars-Stripes.tpl"],
  ["racing-parkside-indycar", "https://www.sportlots.com/Racing/sets/2026-Parkside-IndyCar-Collection.tpl"],
  ["racing-panini-select", "https://www.sportlots.com/Racing/sets/2026-Panini-Select.tpl"],
  ["racing-panini-select-light-blue", "https://www.sportlots.com/Racing/sets/2026-Panini-Select-Light-Blue-Prizm.tpl"],
  ["racing-panini-select-silver", "https://www.sportlots.com/Racing/sets/2026-Panini-Select-Silver-Prizm.tpl"],
  ["racing-panini-select-tricolor", "https://www.sportlots.com/Racing/sets/2026-Panini-Select-Tri-Color-Prizm.tpl"],
  ["racing-panini-select-claim-to-fame", "https://www.sportlots.com/Racing/sets/2026-Panini-Select-Claim-To-Fame.tpl"],
  ["racing-panini-select-en-fuego", "https://www.sportlots.com/Racing/sets/2026-Panini-Select-En-Fuego.tpl"],
];

const clean = (value = "") => value.replace(/\s+/g, " ").trim();
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const parsePlayer = (text) => {
  const match = clean(text).match(/^#([^\s]+)\s+(.+)$/);
  return match ? { cardNumber: match[1], description: match[2] } : null;
};

async function dismissBlockingUi(page) {
  await page.evaluate(() => {
    for (const selector of ["#myModal", ".modal", ".modal-backdrop"]) {
      for (const node of document.querySelectorAll(selector)) {
        node.style.setProperty("display", "none", "important");
        node.style.setProperty("pointer-events", "none", "important");
      }
    }
    document.body?.classList.remove("modal-open");
  }).catch(() => {});
}

async function advance(page, currentPage) {
  await dismissBlockingUi(page);
  const before = clean(await page.locator("#searchcurrpage").textContent().catch(() => String(currentPage)));
  const next = page.locator("#searchnextarr");
  if (!(await next.count())) return false;

  await next.evaluate((element) => {
    const onclick = element.getAttribute("onclick");
    if (onclick) Function(onclick).call(element);
    else element.click();
  });

  const changed = await page.waitForFunction(
    (previous) => document.querySelector("#searchcurrpage")?.textContent?.trim() !== previous,
    before,
    { timeout: 20_000 },
  ).then(() => true).catch(() => false);
  await page.waitForTimeout(1_250);
  return changed;
}

const browser = await chromium.launch({ headless: true });
const report = { generatedAt: new Date().toISOString(), targets: [], totals: {} };

try {
  for (const [slug, url] of targets) {
    const dir = resolve(OUT, slug);
    mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const page = await context.newPage();
    const allRows = [];
    let error = null;
    let pagesRead = 0;

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(2_500);

      const declaredPages = Math.max(1, Number(clean(await page.locator("#searchtotpage").textContent().catch(() => "1"))) || 1);
      const maxPages = Math.min(declaredPages, 50);

      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        await dismissBlockingUi(page);
        await page.waitForSelector(".resultcontainerone, #search3grid", { timeout: 15_000 }).catch(() => {});
        const pageRows = await page.locator(".resultcontainerone").evaluateAll((nodes) => nodes.map((node) => ({
          setName: (node.querySelector(".setname")?.textContent || "").replace(/\s+/g, " ").trim(),
          playerText: (node.querySelector(".playername")?.textContent || "").replace(/\s+/g, " ").trim(),
          priceText: (node.querySelector(".price")?.textContent || "").replace(/\s+/g, " ").trim(),
          details: node.getAttribute("onclick") || "",
        })));
        allRows.push(...pageRows.map((row) => ({ ...row, sourcePage: pageNumber })));
        pagesRead = pageNumber;

        if (pageNumber < maxPages) {
          const moved = await advance(page, pageNumber);
          if (!moved) {
            error = `pagination_did_not_advance_after_page_${pageNumber}`;
            break;
          }
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    const uniqueMap = new Map();
    for (const row of allRows) {
      const parsed = parsePlayer(row.playerText);
      if (!parsed) continue;
      const key = `${parsed.cardNumber}|${parsed.description}`;
      if (!uniqueMap.has(key)) uniqueMap.set(key, {
        cardNumber: parsed.cardNumber,
        description: parsed.description,
        setName: row.setName,
        firstSeenPage: row.sourcePage,
      });
    }
    const uniqueRows = [...uniqueMap.values()];
    const resultCount = Number(clean(await page.locator("#results").textContent().catch(() => "0"))) || 0;
    const declaredPages = Math.max(1, Number(clean(await page.locator("#searchtotpage").textContent().catch(() => "1"))) || 1);
    const valid = uniqueRows.length > 0;

    writeFileSync(resolve(dir, "rendered.html"), await page.content().catch(() => ""));
    await page.screenshot({ path: resolve(dir, "page.png"), fullPage: true }).catch(() => {});
    writeFileSync(resolve(dir, "all-listing-rows.json"), JSON.stringify(allRows, null, 2));
    writeFileSync(resolve(dir, "unique-card-rows.json"), JSON.stringify(uniqueRows, null, 2));
    writeFileSync(resolve(dir, "unique-card-rows.csv"), [
      "cardNumber,description,setName,firstSeenPage",
      ...uniqueRows.map((row) => [csv(row.cardNumber), csv(row.description), csv(row.setName), row.firstSeenPage].join(",")),
      "",
    ].join("\n"));
    writeFileSync(resolve(dir, "validation.json"), JSON.stringify({
      slug, url, error, valid, resultCount, declaredPages, pagesRead,
      listingRows: allRows.length, uniqueCardRows: uniqueRows.length,
    }, null, 2));

    report.targets.push({
      slug, url, error, valid, resultCount, declaredPages, pagesRead,
      listingRows: allRows.length, uniqueCardRows: uniqueRows.length,
    });
    console.log(JSON.stringify(report.targets.at(-1)));
    await context.close();
  }
} finally {
  await browser.close();
}

report.totals = {
  tested: report.targets.length,
  validChecklists: report.targets.filter((row) => row.valid).length,
  rejected: report.targets.filter((row) => !row.valid).length,
  listingRows: report.targets.reduce((sum, row) => sum + row.listingRows, 0),
  uniqueCardRows: report.targets.reduce((sum, row) => sum + row.uniqueCardRows, 0),
  declaredPages: report.targets.reduce((sum, row) => sum + row.declaredPages, 0),
  pagesRead: report.targets.reduce((sum, row) => sum + row.pagesRead, 0),
  errors: report.targets.filter((row) => row.error).length,
};
writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(resolve(OUT, "all-unique-card-rows.json"), JSON.stringify(report.targets.flatMap((target) => {
  try {
    return JSON.parse(require("node:fs").readFileSync(resolve(OUT, target.slug, "unique-card-rows.json"), "utf8")).map((row) => ({ ...row, sourceUrl: target.url, sourceSlug: target.slug }));
  } catch { return []; }
}), null, 2));
writeFileSync(resolve(OUT, "report.md"), [
  "# Sportlots 25-Set Card-Row Probe",
  "",
  `Tested: ${report.totals.tested}`,
  `Valid pages with card rows: ${report.totals.validChecklists}`,
  `Rejected: ${report.totals.rejected}`,
  `Listing rows: ${report.totals.listingRows}`,
  `Unique card rows: ${report.totals.uniqueCardRows}`,
  `Pages read: ${report.totals.pagesRead}/${report.totals.declaredPages}`,
  `Errors: ${report.totals.errors}`,
  "",
  ...report.targets.map((row) => `- ${row.slug}: ${row.valid ? "VALID" : "REJECTED"}; listings=${row.listingRows}; unique=${row.uniqueCardRows}; resultCount=${row.resultCount}; pages=${row.pagesRead}/${row.declaredPages}${row.error ? `; error=${row.error}` : ""}`),
  "",
].join("\n"));

if (report.totals.validChecklists === 0) process.exitCode = 2;
