import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { COLLX_EXISTING_DIRECT_MATCHES } from '../src/lib/collx-existing-direct-map-20260811.ts';

const STORE = process.env.FLAGSHIP_STORE_ID;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_DIR = process.env.OUTPUT_DIR || process.cwd();
if (!STORE || !URL || !KEY) throw new Error('Missing production Supabase configuration');

const supabase = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const OWNED_BUCKET = 'truely-product-images';
const ROOT = 'collx-full/20260811';
const SOURCE = {
  '1116438440473465856': {
    front: '1116438440473465856-1-d9Ns.jpg',
    back: '1116438440473465856-2-Plni.jpg',
  },
  '1111931097530454016': {
    front: '1111931097530454016-1-xFMM.jpg',
    back: '1111931097530454016-2-rCr1.jpg',
  },
};
const direct = new Map(COLLX_EXISTING_DIRECT_MATCHES.map(([collxId, productId]) => [String(collxId), Number(productId)]));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (v) => String(v || '').trim();
const sourceUrl = (name) => `https://storage.googleapis.com/collx-product-images/${encodeURIComponent(name)}`;
const ownedPath = (id) => `${ROOT}/${id}/back.jpg`;
const ownedUrl = (id) => supabase.storage.from(OWNED_BUCKET).getPublicUrl(ownedPath(id)).data.publicUrl;

async function retry(label, fn, attempts = 8) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const value = await fn();
      return value;
    } catch (error) {
      last = error;
      const text = error instanceof Error ? error.message : JSON.stringify(error);
      console.log(`${label}_RETRY=${JSON.stringify({ attempt: i, error: text })}`);
      if (i < attempts) await sleep(Math.min(15000, 1000 * i * i));
    }
  }
  throw last;
}

async function query(label, builder) {
  return retry(label, async () => {
    const { data, error } = await builder();
    if (error) throw new Error(`${error.code || 'SUPABASE'} ${error.message || JSON.stringify(error)}`);
    return data || [];
  });
}

function idFromImageUrl(url) {
  const s = clean(url);
  let m = /\/collx-full\/20260811\/(\d+)\/front\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.exec(s);
  if (m) return m[1];
  m = /\/collx-product-images\/(\d+)-1-[^/]+\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.exec(s);
  return m?.[1] || null;
}

function exactOwnedBackId(url) {
  const m = /\/collx-full\/20260811\/(\d+)\/back\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.exec(clean(url));
  return m?.[1] || null;
}

