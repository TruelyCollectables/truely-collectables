# InstaComp PaddleOCR service contract

InstaComp can use PaddleOCR as its first real OCR provider for tiny serial-number stamps, card numbers, player names, set text, and back-of-card details.

The Next app does not run PaddleOCR directly. PaddleOCR should run as a separate HTTP service so the web app stays fast, deployable, and easy to restart.

## Environment variables

Add these to the app environment and restart the server:

```bash
PADDLEOCR_API_URL=http://localhost:8008/ocr
PADDLEOCR_API_KEY=optional-shared-secret
PADDLEOCR_TIMEOUT_MS=12000
```

`PADDLEOCR_API_URL` enables PaddleOCR. `PADDLEOCR_API_KEY` is optional; when set, TCOS sends it as a bearer token. Google Vision can stay configured as a fallback with `GOOGLE_VISION_API_KEY` or `GOOGLE_CLOUD_VISION_API_KEY`.

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

TCOS may send up to 24 images per card: front, back, serial crops, top bands, edge crops, contrast crops, and full-card fallbacks.

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

