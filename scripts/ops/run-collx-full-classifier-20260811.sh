#!/usr/bin/env bash
set -euo pipefail

WORK="${WORK:-/tmp/collx-full-classify}"
VERCEL_SCOPE="${VERCEL_SCOPE:-truelycollectables-projects}"
STORE_ID="${STORE_ID:-00000000-0000-4000-8000-000000000001}"
EXPECTED_ROWS="6909"
EXPECTED_SHA="e5675ad8a23c345bf76aa7f28d73fe5cf8f56452a2bff4595b92a88a6358e904"

mkdir -p "$WORK" .vercel

grep -Ev 'part(10|14|15)$' .github/ops/collx-full-metadata.sha256 | sha256sum -c -
cat \
  .github/ops/collx-full-metadata.part{00..09} \
  .github/ops/collx-full-metadata.part10m0 \
  .github/ops/collx-full-metadata.part10m1 \
  .github/ops/collx-full-metadata.part11 \
  .github/ops/collx-full-metadata.part12 \
  .github/ops/collx-full-metadata.part13 \
  .github/ops/collx-full-metadata.part14m \
  .github/ops/collx-full-metadata.part15m > "$WORK/source.xz.b64"
base64 -d "$WORK/source.xz.b64" | xz -d > "$WORK/source.csv"
test "$(sha256sum "$WORK/source.csv" | awk '{print $1}')" = "$EXPECTED_SHA"
test "$(($(wc -l < "$WORK/source.csv")-1))" = "$EXPECTED_ROWS"
cat .github/ops/collx-full-classify.py.part{00..01} > "$WORK/classify.py"

npx --yes vercel@56.2.0 link --yes --project truely-collectables --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN" >/dev/null
npx --yes vercel@56.2.0 env pull "$WORK/production.env" --yes --environment production --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN" >/dev/null

python3 - <<'PY'
from pathlib import Path
import os
p=Path(os.environ.get('WORK','/tmp/collx-full-classify'))/'classify.py'
s=p.read_text()
start=s.index("env=envparse((W/'production.env').read_text())")
end=s.index('def fnum',start)
rest='''env=envparse((W/'production.env').read_text())
base=env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
service=env['SUPABASE_SERVICE_ROLE_KEY']
def rest_headers(start,end):
 h={'apikey':service,'Accept':'application/json','Range-Unit':'items','Range':f'{start}-{end}','User-Agent':'Mozilla/5.0 (TruelyCollectables migration classifier)'}
 if not service.startswith('sb_secret_'): h['Authorization']=f'Bearer {service}'
 return h
def rest_all(table,params,page_size=1000):
 out=[]; start=0; last=''
 while True:
  q=urllib.parse.urlencode(params,safe='(),.*')
  u=f"{base}/rest/v1/{table}?{q}"
  body=None
  for attempt in range(1,8):
   req=urllib.request.Request(u,headers=rest_headers(start,start+page_size-1))
   try:
    with urllib.request.urlopen(req,timeout=90) as r: body=json.loads(r.read() or b'[]'); break
   except Exception as e:
    code=getattr(e,'code',None); last=f'{type(e).__name__}:{code}:{e}'
    if code not in (408,409,425,429,500,502,503,504,520,522,524,544) and attempt>=2: raise
    if attempt<7: time.sleep(min(8.0,attempt*.7))
  if body is None: raise RuntimeError(f'PostgREST {table} failed: {last}')
  if not isinstance(body,list): raise RuntimeError(f'PostgREST {table} returned non-list')
  out.extend(body)
  if len(body)<page_size: return out
  start+=page_size
'''
s=s[:start]+rest+s[end:]
a=s.index('ebay=db('); b=s.index("print(json.dumps({'sourceRows'",a)
efficient='''ebay=rest_all('products',{'select':'id,title,description,price,quantity,image_url,sport,player,sku,ebay_item_id','store_id':f'eq.{STORE}','archived_at':'is.null','ebay_item_id':'not.is.null','order':'id.asc'})
items=rest_all('inventory_items',{'select':'id,legacy_product_id','store_id':f'eq.{STORE}','legacy_product_id':'not.is.null','order':'created_at.asc'})
ebay_ids={int(p['id']) for p in ebay}
item_to_product={str(i['id']):int(i['legacy_product_id']) for i in items if i.get('legacy_product_id') is not None and int(i['legacy_product_id']) in ebay_ids}
imap=defaultdict(list)
item_ids=list(item_to_product)
for z in range(0,len(item_ids),150):
 ids=item_ids[z:z+150]
 if not ids: continue
 filt='in.('+','.join(ids)+')'
 for r in rest_all('inventory_images',{'select':'inventory_item_id,image_url','inventory_item_id':filt,'order':'sort_order.asc'}):
  pid=item_to_product.get(str(r.get('inventory_item_id')))
  if pid is not None and r.get('image_url'): imap[pid].append(r['image_url'])
for p0 in ebay:p0['inventory_images']=imap.get(int(p0['id']),[])
existing_rows=rest_all('products',{'select':'sku','store_id':f'eq.{STORE}','sku':'like.COLLX-*'})
existing={str(x['sku'])[6:] for x in existing_rows if str(x.get('sku') or '').startswith('COLLX-')}
'''
s=s[:a]+efficient+s[b:]
p.write_text(s)
PY

python3 -m pip install --quiet Pillow ImageHash
python3 "$WORK/classify.py"

test -s "$WORK/classification.json"
test -s "$WORK/receipt.json"