function explicitBack(url) {
  const s = clean(url);
  return /\/collx-full\/20260811\/\d+\/back\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(s)
    || /\/collx-product-images\/\d+-2-[^/]+\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(s)
    || /(?:^|[-_/])back(?=\.[a-z0-9]+(?:[?#].*)?$)/i.test(s);
}

async function fetchBytes(url, label) {
  return retry(label, async () => {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = clean(response.headers.get('content-type')).toLowerCase();
    if (type && !type.startsWith('image/')) throw new Error(`Not image content: ${type}`);
    return Buffer.from(await response.arrayBuffer());
  }, 5);
}

async function hashUrl(url, label) {
  const bytes = await fetchBytes(url, label);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function identifyDisplayedFront(product, rows) {
  const urls = [product.image_url, ...rows.filter((r) => r.is_primary).map((r) => r.image_url), ...rows.map((r) => r.image_url)].filter(Boolean);
  for (const url of urls) {
    const id = idFromImageUrl(url);
    if (id && SOURCE[id]) return { id, method: 'url-lineage', url };
  }

  const displayed = clean(product.image_url) || clean(rows.find((r) => r.is_primary)?.image_url) || clean(rows[0]?.image_url);
  if (!displayed) throw new Error(`Product ${product.id} has no displayed image to identify`);
  const displayedHash = await hashUrl(displayed, `DISPLAYED_FRONT_${product.id}`);
  const matches = [];
  for (const [id, source] of Object.entries(SOURCE)) {
    const h = await hashUrl(sourceUrl(source.front), `SOURCE_FRONT_${id}`);
    if (h === displayedHash) matches.push(id);
  }
  if (matches.length !== 1) throw new Error(`Product ${product.id} displayed front could not be uniquely matched; matches=${matches.join(',') || 'none'}`);
  return { id: matches[0], method: 'sha256-exact', url: displayed };
}

async function candidateProducts() {
  const byId = new Map();
  for (const id of Object.keys(SOURCE)) {
    const skuRows = await query(`PRODUCT_SKU_${id}`, () => supabase.from('products')
      .select('id,sku,title,image_url,quantity,price,status,ebay_item_id')
      .eq('store_id', STORE)
      .eq('sku', `COLLX-${id}`)
      .limit(20));
    for (const row of skuRows) byId.set(Number(row.id), row);

    const mapped = direct.get(id);
    if (mapped) {
      const mappedRows = await query(`PRODUCT_ID_${mapped}`, () => supabase.from('products')
        .select('id,sku,title,image_url,quantity,price,status,ebay_item_id')
        .eq('store_id', STORE)
        .eq('id', mapped)
        .limit(1));
      for (const row of mappedRows) byId.set(Number(row.id), row);
    }
  }
  return [...byId.values()];
}

async function loadItem(product) {
  const rows = await query(`ITEM_${product.id}`, () => supabase.from('inventory_items')
    .select('id,sku,legacy_product_id,title,created_at,status')
    .eq('store_id', STORE)
    .eq('legacy_product_id', product.id)
    .order('created_at', { ascending: true })
    .limit(20));
  if (!rows.length) throw new Error(`No inventory_item for product ${product.id}`);
  const exactSku = rows.find((row) => clean(row.sku) === clean(product.sku));
  if (exactSku) return exactSku;
  if (rows.length === 1) return rows[0];
  throw new Error(`Product ${product.id} has ${rows.length} inventory_items and no exact SKU match`);
}

async function loadImages(itemId) {
  return query(`IMAGES_${itemId}`, () => supabase.from('inventory_images')
    .select('id,inventory_item_id,image_url,alt_text,sort_order,is_primary')
    .eq('inventory_item_id', itemId)
    .order('sort_order', { ascending: true })
    .limit(50));
}

async function ensureBack(product, item, rows, frontId) {
  const existingExact = rows.find((row) => exactOwnedBackId(row.image_url) === frontId);
  if (existingExact) return { action: 'already-exact', backUrl: existingExact.image_url };

  const source = SOURCE[frontId];
  if (!source) throw new Error(`No source pair configured for ${frontId}`);
  const bytes = await fetchBytes(sourceUrl(source.back), `SOURCE_BACK_${frontId}`);
  const { error: uploadError } = await retry(`UPLOAD_BACK_${frontId}`, () => supabase.storage.from(OWNED_BUCKET)
    .upload(ownedPath(frontId), bytes, { contentType: 'image/jpeg', upsert: true }));
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message || JSON.stringify(uploadError)}`);
  const backUrl = ownedUrl(frontId);

  const foreignBack = rows.find((row) => explicitBack(row.image_url));
  if (foreignBack) {
    const foreignId = exactOwnedBackId(foreignBack.image_url);
    if (foreignId && foreignId !== frontId) {
      throw new Error(`Refusing to replace a different exact back (${foreignId}) on product ${product.id}`);
    }
    await retry(`UPDATE_BACK_${product.id}`, async () => {
      const { error } = await supabase.from('inventory_images').update({
        image_url: backUrl,
        alt_text: `${clean(product.title) || clean(item.title) || product.sku} back`,
        is_primary: false,
      }).eq('id', foreignBack.id).eq('inventory_item_id', item.id);
      if (error) throw new Error(`${error.code || 'SUPABASE'} ${error.message}`);
    });
    return { action: 'updated-back-row', backUrl };
  }

  const nextSort = Math.max(0, ...rows.map((row) => Number(row.sort_order ?? 0))) + 1;
  await retry(`INSERT_BACK_${product.id}`, async () => {
    const { error } = await supabase.from('inventory_images').insert({
      inventory_item_id: item.id,
      image_url: backUrl,
      alt_text: `${clean(product.title) || clean(item.title) || product.sku} back`,
      sort_order: nextSort,
      is_primary: false,
    });
    if (error) throw new Error(`${error.code || 'SUPABASE'} ${error.message}`);
  });
  return { action: 'inserted-back-row', backUrl };
}

async function verifyLive(productId) {
  let last = { status: null, backUnavailable: null, hasOwnedBackPath: null, error: null };
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const response = await fetch(`https://truelycollectables.com/product/${productId}?back_repair=${Date.now()}-${attempt}`, {
        redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'TruelyBackVerifier/20260812', 'Cache-Control': 'no-cache' },
      });
      const html = await response.text();
      last = {
        status: response.status,
        backUnavailable: /BACK PHOTO UNAVAILABLE|Back photo unavailable/i.test(html),
        hasOwnedBackPath: /collx-full(?:%2F|\/)20260811(?:%2F|\/)\d+(?:%2F|\/)back\./i.test(html),
        error: null,
      };
      if (response.status === 200 && !last.backUnavailable) return last;
    } catch (error) {
      last = { ...last, error: error instanceof Error ? error.message : String(error) };
    }
    await sleep(Math.min(15000, attempt * 2000));
  }
  return last;
}

const products = await candidateProducts();
if (!products.length) throw new Error('No production product found for either Allisha Gray Green Ice source ID');

const receipts = [];
for (const product of products) {
  const item = await loadItem(product);
  const beforeRows = await loadImages(item.id);
  let front;
  try {
    front = await identifyDisplayedFront(product, beforeRows);
  } catch (error) {
    receipts.push({ productId: product.id, sku: product.sku, title: product.title, quantity: product.quantity, price: product.price, skipped: true, reason: error instanceof Error ? error.message : String(error) });
    continue;
  }
  if (!SOURCE[front.id]) continue;

  const repair = await ensureBack(product, item, beforeRows, front.id);
  const afterRows = await loadImages(item.id);
  const exact = afterRows.find((row) => exactOwnedBackId(row.image_url) === front.id) || null;
  const live = await verifyLive(product.id);
  const receipt = {
    productId: product.id,
    sku: product.sku,
    title: product.title,
    quantity: product.quantity,
    price: product.price,
    status: product.status,
    displayedFrontCollxId: front.id,
    frontMatchMethod: front.method,
    repairAction: repair.action,
    exactBackAssociated: Boolean(exact),
    exactBackUrl: exact?.image_url || null,
    live,
  };
  receipts.push(receipt);
  console.log('ALLISHA_EXACT_VERIFY=' + JSON.stringify(receipt));
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, 'allisha-exact-verify.json'), JSON.stringify(receipts, null, 2));

const verified = receipts.filter((row) => row.exactBackAssociated && row.live?.status === 200 && row.live?.backUnavailable === false);
if (!verified.length) throw new Error(`Allisha exact back verification failed: ${JSON.stringify(receipts)}`);
console.log('ALLISHA_BACK_VERIFIED=' + JSON.stringify({ verified: verified.length, products: verified.map((x) => x.productId) }));
