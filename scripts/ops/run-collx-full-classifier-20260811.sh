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

python3 - <<'PY'
from pathlib import Path
import os
p=Path(os.environ.get('WORK','/tmp/collx-full-classify'))/'classify.py'
s=p.read_text()
a=s.index('def db(q):'); b=s.index('def fnum',a)
hardened='''def db(q):
 body=json.dumps({'query':q,'parameters':[],'read_only':True}).encode(); last=''
 for attempt in range(1,13):
  req=urllib.request.Request(ep,data=body,method='POST',headers={'Authorization':f'Bearer {mgmt}','Content-Type':'application/json','User-Agent':'Mozilla/5.0 (TruelyCollectables GitHub Actions)'})
  try:
   with urllib.request.urlopen(req,timeout=90) as r:return json.loads(r.read() or b'[]')
  except Exception as e:
   code=getattr(e,'code',None); last=f'{type(e).__name__}:{code}:{e}'
   if code not in (403,408,409,425,429,500,502,503,504,520,522,524,544) and attempt>=2: raise
   if attempt<12: time.sleep(min(10.0,attempt*.8))
 raise RuntimeError('Production DB query failed after retries: '+last)
'''
s=s[:a]+hardened+s[b:]
a=s.index('ebay=db('); b=s.index("print(json.dumps({'sourceRows'",a)
efficient='''ebay=db(f"""select p.id,p.title,p.description,p.price,p.quantity,p.image_url,p.sport,p.player,p.sku,p.ebay_item_id from public.products p where p.store_id='{STORE}'::uuid and p.archived_at is null and nullif(btrim(coalesce(p.ebay_item_id,'')),'') is not null order by p.id""")
imgrows=db(f"""select i.legacy_product_id product_id,jsonb_agg(z.image_url) inventory_images from public.inventory_items i join public.products p on p.id=i.legacy_product_id join public.inventory_images z on z.inventory_item_id=i.id where p.store_id='{STORE}'::uuid and p.archived_at is null and nullif(btrim(coalesce(p.ebay_item_id,'')),'') is not null group by i.legacy_product_id""")
imap={int(x['product_id']):x.get('inventory_images') or [] for x in imgrows}
for p0 in ebay:p0['inventory_images']=imap.get(int(p0['id']),[])
existing={str(x['sku'])[6:] for x in db(f"select sku from public.products where store_id='{STORE}'::uuid and sku like 'COLLX-%'") if str(x.get('sku') or '').startswith('COLLX-')}
'''
p.write_text(s[:a]+efficient+s[b:])
PY

npx --yes vercel@56.2.0 link --yes --project truely-collectables --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN" >/dev/null
npx --yes vercel@56.2.0 env pull "$WORK/production.env" --yes --environment production --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN" >/dev/null
python3 -m pip install --quiet Pillow ImageHash
python3 "$WORK/classify.py"

test -s "$WORK/classification.json"
test -s "$WORK/receipt.json"
