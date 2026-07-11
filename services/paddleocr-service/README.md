# TCOS InstaComp PaddleOCR service

This is the local OCR worker TCOS can call with `PADDLEOCR_API_URL`.

PaddleOCR is a Python ML stack, so it stays outside the Next app. The durable InstaComp queue normally sends the stored card front/back through the Next server; the worker creates additional serial-focused views internally. The service returns raw OCR text plus any serial number it finds.

OCR output is scan evidence, not a guarantee. Never invent a missing serial fraction or activate a listing without comparing the result with both original card images.

## Run locally

Use Python 3.10-3.12.

```powershell
cd C:\Projects\truely-collectables\services\paddleocr-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
$env:PADDLEOCR_API_KEY="local-dev-token"
uvicorn app:app --host 127.0.0.1 --port 8008
```

Then add these to the Next app environment and restart Next:

```powershell
$env:PADDLEOCR_API_URL="http://127.0.0.1:8008/ocr"
$env:PADDLEOCR_API_KEY="local-dev-token"
```

For `.env.local`:

```env
PADDLEOCR_API_URL=http://127.0.0.1:8008/ocr
PADDLEOCR_API_KEY=local-dev-token
PADDLEOCR_TIMEOUT_MS=120000
```

The application bounds the timeout from 1 through 180 seconds. The first real request lazily loads the model and is a better readiness test than `/health`.

## Optional tuning

```env
PADDLEOCR_LANG=en
PADDLEOCR_VERSION=PP-OCRv6
PADDLEOCR_DEVICE=cpu
PADDLEOCR_CPU_THREADS=8
PADDLEOCR_ENABLE_MKLDNN=false
PADDLEOCR_TEXT_DET_LIMIT_SIDE_LEN=2200
PADDLEOCR_TEXT_DET_LIMIT_TYPE=min
PADDLEOCR_MAX_CONCURRENCY=1
PADDLEOCR_MAX_PREDICTION_IMAGES=14
PADDLEOCR_MAX_DECODED_PIXELS=40000000
```

If you have a supported GPU setup, use the PaddlePaddle GPU package that matches your CUDA stack and set `PADDLEOCR_DEVICE=gpu:0`.

Capacity bounds:

- `PADDLEOCR_MAX_CONCURRENCY`: default `1`, allowed `1` through `4`;
- `PADDLEOCR_MAX_PREDICTION_IMAGES`: default `14`, allowed `2` through `24`;
- `PADDLEOCR_MAX_DECODED_PIXELS`: default `40,000,000`, allowed `1,000,000` through `100,000,000` per decoded image.

The OCR semaphore limits concurrent predictions, and a separate initialization lock prevents duplicate model loads during simultaneous first requests. The default concurrency of one favors Windows CPU stability. Increase it only after measuring CPU, memory, latency, and repeated inference reliability.

## Internal serial crops

When `/ocr` receives one or two original images, the worker generates up to five targeted views per original: top-right, top-left, middle-right, bottom-right, and bottom-left. Each view is enlarged, converted to grayscale, and auto-contrasted. The worker processes originals plus generated views only until `PADDLEOCR_MAX_PREDICTION_IMAGES` is reached.

If a request already contains more than two browser-generated images, the worker does not add another crop set. It processes the submitted images up to the same prediction cap.

## Input boundaries

The authenticated Next scan route accepts JPEG, PNG, and WebP and enforces:

- `12 MB` per full source image;
- `512 KB` per detail crop;
- `20 MB` aggregate scan input.

The worker separately verifies that every decoded payload is a readable image and applies the decoded-pixel ceiling. It does not duplicate the Next route's complete encoded-byte budget. Keep Uvicorn bound to `127.0.0.1`; do not expose `/ocr` as an unrestricted public upload endpoint.

The browser multipart fallback targets roughly `900 KB` per optimized full image, `180 KB` per crop, and less than `3.75 MB` total. Durable queue jobs upload front/back derivatives bounded to `3600` pixels and `3 MB` each to the private `instacomp-job-images` Supabase bucket. The server verifies their registered size and SHA-256 digest before OCR.

## Durable queue prerequisite

Apply this migration to the Supabase project before testing a persistent lot:

```text
supabase/migrations/20260711010000_create_instacomp_scan_job_queue.sql
```

The saved queue can recover uploaded images, item status, results, and retry state after a reload. The browser currently claims and processes queue work, so scans pause when every InstaComp tab is closed and resume only after the scanner is reopened.

## Endpoints

- `GET /health`
- `POST /ocr`

The `/ocr` request/response shape is documented in [docs/INSTACOMP_PADDLEOCR_SERVICE.md](../../docs/INSTACOMP_PADDLEOCR_SERVICE.md).

## Verify

With the virtual environment installed and the worker running:

```powershell
cd C:\Projects\truely-collectables
services\paddleocr-service\.venv\Scripts\python.exe -m py_compile services\paddleocr-service\app.py
Invoke-RestMethod http://127.0.0.1:8008/health
npm run simulate:instacomp-jobs
```

`/health` does not load PaddleOCR. Finish verification with one real front/back queue scan and confirm `provider`, `checkedImages`, OCR text, and any visible serial against the source images.

## Troubleshoot

- `401 Invalid OCR service token`: make `PADDLEOCR_API_KEY` identical in Next and the worker environment.
- Health succeeds but inference fails: inspect `%TEMP%\tcos-paddleocr.stderr.log` for model/cache/runtime failures.
- Requests appear serialized: default concurrency is one; queued requests wait for the semaphore.
- Decoded-pixel `413`: resize the source rather than raising the limit without a memory test.
- `400 ... is not a readable image`: the payload is corrupt, truncated, or not an actual supported image.
- No serial: verify both originals reached the worker, confirm `checkedImages` includes generated views, reshoot without glare, and leave the serial blank when it cannot be proven.
- `INSTACOMP_JOB_MIGRATION_REQUIRED`: apply the queue migration above; the Paddle process itself cannot create the Supabase schema.
