import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

const INPUT = process.env.CHECKLIST_CAPTURE_INPUT || 'data/checklist-capture-urls.txt';
const OUT = resolve(process.env.CHECKLIST_CAPTURE_OUT || '.checklist-browser-capture');
const DELAY_MS = Number(process.env.CHECKLIST_CAPTURE_DELAY_MS || 2500);
const MAX = Number(process.env.CHECKLIST_CAPTURE_MAX || 5000);
const ALLOWED = /(^|\.)(topps\.com|paniniamerica\.net|paniniamerica\.com|upperdeck\.com|sportlots\.com|checklistinsider\.com|cardboardconnection\.com|beckett\.com)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150) || 'checklist';
const csvCell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

async function ensureDirs() {
  for (const d of ['pdf','screenshots','html','csv','json','downloads']) await mkdir(join(OUT,d), { recursive: true });
}

async function loadUrls() {
  const raw = await readFile(INPUT, 'utf8');
  return [...new Set(raw.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith('#')))]
    .map((url) => new URL(url))
    .filter((u) => ALLOWED.test(u.hostname))
    .slice(0, MAX);
}

async function extractTables(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('table')].map((table, tableIndex) => {
      const rows = [...table.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => clean(c.innerText)));
      return { tableIndex, rows: rows.filter((r) => r.some(Boolean)) };
    }).filter((t) => t.rows.length > 1);
  });
}

function normalizeRows(tables) {
  const out = [];
  for (const table of tables) {
    const [first, ...rest] = table.rows;
    const headers = first.map((h, i) => h || `column_${i + 1}`);
    for (const row of rest) {
      const record = { table_index: table.tableIndex };
      headers.forEach((h, i) => { record[h] = row[i] ?? ''; });
      out.push(record);
    }
  }
  return out;
}

async function saveCsv(path, rows) {
  if (!rows.length) return;
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const body = [headers.map(csvCell).join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n');
  await writeFile(path, body + '\n');
}

async function main() {
  await ensureDirs();
  const urls = await loadUrls();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, userAgent: 'Mozilla/5.0 (compatible; TCOS-Public-Checklist-Archiver/1.0)' });
  const manifest = [];

  for (let i = 0; i < urls.length; i++) {
    const source = urls[i];
    const page = await context.newPage();
    const downloads = [];
    page.on('download', async (download) => {
      const suggested = download.suggestedFilename();
      const local = join(OUT, 'downloads', `${String(i + 1).padStart(5,'0')}-${slug(suggested)}${extname(suggested)}`);
      await download.saveAs(local);
      downloads.push(local);
    });

    const row = { index: i + 1, source_url: source.toString(), status: 'failed', captured_at: new Date().toISOString(), files: {}, rows: 0, error: null };
    try {
      const response = await page.goto(source.toString(), { waitUntil: 'networkidle', timeout: 90000 });
      if (!response || response.status() >= 400) throw new Error(`HTTP ${response?.status() ?? 'no-response'}`);
      await page.emulateMedia({ media: 'print' });
      const title = (await page.title()).trim() || basename(source.pathname) || 'checklist';
      const base = `${String(i + 1).padStart(5,'0')}-${slug(title)}`;
      const html = await page.content();
      const htmlPath = join(OUT, 'html', `${base}.html`);
      const pdfPath = join(OUT, 'pdf', `${base}.pdf`);
      const pngPath = join(OUT, 'screenshots', `${base}.png`);
      const jsonPath = join(OUT, 'json', `${base}.json`);
      const csvPath = join(OUT, 'csv', `${base}.csv`);
      await writeFile(htmlPath, html);
      await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true, preferCSSPageSize: true });
      await page.screenshot({ path: pngPath, fullPage: true });
      const tables = await extractTables(page);
      const records = normalizeRows(tables).map((r) => ({ source_url: source.toString(), source_title: title, ...r }));
      await writeFile(jsonPath, JSON.stringify({ source_url: source.toString(), title, tables, records }, null, 2));
      await saveCsv(csvPath, records);
      row.status = records.length ? 'structured_rows' : 'archive_only';
      row.rows = records.length;
      row.files = { html: htmlPath, pdf: pdfPath, screenshot: pngPath, json: jsonPath, csv: records.length ? csvPath : null, downloads };
      row.sha256 = { html: sha256(Buffer.from(html)), pdf: sha256(await readFile(pdfPath)), screenshot: sha256(await readFile(pngPath)) };
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
    } finally {
      manifest.push(row);
      await page.close();
      console.log(JSON.stringify({ processed: i + 1, total: urls.length, status: row.status, rows: row.rows, url: row.source_url }));
      await sleep(DELAY_MS);
    }
  }

  await browser.close();
  const allRows = [];
  for (const item of manifest) {
    if (!item.files?.json) continue;
    const parsed = JSON.parse(await readFile(item.files.json, 'utf8'));
    allRows.push(...(parsed.records || []));
  }
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ schema: 'tcos.publicChecklistCapture.v1', generated_at: new Date().toISOString(), totals: { urls: manifest.length, structured: manifest.filter((x) => x.status === 'structured_rows').length, archive_only: manifest.filter((x) => x.status === 'archive_only').length, failed: manifest.filter((x) => x.status === 'failed').length, rows: allRows.length }, items: manifest }, null, 2));
  await saveCsv(join(OUT, 'database-import.csv'), allRows);
  await writeFile(join(OUT, 'database-import.json'), JSON.stringify(allRows, null, 2));
  if (!manifest.some((x) => x.status !== 'failed')) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
