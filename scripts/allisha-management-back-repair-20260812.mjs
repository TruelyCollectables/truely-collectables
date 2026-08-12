import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ACCESS = process.env.SUPABASE_ACCESS_TOKEN;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const STORE = process.env.FLAGSHIP_STORE_ID;
const OUTPUT_DIR = process.env.OUTPUT_DIR || process.cwd();
if (!ACCESS || !SERVICE || !PROJECT_REF || !SUPABASE_URL || !STORE) throw new Error('Missing exact repair credentials');

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
const EXPECTED_TITLE = '2025 Panini Select WNBA - Green Ice Prizms Allisha Gray #78';
const ROOT = 'collx-full/20260811';
const BUCKET = 'truely-product-images';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (v) => String(v ?? '').trim();

async function retry(label, fn, attempts = 6) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await fn(); }
    catch (error) {
      last = error;
      console.log(`${label}_RETRY=${JSON.stringify({ attempt, error: error instanceof Error ? error.message : String(error) })}`);
      if (attempt < attempts) await sleep(Math.min(10000, attempt * 1500));
    }
  }
  throw last;
}

async function sql(query, readOnly = true) {
  return retry('MGMT_SQL', async () => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
      signal: AbortSignal.timeout(45000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0,1000)}`);
    const parsed = text ? JSON.parse(text) : [];
    return Array.isArray(parsed) ? parsed : (parsed?.result || parsed?.data || []);
  });
}

function sqlQuote(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function frontIdFromUrl(url) {
  const s = clean(url);
  let m = /\/collx-full\/20260811\/(\d+)\/front\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.exec(s);
  if (m) return m[1];
  m = /\/collx-product-images\/(\d+)-1-[^/]+\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.exec(s);
  return m?.[1] || null;
}
function backIdFromUrl(url) {
  const s = clean(url);
  let m = /\/collx-full\/20260811\/(\d+)\/back\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.exec(s);
  if (m) return m[1];
  m = /\/collx-product-images\/(\d+)-2-[^/]+\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.exec(s);
  return m?.[1] || null;
}
function explicitBack(url) {
  return Boolean(backIdFromUrl(url)) || /(?:^|[-_/])back(?=\.[a-z0-9]+(?:[?#].*)?$)/i.test(clean(url));
}
function sourceUrl(name) { return `https://storage.googleapis.com/collx-product-images/${encodeURIComponent(name)}`; }
function objectPath(id) { return `${ROOT}/${id}/back.jpg`; }
function publicUrl(id) { return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath(id)}`; }

async function bytes(url, label) {
  return retry(label, async () => {
    const r = await fetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const b = Buffer.from(await r.arrayBuffer());
    if (!b.length) throw new Error('empty image');
    return b;
  }, 4);
}
async function sha(url, label) { return crypto.createHash('sha256').update(await bytes(url,label)).digest('hex'); }

async function identifyFront(product, images) {
  const urls = [product.image_url, ...images.filter((x)=>x.is_primary).map((x)=>x.image_url), ...images.map((x)=>x.image_url)].filter(Boolean);
  for (const url of urls) {
    const id = frontIdFromUrl(url);
    if (id && SOURCE[id]) return { id, method: 'url-lineage', url };
  }
  const displayed = clean(product.image_url) || clean(images.find((x)=>x.is_primary)?.image_url) || clean(images[0]?.image_url);
  if (!displayed) throw new Error(`Product ${product.id} has no displayed image`);
  const displayedSha = await sha(displayed, `DISPLAYED_${product.id}`);
  const matches=[];
  for (const [id, pair] of Object.entries(SOURCE)) {
    if (await sha(sourceUrl(pair.front), `SOURCE_FRONT_${id}`) === displayedSha) matches.push(id);
  }
  if (matches.length !== 1) throw new Error(`Displayed front not uniquely matched; matches=${matches.join(',')||'none'}`);
  return { id: matches[0], method: 'sha256-exact', url: displayed };
}

async function uploadBack(id) {
  const image = await bytes(sourceUrl(SOURCE[id].back), `SOURCE_BACK_${id}`);
  await retry(`STORAGE_UPLOAD_${id}`, async () => {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath(id)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
      body: image,
      signal: AbortSignal.timeout(30000),
    });
    const text=await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,500)}`);
  });
  return publicUrl(id);
}

const products = await sql(`
  set statement_timeout = '30s';
  select id, sku, title, image_url, quantity, price, status, ebay_item_id
  from products
  where store_id = ${sqlQuote(STORE)}::uuid
    and (
      sku in (${Object.keys(SOURCE).map((id)=>sqlQuote(`COLLX-${id}`)).join(',')})
      or title = ${sqlQuote(EXPECTED_TITLE)}
    )
  order by id;
`, true);
console.log('TARGET_PRODUCTS='+JSON.stringify(products));
if (!products.length) throw new Error('No Allisha Green Ice product found in Production');

