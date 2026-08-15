import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import { downloadAndParse } from './source-tools.mjs';
import { normalizeGoGtsStructuredText } from './gogts-structured-normalizer.mjs';
import { buildPlan, assertPlanComplexity } from './registry-tools.mjs';

const execFileAsync = promisify(execFile);
const QUEUE = process.env.QUEUE;
const OUT = process.env.OUT || 'tmp/gogts-boundary-complexity.json';
const INDEXES = String(process.env.INDEXES || '258,259,260,261,262,263,264')
  .split(',').map((v) => Number(v.trim())).filter(Number.isInteger);
if (!QUEUE) throw new Error('QUEUE is required');

function mime(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.csv') return 'text/csv';
  return 'application/octet-stream';
}

async function extract(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.csv') return readFileSync(path, 'utf8');
  if (ext === '.pdf') {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', '-nopgbrk', path, '-'], {
      encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120_000,
    });
    return String(stdout || '');
  }
  const py = String.raw`
import sys
path=sys.argv[1]
rows=[]
if path.lower().endswith('.xlsx'):
    import openpyxl
    wb=openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        rows.append('## '+ws.title)
        for row in ws.iter_rows(values_only=True):
            vals=[str(v).strip() for v in row if v is not None and str(v).strip()]
            if vals: rows.append(' | '.join(vals))
else:
    import xlrd
    wb=xlrd.open_workbook(path)
    for ws in wb.sheets():
        rows.append('## '+ws.name)
        for r in range(ws.nrows):
            vals=[str(ws.cell_value(r,c)).strip() for c in range(ws.ncols) if str(ws.cell_value(r,c)).strip()]
            if vals: rows.append(' | '.join(vals))
print('\n'.join(rows))
`;
  const { stdout } = await execFileAsync('python3', ['-c', py, path], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120_000,
  });
  return String(stdout || '');
}

const q = JSON.parse(readFileSync(QUEUE, 'utf8')).candidates;
const results = [];
for (const index of INDEXES) {
  const c = q[index];
  const started = Date.now();
  if (!c) { results.push({ index, error: 'missing queue item' }); continue; }
  try {
    const raw = readFileSync(c.localPath);
    const extractStart = Date.now();
    const extracted = await extract(c.localPath);
    const extractMs = Date.now() - extractStart;
    const normalizeStart = Date.now();
    const normalized = normalizeGoGtsStructuredText(extracted);
    const normalizeMs = Date.now() - normalizeStart;
    const offline = `https://offline.invalid/${createHash('sha256').update(raw).digest('hex')}.txt`;
    const native = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const u = typeof input === 'string' ? input : String(input?.url || input);
      if (u === offline) return new Response(Buffer.from(normalized), { status: 200, headers: { 'content-type': 'text/plain' } });
      return native(input, init);
    };
    const [sport, season, manufacturer, product] = c.exactSetKey.split('|');
    const entry = {
      id: `diag-${index}`, sourceName: 'diag', sourceUrl: offline, fallbackUrls: [],
      authority: 'approved_reference_dataset', redistributionAllowed: false,
      disposition: 'registry_candidate', minimumCardRows: 25,
      release: { exactSetKey: c.exactSetKey, sport, season,
        releaseYear: (season.match(/(?:19|20)\d{2}/) || [''])[0], manufacturer, brand: null,
        product, league: null, canonicalName: `${season} ${manufacturer} ${product}` },
    };
    let downloaded;
    const parseStart = Date.now();
    try { downloaded = await downloadAndParse(entry); } finally { globalThis.fetch = native; }
    const parseMs = Date.now() - parseStart;
    const source = { ...downloaded.source, bytes: new Uint8Array(raw), finalUrl: c.sourceUrl,
      selectedUrl: c.sourceUrl, mimeType: mime(c.localPath), filename: c.localPath.split('/').pop() };
    const planStart = Date.now();
    const plan = buildPlan(entry, downloaded.parsed, source, new Date().toISOString());
    const complexity = assertPlanComplexity(plan);
    const planMs = Date.now() - planStart;
    results.push({ index, exactSetKey: c.exactSetKey, archivedBytes: c.archivedBytes,
      extractedChars: extracted.length, normalizedChars: normalized.length,
      counts: plan.validation.counts, issues: plan.validation.issues.length,
      planBytes: complexity.serializedBytes, extractMs, normalizeMs, parseMs, planMs,
      elapsedMs: Date.now() - started });
  } catch (error) {
    results.push({ index, exactSetKey: c.exactSetKey, archivedBytes: c.archivedBytes,
      error: String(error?.stack || error), elapsedMs: Date.now() - started });
  }
}
const payload = { generatedAt: new Date().toISOString(), indexes: INDEXES, results };
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log(JSON.stringify(payload, null, 2));
