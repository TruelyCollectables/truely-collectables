import { createDecipheriv, createHash, privateDecrypt, constants } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const TRANSPORT_ID = '317a1ac862e5b35bf4a6e4dff1856ff2dfd9a6791595633b';
const EXPECTED_ENCRYPTED_TAR_SHA256 = 'd36d658f415283a313268b10ac55894844fb22e39a62d02d99ac94f844a29bc0';
const EXPECTED_PLAINTEXT_TAR_SHA256 = '5382b8b540a44413aaf23f1f69a55289e635af9a6b98de47c932f818e6d9ff4f';
const EXPECTED_PAYLOAD_SHA256 = 'f8bccb18a6db7ed1138191e41c845935d1d4c97165ad9f10eb01fba8d3df347e';
const EXPECTED_TOTAL_ROWS = 128636;
const EXPECTED_TOTAL_PAGES = 642;
const FILES = ['baseball.zip', 'football.zip', 'basketball.zip', 'hockey.zip', 'vintage.zip'];

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

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
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
  if (!response.ok) throw new Error(`Supabase Management query failed (${response.status}): ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : [];
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}

async function main() {
  if (process.env.ALLOW_KINGMAKER_BECKETT_IMPORT !== 'YES') throw new Error('ALLOW_KINGMAKER_BECKETT_IMPORT=YES is required.');
  const envPath = process.env.PRODUCTION_ENV_FILE;
  const accessToken = process.env.GH_SUPABASE_ACCESS_TOKEN;
  const encryptedTarPath = resolve(process.env.ENCRYPTED_TAR_PATH || 'kingmaker-beckett-encrypted-transport-20260803.tar');
  const workDir = resolve(process.env.WORK_DIR || '.kingmaker-beckett-import');
  const receiptPath = resolve(process.env.RECEIPT_PATH || 'evidence/kingmaker-beckett-production-import-20260803/receipt.json');
  if (!envPath || !accessToken) throw new Error('Missing Production environment or Supabase access token.');

  const productionEnv = parseEnv(readFileSync(envPath, 'utf8'));
  const supabaseUrl = firstNonEmpty(
    productionEnv.NEXT_PUBLIC_SUPABASE_URL,
    productionEnv.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
  );
  const serviceRoleKey = firstNonEmpty(
    productionEnv.SUPABASE_SERVICE_ROLE_KEY,
    productionEnv.SUPABASE_SERVICE_KEY,
    productionEnv.TCOS_SUPABASE_SERVICE_ROLE_KEY,
    productionEnv.RESOLVED_SUPABASE_SERVICE_ROLE_KEY,
    process.env.GH_SUPABASE_SERVICE_ROLE_KEY,
    process.env.GH_SUPABASE_SERVICE_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_KEY,
  );
  if (!supabaseUrl) throw new Error('Production Supabase URL is missing.');
  if (!serviceRoleKey) throw new Error('Production Supabase service credential is missing.');
  const project = projectRef(supabaseUrl);

  const encryptedTar = readFileSync(encryptedTarPath);
  if (sha256(encryptedTar) !== EXPECTED_ENCRYPTED_TAR_SHA256) throw new Error('Encrypted transport SHA-256 mismatch.');
  mkdirSync(workDir, { recursive: true });
  execFileSync('tar', ['-xf', encryptedTarPath, '-C', workDir]);
  const envelope = JSON.parse(readFileSync(join(workDir, 'envelope.json'), 'utf8'));
  if (envelope.transportId !== TRANSPORT_ID) throw new Error('Transport ID mismatch.');
  if (envelope.payloadSha256 !== EXPECTED_PAYLOAD_SHA256 || envelope.plaintextTarSha256 !== EXPECTED_PLAINTEXT_TAR_SHA256) throw new Error('Envelope hash contract mismatch.');

  const keyRows = await managementQuery({ project, token: accessToken, readOnly: true, parameters: [TRANSPORT_ID], query: `select private_key_pem, expires_at, consumed_at from private.tcos_kingmaker_beckett_transport_keys where transport_id = $1` });
  const keyRow = Array.isArray(keyRows) ? keyRows[0] : keyRows;
  if (!keyRow?.private_key_pem) throw new Error('One-time private transport key is missing.');
  if (keyRow.consumed_at) throw new Error('One-time transport key was already consumed.');
  if (Date.parse(keyRow.expires_at) <= Date.now()) throw new Error('One-time transport key has expired.');

  const aesKey = privateDecrypt({ key: keyRow.private_key_pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, readFileSync(join(workDir, 'wrapped-key.bin')));
  if (aesKey.length !== 32) throw new Error('Unwrapped AES key is not 256 bits.');
  const nonce = readFileSync(join(workDir, 'nonce.bin'));
  const payload = readFileSync(join(workDir, 'payload.aesgcm'));
  if (sha256(payload) !== EXPECTED_PAYLOAD_SHA256) throw new Error('Encrypted payload SHA-256 mismatch.');
  const decipher = createDecipheriv('aes-256-gcm', aesKey, nonce);
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  const plaintextTar = Buffer.concat([decipher.update(payload.subarray(0, payload.length - 16)), decipher.final()]);
  if (sha256(plaintextTar) !== EXPECTED_PLAINTEXT_TAR_SHA256) throw new Error('Decrypted payload SHA-256 mismatch.');

  const plaintextTarPath = join(workDir, 'bundles.tar');
  writeFileSync(plaintextTarPath, plaintextTar, { mode: 0o600 });
  const bundlesDir = join(workDir, 'bundles');
  mkdirSync(bundlesDir, { recursive: true });
  execFileSync('tar', ['-xf', plaintextTarPath, '-C', bundlesDir]);
  const validationSummary = JSON.parse(readFileSync(join(bundlesDir, 'validation-summary.json'), 'utf8'));
  if (validationSummary.totalRows !== EXPECTED_TOTAL_ROWS || validationSummary.totalPages !== EXPECTED_TOTAL_PAGES) throw new Error('Validation summary totals do not match the certified corpus.');

  const runtimeEnv = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey };
  const imports = [];
  for (const zipName of FILES) {
    const target = join(bundlesDir, basename(zipName, '.zip'));
    mkdirSync(target, { recursive: true });
    execFileSync('unzip', ['-q', '-o', join(bundlesDir, zipName), '-d', target]);
    run('npx', ['tsx', 'scripts/run-kingmaker-beckett-price-guide-import.ts', '--bundle', target, '--apply'], runtimeEnv);
    imports.push(zipName);
  }

  const verificationRows = await managementQuery({ project, token: accessToken, readOnly: true, query: `select (select count(*) from public.tcos_kingmaker_price_guides) as guides, (select count(*) from public.tcos_kingmaker_price_pages) as pages, (select count(*) from public.tcos_kingmaker_price_entries) as entries, (select count(*) from public.tcos_kingmaker_price_entries where validation_status = 'accepted') as accepted, (select count(*) from public.tcos_kingmaker_price_entries where validation_status = 'review') as review, (select count(*) from public.tcos_kingmaker_observations where source = 'beckett') as promoted` });
  const verification = Array.isArray(verificationRows) ? verificationRows[0] : verificationRows;
  if (Number(verification.guides) < 5 || Number(verification.pages) < EXPECTED_TOTAL_PAGES || Number(verification.entries) < EXPECTED_TOTAL_ROWS) throw new Error('Production row-count verification failed.');
  if (Number(verification.promoted) !== 0) throw new Error('Beckett observations were promoted unexpectedly.');

  await managementQuery({ project, token: accessToken, readOnly: false, parameters: [TRANSPORT_ID], query: `update private.tcos_kingmaker_beckett_transport_keys set consumed_at = now() where transport_id = $1 and consumed_at is null` });
  const receipt = {
    schema: 'tcos.kingmaker.beckettProductionImportReceipt.v1', status: 'passed', generatedAt: new Date().toISOString(), transportId: TRANSPORT_ID,
    encryptedTarSha256: EXPECTED_ENCRYPTED_TAR_SHA256, plaintextTarSha256: EXPECTED_PLAINTEXT_TAR_SHA256,
    certifiedCorpus: { guides: 5, pages: EXPECTED_TOTAL_PAGES, rows: EXPECTED_TOTAL_ROWS }, imports,
    production: Object.fromEntries(Object.entries(verification).map(([key, value]) => [key, Number(value)])),
    promotedAutomatically: false, secretsPersisted: false,
  };
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
