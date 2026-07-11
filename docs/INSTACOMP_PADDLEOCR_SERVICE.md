# InstaComp PaddleOCR service contract

InstaComp can use PaddleOCR as its first real OCR provider for tiny serial-number stamps, card numbers, player names, set text, and back-of-card details.

The Next app does not run PaddleOCR directly. PaddleOCR runs as a separate HTTP service so the web app remains deployable and the CPU-heavy model can be restarted independently.

A local service scaffold lives in `services/paddleocr-service`.

## Environment variables

Add these to the app environment and restart the server:

```bash
PADDLEOCR_API_URL=http://localhost:8008/ocr
PADDLEOCR_API_KEY=optional-shared-secret
PADDLEOCR_TIMEOUT_MS=120000
```

On Windows CPU installs, leave `PADDLEOCR_ENABLE_MKLDNN=false` (the service
does this automatically) to avoid PaddlePaddle's unsupported oneDNN/PIR path.

`PADDLEOCR_API_URL` enables PaddleOCR. `PADDLEOCR_API_KEY` is optional; when set, TCOS sends it as a bearer token. Google Vision can stay configured as a fallback with `GOOGLE_VISION_API_KEY` or `GOOGLE_CLOUD_VISION_API_KEY`.

The Next route defaults to a 12-second Paddle timeout, bounds the value from 1 through 180 seconds, and uses 120 seconds in the current local CPU configuration. A first inference may be slower because model loading is lazy.

Worker capacity and safety settings:

```env
PADDLEOCR_MAX_CONCURRENCY=1
PADDLEOCR_MAX_PREDICTION_IMAGES=14
PADDLEOCR_MAX_DECODED_PIXELS=40000000
```

- concurrency defaults to `1` and is bounded from `1` through `4`;
- prediction images default to `14` and are bounded from `2` through `24`;
- decoded pixels per image default to `40,000,000` and are bounded from `1,000,000` through `100,000,000`;
- model initialization is locked, so simultaneous first requests do not create multiple model instances.

Keep the worker bound to `127.0.0.1` unless it is placed behind authentication, TLS, and equivalent request-size controls. The Next scan route provides the byte limits described below; the worker's decoded-pixel check is not a replacement for that upstream byte boundary.

## Durable queue behavior

After `supabase/migrations/20260711010000_create_instacomp_scan_job_queue.sql` is applied, a persistent InstaComp job creates high-resolution front/back derivatives and uploads them directly to private Supabase Storage. The browser claims a saved row, then the Next server downloads those saved derivatives and calls PaddleOCR. Image bytes do not have to be resent from the browser for every retry.

The queue can resume saved work after a reload, but the browser currently acts as the worker. OCR calls do not continue while all InstaComp tabs are closed. Queue uploads require SHA-256 digests, use non-overwriting signed targets, and are revalidated before OCR and again before draft promotion.

## Request

TCOS sends a `POST` request with JSON:

```json
{
  "images": [
    {
      "name": "front-full-card",
      "dataUrl": "data:image/jpeg;base64,..."
    }
  ],
  "hints": {
    "task": "sports_card_ocr",
    "priority": [
      "serial_number",
      "card_number",
      "player",
      "team",
      "set",
      "parallel",
      "autograph",
      "relic"
    ]
  }
}
```

Headers:

```text
Content-Type: application/json
Authorization: Bearer <PADDLEOCR_API_KEY> // only when configured
```

The multipart fallback may provide fronts, backs, serial crops, top bands, edge crops, contrast crops, and full-card fallbacks. The worker processes only the first `PADDLEOCR_MAX_PREDICTION_IMAGES` entries.

The durable queue normally supplies one or two originals. When the request contains no more than two images, the worker generates up to five serial-focused views from each original:

- top-right;
- top-left;
- middle-right;
- bottom-right;
- bottom-left.

