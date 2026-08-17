import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const manifestPath = resolve(args.get('--manifest') || 'data/requested-checklist-source-queue-20260816.json');
const start = Math.max(0, Number(args.get('--start') || 0));
const count = Math.max(1, Number(args.get('--count') || 9));
const outputRoot = resolve(args.get('--output') || '.checklist-source-collection');
const receiptName = args.get('--receipt') || `batch-${start + 1}-receipt.json`;
const initialDelayMs = Math.max(0, Number(args.get('--initial-delay-ms') || 0));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const delayMs = Math.max(300_000, Number(manifest?.scope?.minimumSecondsBetweenSourceFetches || 300) * 1000);
const targets = manifest.supplements.slice(start, start + count);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (value) => String(value).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 180) || 'source';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function extensionFor(target, finalUrl) {
  const kind = String(target.kind || '').toLowerCase();
  if (['html', 'pdf', 'xlsx', 'xls', 'csv', 'json', 'txt'].includes(kind)) return kind;
  try {
    const ext = basename(new URL(finalUrl || target.url).pathname).split('.').pop()?.toLowerCase();
    if (ext && /^[a-z0-9]{1,8}$/.test(ext)) return ext;
  } catch {}
  return 'bin';
}

function validate(target, bytes, contentType) {
  const kind = String(target.kind || '').toLowerCase();
  if (bytes.length < 200) return `source too small (${bytes.length} bytes)`;
  if (kind === 'pdf' && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return 'expected PDF signature';
  if (kind === 'xlsx' && bytes.subarray(0, 2).toString('ascii') !== 'PK') return 'expected XLSX ZIP signature';
  if (kind === 'xls') {
    const ole = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
    const textish = /text|html|excel|octet-stream/i.test(String(contentType || ''));
    if (!ole && !textish) return `unexpected XLS content-type ${contentType || 'unknown'}`;
  }
  if (kind === 'csv') {
    const text = bytes.toString('utf8');
    if (text.split(/\r?\n/).length < 5 || !text.includes(',')) return 'CSV shape check failed';
  }
  if (kind === 'html') {
    const text = bytes.toString('utf8').toLowerCase();
    if (!text.includes('checklist')) return 'HTML does not contain checklist marker';
    if (!(text.includes('set name') || text.includes('card'))) return 'HTML does not contain checklist table markers';
  }
  return null;
}

mkdirSync(resolve(outputRoot, 'sources'), { recursive: true });
const receiptPath = resolve(outputRoot, receiptName);
const receipt = {
  schema: 'tcos.requestedChecklistSourceBatchReceipt.v1',
  manifest: manifestPath,
  start,
  requestedCount: count,
  actualCount: targets.length,
  minimumSecondsBetweenSourceFetches: delayMs / 1000,
  results: [],
};
const save = () => {
  receipt.updatedAt = new Date().toISOString();
  receipt.successCount = receipt.results.filter((r) => r.status === 'downloaded').length;
  receipt.failedCount = receipt.results.filter((r) => r.status === 'failed').length;
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
};

if (initialDelayMs > 0 && targets.length) {
  console.log(`Initial inter-batch throttle: ${initialDelayMs}ms`);
  await sleep(initialDelayMs);
}

for (let i = 0; i < targets.length; i += 1) {
  const target = targets[i];
  const row = { index: start + i, key: target.key, title: target.title, url: target.url, authority: target.authority, startedAt: new Date().toISOString() };
  receipt.results.push(row);
  try {
    console.log(`FETCH ${start + i + 1}/${manifest.supplements.length}: ${target.key}`);
    const response = await fetch(target.url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'TruelyCollectables-Checklist-Source-Collector/1.0 (+https://truelycollectables.com)',
        'accept': '*/*',
      },
      signal: AbortSignal.timeout(120_000),
    });
    row.httpStatus = response.status;
    row.finalUrl = response.url;
    row.contentType = response.headers.get('content-type');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const validationError = validate(target, bytes, row.contentType);
    if (validationError) throw new Error(validationError);
    const ext = extensionFor(target, response.url);
    const fileName = `${String(start + i + 1).padStart(3, '0')}__${safe(target.key)}.${ext}`;
    const filePath = resolve(outputRoot, 'sources', fileName);
    writeFileSync(filePath, bytes);
    row.status = 'downloaded';
    row.file = `sources/${fileName}`;
    row.bytes = bytes.length;
    row.sha256 = sha256(bytes);
    row.completedAt = new Date().toISOString();
    console.log(`DOWNLOADED ${target.key} ${bytes.length} bytes ${row.sha256.slice(0, 12)}`);
  } catch (error) {
    row.status = 'failed';
    row.error = error instanceof Error ? error.message : String(error);
    row.completedAt = new Date().toISOString();
    console.error(`FAILED ${target.key}: ${row.error}`);
  }
  save();
  if (i < targets.length - 1) {
    console.log(`Throttle sleep ${delayMs}ms before next source request`);
    await sleep(delayMs);
  }
}

save();
console.log(JSON.stringify({ start, actualCount: receipt.actualCount, successCount: receipt.successCount, failedCount: receipt.failedCount }, null, 2));
