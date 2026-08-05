import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const OUT = resolve(process.cwd(), ".sportlots-cardrow-probe");
mkdirSync(OUT, { recursive: true });

const targets = [
  ["baseball-topps-red-rainbow", "https://www.sportlots.com/Baseball/sets/2026-Topps-Red-Rainbow-Foil.tpl"],
  ["baseball-topps-golden-mirror", "https://www.sportlots.com/Baseball/sets/2026-Topps-Golden-Mirror-Variation.tpl"],
  ["baseball-bowman-chrome-prospects", "https://www.sportlots.com/Baseball/sets/2026-Bowman-Chrome-Prospects.tpl"],
  ["baseball-panini-prizm-stars-stripes", "https://www.sportlots.com/Baseball/sets/2026-Panini-Prizm-Stars-Stripes.tpl"],
  ["racing-parkside-indycar", "https://www.sportlots.com/Racing/sets/2026-Parkside-IndyCar-Collection.tpl"],
];

const clean = (value = "") => value.replace(/\s+/g, " ").trim();
const looksLikeCardNumber = (value) => /^(?:#?\d+[A-Za-z]?|[A-Za-z]{1,5}-?\d+[A-Za-z]?|NNO)$/i.test(clean(value));

const browser = await chromium.launch({ headless: true });
const report = { generatedAt: new Date().toISOString(), targets: [], totals: {} };

try {
  for (const [slug, url] of targets) {
    const dir = resolve(OUT, slug);
    mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1200 },
      userAgent: "TCOS-Sportlots-Checklist-Probe/1.0",
    });
    const page = await context.newPage();
    const responses = [];
    const jsonBodies = [];

    page.on("response", async (response) => {
      const contentType = response.headers()["content-type"] || "";
      const item = { url: response.url(), status: response.status(), contentType };
      responses.push(item);
      if (/json|javascript|text\/plain/i.test(contentType)) {
        try {
          const body = await response.text();
          if (/card|player|checklist|number/i.test(body)) {
            jsonBodies.push({ ...item, body: body.slice(0, 2_000_000) });
          }
        } catch {}
      }
    });

    let error = null;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(5_000);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const title = await page.title().catch(() => "");
    const html = await page.content().catch(() => "");
    writeFileSync(resolve(dir, "rendered.html"), html);
    await page.screenshot({ path: resolve(dir, "page.png"), fullPage: true }).catch(() => {});

    const tables = await page.locator("table").evaluateAll((nodes) => nodes.map((table, tableIndex) => ({
      tableIndex,
      headers: Array.from(table.querySelectorAll("thead th, tr:first-child th")).map((n) => (n.textContent || "").replace(/\s+/g, " ").trim()),
      rows: Array.from(table.querySelectorAll("tr")).map((tr) => Array.from(tr.querySelectorAll("th,td")).map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim())).filter((row) => row.some(Boolean)),
    })));

    const allRows = tables.flatMap((table) => table.rows.map((cells) => ({ tableIndex: table.tableIndex, cells })));
    const candidateRows = allRows.filter(({ cells }) => {
      if (cells.length < 2) return false;
      const firstThree = cells.slice(0, 3);
      return firstThree.some(looksLikeCardNumber) && cells.some((cell) => /[A-Za-z]{3}/.test(cell));
    });

    const bodyLines = clean(await page.locator("body").innerText().catch(() => "")).split(/(?<=\.)\s+|\n/).map(clean).filter(Boolean);
    const validation = {
      valid: candidateRows.length > 0,
      reason: candidateRows.length ? "card_number_and_description_rows_found" : "no_valid_card_rows_found",
      tableCount: tables.length,
      tableRowCount: allRows.length,
      candidateCardRowCount: candidateRows.length,
      responseCount: responses.length,
      matchingNetworkBodies: jsonBodies.length,
    };

    writeFileSync(resolve(dir, "tables.json"), JSON.stringify(tables, null, 2));
    writeFileSync(resolve(dir, "candidate-card-rows.json"), JSON.stringify(candidateRows, null, 2));
    writeFileSync(resolve(dir, "network-responses.json"), JSON.stringify(responses, null, 2));
    writeFileSync(resolve(dir, "matching-network-bodies.json"), JSON.stringify(jsonBodies, null, 2));
    writeFileSync(resolve(dir, "body-lines.json"), JSON.stringify(bodyLines.slice(0, 20_000), null, 2));
    writeFileSync(resolve(dir, "validation.json"), JSON.stringify({ slug, url, title, error, ...validation }, null, 2));

    report.targets.push({ slug, url, title, error, ...validation });
    console.log(JSON.stringify({ slug, ...validation }));
    await context.close();
  }
} finally {
  await browser.close();
}

report.totals = {
  tested: report.targets.length,
  validChecklists: report.targets.filter((r) => r.valid).length,
  rejected: report.targets.filter((r) => !r.valid).length,
  candidateCardRows: report.targets.reduce((sum, r) => sum + r.candidateCardRowCount, 0),
  errors: report.targets.filter((r) => r.error).length,
};
writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(resolve(OUT, "report.md"), [
  "# Sportlots Card-Row Probe",
  "",
  `Tested: ${report.totals.tested}`,
  `Valid checklists: ${report.totals.validChecklists}`,
  `Rejected: ${report.totals.rejected}`,
  `Candidate card rows: ${report.totals.candidateCardRows}`,
  `Errors: ${report.totals.errors}`,
  "",
  ...report.targets.map((r) => `- ${r.slug}: ${r.valid ? "VALID" : "REJECTED"}; rows=${r.candidateCardRowCount}; tables=${r.tableCount}; networkMatches=${r.matchingNetworkBodies}${r.error ? `; error=${r.error}` : ""}`),
  "",
].join("\n"));

if (report.totals.validChecklists === 0) process.exitCode = 2;