Each generated view is enlarged to a target width between 1,200 and 1,800 pixels, converted to grayscale, and auto-contrasted. Generation stops when the configured prediction-image cap is reached. The untouched original is still OCR'd; a failed crop does not replace it.

## Image limits

The authenticated Next scan route accepts only JPEG, PNG, and WebP and enforces:

- `12 MB` for each full source image;
- `512 KB` for each detail crop;
- `20 MB` total scan input across source images and detail crops.

The browser's multipart fallback additionally targets approximately `900 KB` per optimized full image, `180 KB` per detail crop, and less than `3.75 MB` for the complete multipart request. Persistent direct uploads preserve a high-resolution derivative up to `3600` pixels on the longest side and `3 MB` per image. Registration records a SHA-256 digest; the server checks Storage size/type before queueing and verifies the digest again before OCR.

Inside the worker, Pillow verifies that each decoded payload is a readable image and rejects it when its width multiplied by height exceeds `PADDLEOCR_MAX_DECODED_PIXELS`. The worker does not independently reproduce the Next route's total encoded-byte limit, so it should not be exposed as an unrestricted public upload endpoint.

## Response

Preferred response:

```json
{
  "provider": "paddleocr",
  "text": "all raw OCR text joined together",
  "serialNumber": "087/250",
  "checkedImages": 12
}
```

`serialNumber` can be `null` if no serial is visible. TCOS also accepts `serial_number`, `fullText`, `rawText`, `ocrText`, and nested `results`, `images`, `pages`, `detections`, or `lines` arrays containing `text` fields.

## Provider order

1. PaddleOCR runs first when `PADDLEOCR_API_URL` is configured.
2. If PaddleOCR finds a serial number, TCOS uses it.
3. If PaddleOCR returns text but no serial, TCOS can still use that text for card identity.
4. If Google Vision is configured and PaddleOCR misses the serial, Google Vision can be used as a fallback.
5. OpenAI still performs the final card-identification pass using the card images plus OCR text.

## What the UI shows

The InstaComp scan result displays OCR diagnostics:

- whether PaddleOCR is configured;
- whether Google Vision fallback is configured;
- which provider returned text;
- how many images were OCR'd;
- serial number found by OCR, if any;
- OCR text excerpt for debugging.

`checkedImages` includes worker-generated serial views. For a normal one- or two-original durable request, it should usually be greater than the number of submitted originals. It remains possible for OCR to return no serial even when a human can see a stamp; the result is evidence for review, not a guarantee.

## Verification

From the repository root:

```powershell
services\paddleocr-service\.venv\Scripts\python.exe -m py_compile services\paddleocr-service\app.py
Invoke-RestMethod http://127.0.0.1:8008/health
npm run simulate:instacomp-jobs
```

The health endpoint proves only that the HTTP process is listening. Run an authenticated real-card request or one complete InstaComp queue row to test model loading, OCR, generated crops, and the configured timeout. Confirm that the response reports `provider: paddleocr`, contains a sensible `checkedImages` value, and returns text when the card has readable text.

## Troubleshooting

- `401 Invalid OCR service token`: make the worker and Next `PADDLEOCR_API_KEY` values match, then restart both processes.
- Health works but the first scan fails: inspect `%TEMP%\tcos-paddleocr.stderr.log`; health does not load the model.
- Request waits behind another scan: the default semaphore allows one inference request at a time. Increase concurrency only after measuring RAM, CPU, latency, and model stability.
- `413` decoded-pixel error: resize the source; do not raise the pixel ceiling without confirming available memory.
- `400 ... is not a readable image`: verify that the upload is a real JPEG, PNG, or WebP and is not truncated.
- Serial remains missing: confirm both card sides, remove glare, photograph the stamp square to the lens, inspect `checkedImages` and OCR text, then leave the serial blank if no source proves the complete fraction.
- `INSTACOMP_JOB_MIGRATION_REQUIRED`: apply `supabase/migrations/20260711010000_create_instacomp_scan_job_queue.sql` to the Supabase project; this error is outside the Paddle worker itself.