const receipts=[];
for (const product of products) {
  const items = await sql(`
    set statement_timeout = '30s';
    select id, sku, legacy_product_id, title, created_at, status
    from inventory_items
    where store_id = ${sqlQuote(STORE)}::uuid and legacy_product_id = ${Number(product.id)}
    order by created_at asc, id asc;
  `, true);
  if (!items.length) { receipts.push({productId:product.id,error:'no inventory_item'}); continue; }
  let item = items.find((x)=>clean(x.sku)===clean(product.sku));
  if (!item && items.length===1) item=items[0];
  if (!item) { receipts.push({productId:product.id,error:`ambiguous inventory_items:${items.length}`}); continue; }

  const images = await sql(`
    set statement_timeout = '30s';
    select id, inventory_item_id, image_url, alt_text, sort_order, is_primary
    from inventory_images
    where inventory_item_id = ${sqlQuote(item.id)}::uuid
    order by sort_order asc nulls last, id asc;
  `, true);
  let front;
  try { front = await identifyFront(product, images); }
  catch (error) { receipts.push({productId:product.id,sku:product.sku,title:product.title,error:error instanceof Error?error.message:String(error)}); continue; }

  const exact = images.find((x)=>backIdFromUrl(x.image_url)===front.id);
  let action='already-exact'; let backUrl=exact?.image_url || null;
  if (!exact) {
    backUrl = await uploadBack(front.id);
    const oldBack = images.find((x)=>explicitBack(x.image_url));
    if (oldBack) {
      const oldId=backIdFromUrl(oldBack.image_url);
      if (oldId && oldId!==front.id) throw new Error(`Refusing to replace exact back ${oldId} for front ${front.id}`);
      await sql(`
        set statement_timeout = '30s';
        update inventory_images
        set image_url = ${sqlQuote(backUrl)}, alt_text = ${sqlQuote(`${clean(product.title)||clean(item.title)||product.sku} back`)}, is_primary = false
        where id = ${sqlQuote(oldBack.id)}::uuid and inventory_item_id = ${sqlQuote(item.id)}::uuid
        returning id, image_url;
      `, false);
      action='updated-back-row';
    } else {
      const maxSort = images.reduce((m,x)=>Math.max(m,Number(x.sort_order??0)),0);
      await sql(`
        set statement_timeout = '30s';
        insert into inventory_images (inventory_item_id,image_url,alt_text,sort_order,is_primary)
        values (${sqlQuote(item.id)}::uuid, ${sqlQuote(backUrl)}, ${sqlQuote(`${clean(product.title)||clean(item.title)||product.sku} back`)}, ${maxSort+1}, false)
        returning id, image_url;
      `, false);
      action='inserted-back-row';
    }
  }

  const after = await sql(`
    set statement_timeout = '30s';
    select id, image_url, sort_order, is_primary
    from inventory_images
    where inventory_item_id = ${sqlQuote(item.id)}::uuid
    order by sort_order asc nulls last, id asc;
  `, true);
  const exactAfter=after.find((x)=>backIdFromUrl(x.image_url)===front.id);

  let live={status:null,backUnavailable:null,hasBackUrl:null,error:null};
  for (let attempt=1; attempt<=8; attempt++) {
    try {
      const r=await fetch(`https://truelycollectables.com/product/${product.id}?back_verify=${Date.now()}-${attempt}`,{cache:'no-store',redirect:'follow',headers:{'Cache-Control':'no-cache','User-Agent':'TruelyBackVerifier/20260812'},signal:AbortSignal.timeout(30000)});
      const html=await r.text();
      live={status:r.status,backUnavailable:/BACK PHOTO UNAVAILABLE|Back photo unavailable/i.test(html),hasBackUrl:html.includes(encodeURI(backUrl||''))||html.includes(backUrl||''),error:null};
      if (r.status===200 && live.backUnavailable===false) break;
    } catch(error) { live.error=error instanceof Error?error.message:String(error); }
    await sleep(Math.min(10000,attempt*1500));
  }

  const receipt={productId:product.id,sku:product.sku,title:product.title,quantity:product.quantity,price:product.price,status:product.status,frontId:front.id,frontMethod:front.method,action,exactBackAssociated:Boolean(exactAfter),exactBackUrl:exactAfter?.image_url||null,live};
  receipts.push(receipt);
  console.log('ALLISHA_MANAGEMENT_VERIFY='+JSON.stringify(receipt));
}

fs.mkdirSync(OUTPUT_DIR,{recursive:true});
fs.writeFileSync(path.join(OUTPUT_DIR,'allisha-management-verify.json'),JSON.stringify(receipts,null,2));
const verified=receipts.filter((x)=>x.exactBackAssociated && x.live?.status===200 && x.live?.backUnavailable===false);
if (!verified.length) throw new Error(`No Allisha Green Ice product passed exact Production DB + live-page verification: ${JSON.stringify(receipts)}`);
console.log('ALLISHA_MANAGEMENT_BACK_VERIFIED='+JSON.stringify({count:verified.length,productIds:verified.map((x)=>x.productId),frontIds:verified.map((x)=>x.frontId)}));
