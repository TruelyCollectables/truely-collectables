import { createDecipheriv, createHash, privateDecrypt, constants } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const TRANSPORT_ID = '317a1ac862e5b35bf4a6e4dff1856ff2dfd9a6791595633b';
const EXPECTED_ENCRYPTED_TAR_SHA256 = 'd36d658f415283a313268b10ac55894844fb22e39a62d02d99ac94f844a29bc0';
const EXPECTED_PLAINTEXT_TAR_SHA256 = '5382b8b540a44413aaf23f1f69a55289e635af9a6b98de47c932f818e6d9ff4f';
const EXPECTED_PAYLOAD_SHA256 = 'f8bccb18a6db7ed1138191e41c845935d1d4c97165ad9f10eb01fba8d3df347e';
const EXPECTED_TOTAL_ROWS = 128636;
const EXPECTED_TOTAL_PAGES = 642;
const FILES = ['baseball.zip', 'football.zip', 'basketball.zip', 'hockey.zip', 'vintage.zip'];
const ENTRY_BATCH = 500;
const PAGE_BATCH = 20;

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function parseEnv(contents) {
  const out = {};
  for (const raw of String(contents || '').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}
function projectRef(url) {
  const match = String(url || '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  if (!match) throw new Error('Invalid Production Supabase URL.');
  return match[1];
}
async function managementQuery({ project, token, query, parameters = [], readOnly = true }) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, parameters, read_only: readOnly }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase Management query failed (${response.status}): ${text.slice(0, 1500)}`);
  return text ? JSON.parse(text) : [];
}
function readNdjson(path) {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function chunks(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
function firstRow(result) { return Array.isArray(result) ? result[0] : result; }

async function upsertGuide(project, token, manifest) {
  const g = manifest.guide;
  const rows = await managementQuery({
    project, token, readOnly: false,
    parameters: [g.title, g.sport, g.issueCode || null, g.editionDate, g.originalFilename, g.sourceSha256, g.pageCount, g.priceGuideStartPage, g.priceGuideEndPage, manifest.parserVersion, JSON.stringify({ extraction: manifest.extraction, counts: manifest.counts })],
    query: `insert into public.tcos_kingmaker_price_guides (source,title,sport,issue_code,edition_date,original_filename,source_sha256,page_count,price_guide_start_page,price_guide_end_page,parser_version,extraction_status,redistribution_allowed,metadata)
      values ('beckett',$1,$2,$3,$4::date,$5,$6,$7::integer,$8::integer,$9::integer,$10,'validation_required',false,$11::jsonb)
      on conflict (source_sha256) do update set title=excluded.title,sport=excluded.sport,issue_code=excluded.issue_code,edition_date=excluded.edition_date,original_filename=excluded.original_filename,page_count=excluded.page_count,price_guide_start_page=excluded.price_guide_start_page,price_guide_end_page=excluded.price_guide_end_page,parser_version=excluded.parser_version,extraction_status='validation_required',metadata=excluded.metadata
      returning id`,
  });
  return firstRow(rows).id;
}
async function upsertRun(project, token, guideId, manifest) {
  const runKey = `${manifest.guide.sourceSha256}:${manifest.parserVersion}:${sha256(Buffer.from(JSON.stringify(manifest)))}`;
  const rows = await managementQuery({
    project, token, readOnly: false,
    parameters: [guideId, runKey, manifest.parserVersion, manifest.counts.pages, manifest.counts.entries, JSON.stringify({ transportId: TRANSPORT_ID })],
    query: `insert into public.tcos_kingmaker_price_import_runs (guide_id,run_key,parser_version,status,pages_seen,entries_seen,metadata)
      values ($1::uuid,$2,$3,'running',$4::integer,$5::integer,$6::jsonb)
      on conflict (run_key) do update set status='running',pages_seen=excluded.pages_seen,entries_seen=excluded.entries_seen,error_code=null,error_message=null,completed_at=null,metadata=excluded.metadata
      returning id`,
  });
  return firstRow(rows).id;
}
async function upsertPages(project, token, guideId, runId, pages) {
  let done = 0;
  for (const batch of chunks(pages, PAGE_BATCH)) {
    const payload = batch.map((p) => ({
      guide_id: guideId, import_run_id: runId, page_number: p.pageNumber, printed_page_number: p.printedPageNumber || null,
      section_name: p.sectionName || null, image_sha256: p.imageSha256 || null, ocr_engine: p.ocrEngine,
      ocr_confidence: p.ocrConfidence ?? null, ocr_text: p.ocrText || null, layout: p.layout || {}, status: p.status,
      metadata: p.metadata || {},
    }));
    await managementQuery({
      project, token, readOnly: false, parameters: [JSON.stringify(payload)],
      query: `insert into public.tcos_kingmaker_price_pages (guide_id,import_run_id,page_number,printed_page_number,section_name,image_sha256,ocr_engine,ocr_confidence,ocr_text,layout,status,metadata)
        select x.guide_id,x.import_run_id,x.page_number,x.printed_page_number,x.section_name,x.image_sha256,x.ocr_engine,x.ocr_confidence,x.ocr_text,x.layout,x.status,x.metadata
        from jsonb_to_recordset($1::jsonb) as x(guide_id uuid,import_run_id uuid,page_number integer,printed_page_number text,section_name text,image_sha256 text,ocr_engine text,ocr_confidence numeric,ocr_text text,layout jsonb,status text,metadata jsonb)
        on conflict (guide_id,page_number) do update set import_run_id=excluded.import_run_id,printed_page_number=excluded.printed_page_number,section_name=excluded.section_name,image_sha256=excluded.image_sha256,ocr_engine=excluded.ocr_engine,ocr_confidence=excluded.ocr_confidence,ocr_text=excluded.ocr_text,layout=excluded.layout,status=excluded.status,metadata=excluded.metadata`,
    });
    done += batch.length;
    console.log(`pages ${done}/${pages.length}`);
  }
}
async function upsertEntries(project, token, guideId, runId, entries) {
  let done = 0;
  for (const batch of chunks(entries, ENTRY_BATCH)) {
    const payload = batch.map((e) => ({
      guide_id: guideId, import_run_id: runId, page_number: e.pageNumber, row_order: e.rowOrder, source_row_key: e.sourceRowKey,
      entry_kind: e.entryKind, release_year: e.releaseYear || null, season: e.season || null, manufacturer: e.manufacturer || null,
      brand: e.brand || null, product: e.product || null, set_name: e.setName || null, parallel_name: e.parallelName || null,
      card_number: e.cardNumber || null, player_name: e.playerName || null, team_name: e.teamName || null,
      rookie_designation: e.rookieDesignation ?? null, autograph_designation: e.autographDesignation ?? null,
      memorabilia_designation: e.memorabiliaDesignation ?? null, short_print_designation: e.shortPrintDesignation ?? null,
      error_designation: e.errorDesignation ?? null, variation: e.variation || null, serial_run: e.serialRun ?? null,
      condition_basis: e.conditionBasis || null, value_low: e.valueLow ?? null, value_high: e.valueHigh ?? null,
      currency: e.currency || 'USD', multiplier_low: e.multiplierLow ?? null, multiplier_high: e.multiplierHigh ?? null,
      raw_text: e.rawText, parse_confidence: e.parseConfidence, validation_status: e.validationStatus,
      validation_reasons: e.validationReasons || [], identity_match_status: 'unmatched', entity_key: e.entityKey || null,
      metadata: e.metadata || {},
    }));
    await managementQuery({
      project, token, readOnly: false, parameters: [JSON.stringify(payload)],
      query: `insert into public.tcos_kingmaker_price_entries (guide_id,import_run_id,page_number,row_order,source_row_key,entry_kind,release_year,season,manufacturer,brand,product,set_name,parallel_name,card_number,player_name,team_name,rookie_designation,autograph_designation,memorabilia_designation,short_print_designation,error_designation,variation,serial_run,condition_basis,value_low,value_high,currency,multiplier_low,multiplier_high,raw_text,parse_confidence,validation_status,validation_reasons,identity_match_status,entity_key,metadata)
        select x.guide_id,x.import_run_id,x.page_number,x.row_order,x.source_row_key,x.entry_kind,x.release_year,x.season,x.manufacturer,x.brand,x.product,x.set_name,x.parallel_name,x.card_number,x.player_name,x.team_name,x.rookie_designation,x.autograph_designation,x.memorabilia_designation,x.short_print_designation,x.error_designation,x.variation,x.serial_run,x.condition_basis,x.value_low,x.value_high,x.currency,x.multiplier_low,x.multiplier_high,x.raw_text,x.parse_confidence,x.validation_status,x.validation_reasons,x.identity_match_status,x.entity_key,x.metadata
        from jsonb_to_recordset($1::jsonb) as x(guide_id uuid,import_run_id uuid,page_number integer,row_order integer,source_row_key text,entry_kind text,release_year text,season text,manufacturer text,brand text,product text,set_name text,parallel_name text,card_number text,player_name text,team_name text,rookie_designation boolean,autograph_designation boolean,memorabilia_designation boolean,short_print_designation boolean,error_designation boolean,variation text,serial_run integer,condition_basis text,value_low numeric,value_high numeric,currency text,multiplier_low numeric,multiplier_high numeric,raw_text text,parse_confidence numeric,validation_status text,validation_reasons jsonb,identity_match_status text,entity_key text,metadata jsonb)
        on conflict (guide_id,source_row_key) do update set import_run_id=excluded.import_run_id,page_number=excluded.page_number,row_order=excluded.row_order,entry_kind=excluded.entry_kind,release_year=excluded.release_year,season=excluded.season,manufacturer=excluded.manufacturer,brand=excluded.brand,product=excluded.product,set_name=excluded.set_name,parallel_name=excluded.parallel_name,card_number=excluded.card_number,player_name=excluded.player_name,team_name=excluded.team_name,rookie_designation=excluded.rookie_designation,autograph_designation=excluded.autograph_designation,memorabilia_designation=excluded.memorabilia_designation,short_print_designation=excluded.short_print_designation,error_designation=excluded.error_designation,variation=excluded.variation,serial_run=excluded.serial_run,condition_basis=excluded.condition_basis,value_low=excluded.value_low,value_high=excluded.value_high,currency=excluded.currency,multiplier_low=excluded.multiplier_low,multiplier_high=excluded.multiplier_high,raw_text=excluded.raw_text,parse_confidence=excluded.parse_confidence,validation_status=excluded.validation_status,validation_reasons=excluded.validation_reasons,entity_key=excluded.entity_key,metadata=excluded.metadata`,
    });
    done += batch.length;
    console.log(`entries ${done}/${entries.length}`);
  }
}

async function main() {
  if (process.env.ALLOW_KINGMAKER_BECKETT_IMPORT !== 'YES') throw new Error('ALLOW_KINGMAKER_BECKETT_IMPORT=YES is required.');
  const envPath = process.env.PRODUCTION_ENV_FILE;
  const token = process.env.GH_SUPABASE_ACCESS_TOKEN;
  const encryptedTarPath = resolve(process.env.ENCRYPTED_TAR_PATH || 'corpus.tar');
  const workDir = resolve(process.env.WORK_DIR || '.kingmaker-beckett-import');
  const receiptPath = resolve(process.env.RECEIPT_PATH || 'evidence/kingmaker-beckett-production-import-20260803/receipt.json');
  if (!envPath || !token) throw new Error('Missing Production environment or Supabase access token.');
  const env = parseEnv(readFileSync(envPath, 'utf8'));
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Production Supabase URL is missing.');
  const project = projectRef(supabaseUrl);

  const encryptedTar = readFileSync(encryptedTarPath);
  if (sha256(encryptedTar) !== EXPECTED_ENCRYPTED_TAR_SHA256) throw new Error('Encrypted transport SHA-256 mismatch.');
  mkdirSync(workDir, { recursive: true });
  execFileSync('tar', ['-xf', encryptedTarPath, '-C', workDir]);
  const envelope = JSON.parse(readFileSync(join(workDir, 'envelope.json'), 'utf8'));
  if (envelope.transportId !== TRANSPORT_ID || envelope.payloadSha256 !== EXPECTED_PAYLOAD_SHA256 || envelope.plaintextTarSha256 !== EXPECTED_PLAINTEXT_TAR_SHA256) throw new Error('Envelope contract mismatch.');

  const keyRow = firstRow(await managementQuery({ project, token, parameters: [TRANSPORT_ID], query: `select private_key_pem,expires_at,consumed_at from private.tcos_kingmaker_beckett_transport_keys where transport_id=$1` }));
  if (!keyRow?.private_key_pem || keyRow.consumed_at || Date.parse(keyRow.expires_at) <= Date.now()) throw new Error('One-time private transport key is missing, consumed, or expired.');
  const aesKey = privateDecrypt({ key: keyRow.private_key_pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, readFileSync(join(workDir, 'wrapped-key.bin')));
  const payload = readFileSync(join(workDir, 'payload.aesgcm'));
  if (sha256(payload) !== EXPECTED_PAYLOAD_SHA256) throw new Error('Encrypted payload SHA-256 mismatch.');
  const decipher = createDecipheriv('aes-256-gcm', aesKey, readFileSync(join(workDir, 'nonce.bin')));
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  const plaintextTar = Buffer.concat([decipher.update(payload.subarray(0, -16)), decipher.final()]);
  if (sha256(plaintextTar) !== EXPECTED_PLAINTEXT_TAR_SHA256) throw new Error('Decrypted payload SHA-256 mismatch.');
  const plainPath = join(workDir, 'bundles.tar');
  writeFileSync(plainPath, plaintextTar, { mode: 0o600 });
  const bundlesDir = join(workDir, 'bundles');
  mkdirSync(bundlesDir, { recursive: true });
  execFileSync('tar', ['-xf', plainPath, '-C', bundlesDir]);
  const summary = JSON.parse(readFileSync(join(bundlesDir, 'validation-summary.json'), 'utf8'));
  if (summary.totalRows !== EXPECTED_TOTAL_ROWS || summary.totalPages !== EXPECTED_TOTAL_PAGES) throw new Error('Certified corpus totals mismatch.');

  const imports = [];
  for (const zipName of FILES) {
    const target = join(bundlesDir, basename(zipName, '.zip'));
    mkdirSync(target, { recursive: true });
    execFileSync('unzip', ['-q', '-o', join(bundlesDir, zipName), '-d', target]);
    const manifest = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8'));
    const pages = readNdjson(join(target, manifest.files.pages));
    const entries = readNdjson(join(target, manifest.files.entries));
    if (pages.length !== manifest.counts.pages || entries.length !== manifest.counts.entries) throw new Error(`${zipName} manifest count mismatch.`);
    console.log(`staging ${zipName}: ${pages.length} pages, ${entries.length} rows`);
    const guideId = await upsertGuide(project, token, manifest);
    const runId = await upsertRun(project, token, guideId, manifest);
    await upsertPages(project, token, guideId, runId, pages);
    await upsertEntries(project, token, guideId, runId, entries);
    const matchResult = firstRow(await managementQuery({ project, token, readOnly: false, parameters: [guideId], query: `select public.tcos_match_kingmaker_price_entries($1::uuid) as result` }));
    await managementQuery({ project, token, readOnly: false, parameters: [runId, manifest.counts.pages, manifest.counts.entries, JSON.stringify({ transportId: TRANSPORT_ID, matchResult: matchResult?.result || null })], query: `update public.tcos_kingmaker_price_import_runs set status='validation_required',pages_accepted=$2::integer,entries_review=$3::integer,completed_at=now(),metadata=$4::jsonb where id=$1::uuid` });
    imports.push({ zipName, guideId, runId, pages: pages.length, rows: entries.length, matchResult: matchResult?.result || null });
  }

  const verification = firstRow(await managementQuery({ project, token, query: `select (select count(*) from public.tcos_kingmaker_price_guides) as guides,(select count(*) from public.tcos_kingmaker_price_pages) as pages,(select count(*) from public.tcos_kingmaker_price_entries) as entries,(select count(*) from public.tcos_kingmaker_price_entries where validation_status='accepted') as accepted,(select count(*) from public.tcos_kingmaker_price_entries where validation_status='review') as review,(select count(*) from public.tcos_kingmaker_observations where source='beckett') as promoted` }));
  if (Number(verification.guides) < 5 || Number(verification.pages) < EXPECTED_TOTAL_PAGES || Number(verification.entries) < EXPECTED_TOTAL_ROWS || Number(verification.promoted) !== 0) throw new Error('Production verification failed.');
  await managementQuery({ project, token, readOnly: false, parameters: [TRANSPORT_ID], query: `update private.tcos_kingmaker_beckett_transport_keys set consumed_at=now() where transport_id=$1 and consumed_at is null` });

  const receipt = { schema: 'tcos.kingmaker.beckettProductionImportReceipt.v1', status: 'passed', generatedAt: new Date().toISOString(), transportId: TRANSPORT_ID, encryptedTarSha256: EXPECTED_ENCRYPTED_TAR_SHA256, plaintextTarSha256: EXPECTED_PLAINTEXT_TAR_SHA256, certifiedCorpus: { guides: 5, pages: EXPECTED_TOTAL_PAGES, rows: EXPECTED_TOTAL_ROWS }, imports, production: Object.fromEntries(Object.entries(verification).map(([k,v]) => [k, Number(v)])), promotedAutomatically: false, secretsPersisted: false };
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
