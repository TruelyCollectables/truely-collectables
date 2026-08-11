import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';

const EXPECTED_SHA256 = '86a13f93372196d888bd788c51374cd0db08c7afbf016293d665b7f6aa328be0';
const EXPECTED_COUNT = 171;
const EXPECTED_BACK_COUNT = 167;
const STORE_ID = '00000000-0000-4000-8000-000000000001';
const PARTS = [
  '.github/ops/collx-batch2-manifest.part0',
  '.github/ops/collx-batch2-manifest.part1',
  '.github/ops/collx-batch2-manifest.part2',
];

function fail(message) { throw new Error(message); }
function parseEnv(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}
function validImageSide(row, url, side) {
  if (!url) return side === 'back';
  const productPrefix = `https://storage.googleapis.com/collx-product-images/${row.c}-`;
  if (url.startsWith(`${productPrefix}${side === 'front' ? '1' : '2'}-`)) return true;
  const legacyPrefix = 'https://storage.googleapis.com/collx-user-cards/';
  if (!url.startsWith(legacyPrefix)) return false;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.includes(`-${String(row.c).toLowerCase()}-${side}.`) && /\.(?:jpe?g|png|webp)$/.test(pathname);
  } catch { return false; }
}
function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
function jsonSql(rows) { return `'${JSON.stringify(rows).replaceAll("'", "''")}'::jsonb`; }

const packed = PARTS.map((file) => fs.readFileSync(file, 'utf8').trim()).join('');
const raw = gunzipSync(Buffer.from(packed, 'base64'));
const digest = crypto.createHash('sha256').update(raw).digest('hex');
if (digest !== EXPECTED_SHA256) fail(`Manifest checksum mismatch: ${digest}`);
const manifest = JSON.parse(raw.toString('utf8'));
if (!Array.isArray(manifest) || manifest.length !== EXPECTED_COUNT) fail(`Expected ${EXPECTED_COUNT} manifest rows.`);

const inventoryIds = new Set();
const productIds = new Set();
const collxIds = new Set();
let backCount = 0;
const imageUrls = [];
for (const row of manifest) {
  if (!/^[0-9a-f-]{36}$/i.test(String(row.i || ''))) fail(`Invalid inventory id ${row.i}`);
  if (!Number.isInteger(Number(row.p)) || Number(row.p) <= 0) fail(`Invalid product id ${row.p}`);
  if (!/^\d+$/.test(String(row.c || ''))) fail(`Invalid CollX id ${row.c}`);
  if (!validImageSide(row, String(row.f || ''), 'front')) fail(`Invalid CollX front URL for ${row.c}`);
  if (row.b && !validImageSide(row, String(row.b), 'back')) fail(`Invalid CollX back URL for ${row.c}`);
  if (inventoryIds.has(row.i)) fail(`Duplicate inventory id ${row.i}`);
  if (productIds.has(Number(row.p))) fail(`Duplicate product id ${row.p}`);
  if (collxIds.has(String(row.c))) fail(`Duplicate CollX id ${row.c}`);
  inventoryIds.add(row.i); productIds.add(Number(row.p)); collxIds.add(String(row.c));
  imageUrls.push(row.f);
  if (row.b) { backCount += 1; imageUrls.push(row.b); }
}
if (backCount !== EXPECTED_BACK_COUNT) fail(`Expected ${EXPECTED_BACK_COUNT} backs, got ${backCount}.`);
console.log(JSON.stringify({ manifestRows: manifest.length, fronts: manifest.length, backs: backCount, digest }));

