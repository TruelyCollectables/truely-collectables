import base64
import csv
import gzip
import hashlib
import io
import json
import math
import os
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps
import imagehash

EXPECTED_SHA256 = 'cd8ddd1a66ae749bf058a820dfd1570b85a8d29c0c0a8a5e7acf3a88d58fdcd7'
EXPECTED_PRODUCTS = 149
EXPECTED_CANDIDATES = 692
PARTS = [Path(f'.github/ops/collx-visual-candidates.part{i}') for i in range(4)]
OUT = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'collx-visual-match'
OUT.mkdir(parents=True, exist_ok=True)


def fail(message):
    raise RuntimeError(message)


def highres(url):
    import re
    return re.sub(r'/s-l\d+\.(jpg|jpeg|png|webp)(\?.*)?$', r'/s-l1600.\1\2', url, flags=re.I)


def fetch_bytes(url, attempts=4):
    headers = {'User-Agent': 'Mozilla/5.0 TruelyCollectablesImageAudit/1.0'}
    last = None
    for attempt in range(1, attempts + 1):
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=25) as response:
                data = response.read()
                content_type = response.headers.get('Content-Type', '')
                if not data:
                    raise RuntimeError('empty response')
                if 'image/' not in content_type.lower() and len(data) < 1024:
                    raise RuntimeError(f'not image content: {content_type}')
                return data
        except Exception as exc:
            last = exc
            if attempt < attempts:
                time.sleep(min(4, attempt))
    raise RuntimeError(f'fetch failed for {url}: {last}')


def open_image(data):
    image = Image.open(io.BytesIO(data))
    image = ImageOps.exif_transpose(image).convert('RGB')
    return image


def hashes(image):
    # Multiple independent hashes reduce false positives from borders/backgrounds.
    return {
        'phash': imagehash.phash(image, hash_size=16),
        'dhash': imagehash.dhash(image, hash_size=16),
        'whash': imagehash.whash(image, hash_size=16),
        'ahash': imagehash.average_hash(image, hash_size=16),
        'color': imagehash.colorhash(image, binbits=3),
    }


def hash_distance(left, right, key):
    distance = left[key] - right[key]
    bits = left[key].hash.size
    return float(distance), float(distance) / max(1.0, float(bits))


def histogram_signature(image):
    thumb = ImageOps.fit(image, (128, 128), method=Image.Resampling.LANCZOS)
    # 8 bins per RGB channel, normalized.
    hist = thumb.histogram()
    groups = []
    for channel in range(3):
        channel_hist = hist[channel * 256:(channel + 1) * 256]
        bins = [sum(channel_hist[i:i + 32]) for i in range(0, 256, 32)]
        total = max(1, sum(bins))
        groups.extend(v / total for v in bins)
    return groups


