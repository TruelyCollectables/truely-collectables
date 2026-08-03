import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

function parseEnv(contents) {
  const out = {};
  for (const raw of String(contents).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const envPath = process.env.PRODUCTION_ENV_FILE;
const serviceKey = process.env.RESOLVED_SUPABASE_SERVICE_ROLE_KEY;
const outputPath = process.env.OUTPUT_PATH || 'evidence/beckett-signed-upload.json';
const transportId = process.env.TRANSPORT_ID;
if (!envPath || !serviceKey || !transportId) throw new Error('Missing Production env, service key, or transport id.');
const env = parseEnv(readFileSync(envPath, 'utf8'));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL.');
const objectPath = `tcos/kingmaker/beckett/transport/${transportId}/payload.tar`;
const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supabase.storage.from('tcos-kingmaker-price-guide-sources').createSignedUploadUrl(objectPath, { upsert: true });
if (error || !data?.token) throw new Error(error?.message || 'Signed upload URL creation failed.');
const receipt = {
  schema: 'tcos.kingmaker.beckettSignedUpload.v1',
  transportId,
  bucket: 'tcos-kingmaker-price-guide-sources',
  objectPath,
  token: data.token,
  signedUrl: data.signedUrl || null,
  generatedAt: new Date().toISOString(),
  expiresInSeconds: 7200,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ ...receipt, token: '[redacted]', signedUrl: receipt.signedUrl ? '[redacted]' : null }, null, 2));