async function verifyRemoteImage(url) {
  const request = async (method) => fetch(url, {
    method,
    redirect: 'follow',
    headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let response = null;
  try { response = await request('HEAD'); } catch {}
  if (!response || response.status === 405 || response.status === 501 || !response.ok) {
    try { response = await request('GET'); } catch { response = null; }
  }
  return Boolean(response?.ok && (response.headers.get('content-type') || '').toLowerCase().startsWith('image/'));
}
const uniqueUrls = [...new Set(imageUrls)];
let nextUrl = 0;
const failedImages = [];
async function worker() {
  while (true) {
    const index = nextUrl++;
    if (index >= uniqueUrls.length) return;
    const url = uniqueUrls[index];
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
      ok = await verifyRemoteImage(url);
      if (!ok && attempt < 3) await sleep(500 * attempt);
    }
    if (!ok) failedImages.push(url);
    if ((index + 1) % 75 === 0) console.log(`Verified ${index + 1}/${uniqueUrls.length} remote images.`);
  }
}
await Promise.all(Array.from({ length: 24 }, () => worker()));
if (failedImages.length) fail(`Remote image verification failed for ${failedImages.length}: ${failedImages.slice(0,5).join(', ')}`);
console.log(`Verified ${uniqueUrls.length}/${uniqueUrls.length} CollX images.`);

const envPath = path.join(process.env.RUNNER_TEMP, 'collx-batch2-import', 'production.env');
const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
const productionUrl = env.NEXT_PUBLIC_SUPABASE_URL;
if (!productionUrl || !/^https:\/\//.test(productionUrl)) fail('Production Supabase URL unavailable.');
const projectRef = new URL(productionUrl).hostname.split('.')[0];
const token = process.env.GH_SUPABASE_ACCESS_TOKEN;
if (!projectRef || !token) fail('Production Supabase management access unavailable.');
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
function transient(status, body) {
  return [429,500,502,503,504,522,524,544].includes(status) || /timeout|connection terminated|terminating connection|administrator command|57P01|temporar|cloudflare|network/i.test(body);
}
async function dbQuery(sql, { readOnly, label }) {
  let last = '';
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    let response; let body = '';
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql, parameters: [], read_only: readOnly }),
      });
      body = await response.text();
    } catch (error) {
      last = String(error?.message || error);
      if (attempt === 10) fail(`${label} transport failed: ${last}`);
      await sleep(Math.min(15000, 1000 * attempt)); continue;
    }
    if (response.ok) return body ? JSON.parse(body) : [];
    last = `HTTP ${response.status}: ${body.slice(0,1200)}`;
    if (!transient(response.status, body) || attempt === 10) fail(`${label} failed: ${last}`);
    console.log(`${label}: transient ${response.status}; retry ${attempt}/10`);
    await sleep(Math.min(15000, 1000 * attempt));
  }
  fail(`${label} failed: ${last}`);
}

// Fail closed before any write. Also reject unexpected pre-existing CollX export images on these targets.
const guardFailures = [];
for (const [index, batch] of chunks(manifest, 60).entries()) {
  const rows = await dbQuery(`
    with m as (select * from jsonb_to_recordset(${jsonSql(batch)}) as x(i text,p bigint,c text,f text,b text)),
    state as (
      select m.*,
             i.id as live_inventory_id, i.store_id, i.legacy_product_id, i.status, i.quantity as inventory_quantity,
             p.id as live_product_id, p.quantity as product_quantity, p.price, p.archived_at, p.ebay_item_id,
             (select count(*) from public.inventory_images img where img.inventory_item_id=i.id and (img.image_url like 'https://storage.googleapis.com/collx-product-images/%' or img.image_url like 'https://storage.googleapis.com/collx-user-cards/%')) as existing_collx_images
      from m
      left join public.inventory_items i on i.id=m.i::uuid
      left join public.products p on p.id=m.p and p.store_id='${STORE_ID}'::uuid
    )
    select i,p,c,
      case
        when live_inventory_id is null then 'inventory_missing'
        when store_id <> '${STORE_ID}'::uuid then 'wrong_store'
        when legacy_product_id is distinct from p then 'legacy_product_changed'
        when status <> 'active' then 'inventory_not_active'
        when coalesce(inventory_quantity,0) <= 0 then 'inventory_quantity_zero'
        when live_product_id is null then 'product_missing'
        when archived_at is not null then 'product_archived'
        when coalesce(product_quantity,0) <= 0 then 'product_quantity_zero'
        when coalesce(price,0) <= 0 then 'product_price_zero'
        when nullif(btrim(coalesce(ebay_item_id,'')),'') is null then 'ebay_link_missing'
        when existing_collx_images <> 0 then 'unexpected_existing_collx_image'
        else null end as reason
    from state
    where live_inventory_id is null or store_id <> '${STORE_ID}'::uuid or legacy_product_id is distinct from p
       or status <> 'active' or coalesce(inventory_quantity,0) <= 0 or live_product_id is null or archived_at is not null
       or coalesce(product_quantity,0) <= 0 or coalesce(price,0) <= 0 or nullif(btrim(coalesce(ebay_item_id,'')),'') is null or existing_collx_images <> 0;
  `, { readOnly: true, label: `guard batch ${index+1}` });
  guardFailures.push(...rows);
}
if (guardFailures.length) fail(`Live guard blocked ${guardFailures.length}: ${JSON.stringify(guardFailures.slice(0,10))}`);
console.log(`Live guard passed for all ${manifest.length} batch-2 targets.`);

