# TCOS InstaComp PaddleOCR service

This is the local OCR worker TCOS can call with `PADDLEOCR_API_URL`.

PaddleOCR is a Python ML stack, so we keep it outside the Next app. The web app sends card fronts, backs, and serial-number crops to this service. The service returns raw OCR text plus any serial number it finds.

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
PADDLEOCR_TIMEOUT_MS=12000
```

## Optional tuning

```env
PADDLEOCR_LANG=en
PADDLEOCR_VERSION=PP-OCRv6
PADDLEOCR_DEVICE=cpu
PADDLEOCR_CPU_THREADS=8
PADDLEOCR_TEXT_DET_LIMIT_SIDE_LEN=2200
PADDLEOCR_TEXT_DET_LIMIT_TYPE=min
```

If you have a supported GPU setup, use the PaddlePaddle GPU package that matches your CUDA stack and set `PADDLEOCR_DEVICE=gpu:0`.

## Endpoints

- `GET /health`
- `POST /ocr`

The `/ocr` request/response shape is documented in [docs/INSTACOMP_PADDLEOCR_SERVICE.md](../../docs/INSTACOMP_PADDLEOCR_SERVICE.md).