def cosine_distance(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if not na or not nb:
        return 1.0
    return 1.0 - dot / (na * nb)


def image_features(data):
    image = open_image(data)
    return {
        'sha256': hashlib.sha256(data).hexdigest(),
        'width': image.width,
        'height': image.height,
        'hashes': hashes(image),
        'hist': histogram_signature(image),
    }


packed = ''.join(part.read_text().strip() for part in PARTS)
raw = gzip.decompress(base64.b64decode(packed))
digest = hashlib.sha256(raw).hexdigest()
if digest != EXPECTED_SHA256:
    fail(f'manifest checksum mismatch: {digest}')
manifest = json.loads(raw)
if len(manifest) != EXPECTED_PRODUCTS:
    fail(f'expected {EXPECTED_PRODUCTS} products, received {len(manifest)}')
if sum(len(row['candidates']) for row in manifest) != EXPECTED_CANDIDATES:
    fail('candidate count mismatch')
print(json.dumps({'manifestSha256': digest, 'products': len(manifest), 'candidatePairs': EXPECTED_CANDIDATES}))

# Cache CollX images because the same candidate can appear in multiple product candidate lists.
cache = {}
errors = []
results = []

for product_index, row in enumerate(manifest, start=1):
    ebay_url = highres(row['ebay'])
    try:
        ebay_data = fetch_bytes(ebay_url)
        ebay = image_features(ebay_data)
    except Exception as exc:
        errors.append({'p': row['p'], 'type': 'ebay_fetch', 'url': ebay_url, 'error': str(exc)[:500]})
        results.append({**row, 'ebay_url': ebay_url, 'error': str(exc), 'ranked': []})
        continue

    ranked = []
    for candidate in row['candidates']:
        url = candidate['f']
        try:
            if url not in cache:
                data = fetch_bytes(url)
                cache[url] = image_features(data)
            collx = cache[url]
            exact = ebay['sha256'] == collx['sha256']
            pd, pn = hash_distance(ebay['hashes'], collx['hashes'], 'phash')
            dd, dn = hash_distance(ebay['hashes'], collx['hashes'], 'dhash')
            wd, wn = hash_distance(ebay['hashes'], collx['hashes'], 'whash')
            ad, an = hash_distance(ebay['hashes'], collx['hashes'], 'ahash')
            cd, cn = hash_distance(ebay['hashes'], collx['hashes'], 'color')
            hd = cosine_distance(ebay['hist'], collx['hist'])
            combined = 0.38 * pn + 0.24 * dn + 0.18 * wn + 0.08 * an + 0.05 * cn + 0.07 * hd
            # Exact byte identity should always sort first.
            if exact:
                combined = -1.0
            ranked.append({
                **candidate,
                'exact_bytes': exact,
                'phash_distance': pd,
                'dhash_distance': dd,
                'whash_distance': wd,
                'ahash_distance': ad,
                'color_distance': cd,
                'histogram_distance': round(hd, 8),
                'visual_distance': round(combined, 8),
                'ebay_size': [ebay['width'], ebay['height']],
                'collx_size': [collx['width'], collx['height']],
            })
        except Exception as exc:
            errors.append({'p': row['p'], 'c': candidate['c'], 'type': 'collx_fetch', 'url': url, 'error': str(exc)[:500]})
            ranked.append({**candidate, 'error': str(exc)[:500], 'visual_distance': 999.0, 'exact_bytes': False})

    ranked.sort(key=lambda item: (item.get('visual_distance', 999.0), -float(item.get('score', 0))))
    for rank, item in enumerate(ranked, start=1):
        item['visual_rank'] = rank
    best = ranked[0] if ranked else None
    second = ranked[1] if len(ranked) > 1 else None
    gap = None
    if best and second and best.get('visual_distance', 999) < 900 and second.get('visual_distance', 999) < 900:
        gap = round(second['visual_distance'] - best['visual_distance'], 8)
    results.append({
        'i': row['i'],
        'p': row['p'],
        'title': row['title'],
        'price': row['price'],
        'ebay_url': ebay_url,
        'candidate_count': len(ranked),
        'best_collx_id': best.get('c') if best else None,
        'best_visual_distance': best.get('visual_distance') if best else None,
        'visual_gap_to_second': gap,
        'best_exact_bytes': bool(best and best.get('exact_bytes')),
        'ranked': ranked,
    })
    if product_index % 20 == 0 or product_index == len(manifest):
        print(f'processed {product_index}/{len(manifest)} products; cached {len(cache)} CollX images')

summary = {
    'ok': True,
    'manifestSha256': digest,
    'products': len(manifest),
    'candidatePairs': EXPECTED_CANDIDATES,
    'uniqueCollxImagesFetched': len(cache),
    'errors': len(errors),
    'exactByteWinners': sum(1 for row in results if row.get('best_exact_bytes')),
    'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
}

(OUT / 'results.json').write_text(json.dumps({'summary': summary, 'errors': errors, 'results': results}, indent=2))
with (OUT / 'ranked.csv').open('w', newline='') as handle:
    writer = csv.writer(handle)
    writer.writerow(['product_id','inventory_id','title','live_price','candidate_count','rank','collx_id','visual_distance','gap_to_second','exact_bytes','metadata_score','price_match','number_match','serial_match','grade_match','year_match','set_coverage','collx_name','collx_year','collx_set','collx_number','collx_flags','collx_condition','collx_asking','ebay_url','collx_front'])
    for row in results:
        for item in row.get('ranked', []):
            writer.writerow([
                row['p'], row['i'], row['title'], row['price'], row['candidate_count'], item.get('visual_rank'), item.get('c'), item.get('visual_distance'),
                row.get('visual_gap_to_second') if item.get('visual_rank') == 1 else '', item.get('exact_bytes'), item.get('score'), item.get('price_match'), item.get('num_match'), item.get('serial_match'), item.get('grade_match'), item.get('year_match'), item.get('cov'), item.get('name'), item.get('year'), item.get('set'), item.get('number'), item.get('flags'), item.get('condition'), item.get('asking'), row['ebay_url'], item.get('f')
            ])
(OUT / 'summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