for (const [index, batch] of chunks(manifest, 35).entries()) {
  await dbQuery(`
    begin;
    with m as (select * from jsonb_to_recordset(${jsonSql(batch)}) as x(i text,p bigint,c text,f text,b text))
    update public.products p set image_url=m.f from m where p.id=m.p and p.store_id='${STORE_ID}'::uuid;
    with m as (select * from jsonb_to_recordset(${jsonSql(batch)}) as x(i text,p bigint,c text,f text,b text))
    update public.inventory_images img set is_primary=false where img.inventory_item_id in (select i::uuid from m) and img.is_primary=true;
    with m as (select * from jsonb_to_recordset(${jsonSql(batch)}) as x(i text,p bigint,c text,f text,b text)), rows as (
      select i::uuid inventory_item_id,f image_url,'CollX verified front'::text alt_text,-2 sort_order,true is_primary from m
      union all select i::uuid,b,'CollX verified back'::text,-1,false from m where nullif(b,'') is not null
    )
    insert into public.inventory_images (inventory_item_id,image_url,alt_text,sort_order,is_primary)
    select inventory_item_id,image_url,alt_text,sort_order,is_primary from rows;
    commit;
  `, { readOnly: false, label: `apply batch ${index+1}` });
  console.log(`Applied batch ${index+1}/${Math.ceil(manifest.length/35)}.`);
}

const verificationFailures = [];
for (const [index, batch] of chunks(manifest, 60).entries()) {
  const rows = await dbQuery(`
    with m as (select * from jsonb_to_recordset(${jsonSql(batch)}) as x(i text,p bigint,c text,f text,b text)), actual as (
      select m.i,m.p,m.c,m.f,m.b,p.image_url product_front,
        count(*) filter (where img.image_url=m.f) front_rows,
        count(*) filter (where m.b is not null and img.image_url=m.b) back_rows,
        count(*) filter (where img.image_url=m.f and img.is_primary) primary_front_rows
      from m join public.products p on p.id=m.p and p.store_id='${STORE_ID}'::uuid
      join public.inventory_items i on i.id=m.i::uuid and i.legacy_product_id=m.p and i.store_id='${STORE_ID}'::uuid
      left join public.inventory_images img on img.inventory_item_id=i.id
      group by m.i,m.p,m.c,m.f,m.b,p.image_url
    )
    select * from actual where product_front is distinct from f or front_rows<>1 or primary_front_rows<>1 or (b is not null and back_rows<>1) or (b is null and back_rows<>0);
  `, { readOnly: true, label: `verify batch ${index+1}` });
  verificationFailures.push(...rows);
}
if (verificationFailures.length) fail(`Post-write verification failed for ${verificationFailures.length}: ${JSON.stringify(verificationFailures.slice(0,10))}`);

const receipt = {
  ok: true,
  event: 'collx_active_image_import_batch2_completed',
  manifestSha256: digest,
  matchedActiveCards: manifest.length,
  productFrontsUpdated: manifest.length,
  inventoryFrontsInserted: manifest.length,
  inventoryBacksInserted: backCount,
  remoteImagesVerified: uniqueUrls.length,
  priceQuantityStatusTouched: false,
  customerOrderDataTouched: false,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'collx-batch2-import','receipt.json'), JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
