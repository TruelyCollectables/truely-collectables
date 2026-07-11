import base64
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field


class OcrImage(BaseModel):
    name: str = "card-image.jpg"
    dataUrl: str


class OcrRequest(BaseModel):
    images: list[OcrImage] = Field(default_factory=list)
    hints: dict[str, Any] = Field(default_factory=dict)


app = FastAPI(title="TCOS InstaComp PaddleOCR Service")
_ocr: Any | None = None


def normalize_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\r", "\n")).strip()


def extract_serial_number(text: str) -> str | None:
    normalized = (
        normalize_text(text)
        .replace("|", "/")
        .replace("／", "/")
        .replace("O/", "0/")
        .replace("o/", "0/")
    )

    for match in re.finditer(
        r"\b(?:serial\s*(?:no\.?|number)?\s*)?([0-9O]{1,4})\s*(?:/|of)\s*([0-9O]{1,4})\b",
        normalized,
        flags=re.IGNORECASE,
    ):
        numerator = match.group(1).replace("O", "0").replace("o", "0")
        denominator = match.group(2).replace("O", "0").replace("o", "0")

        if denominator == "1" and numerator != "1":
            continue

        return f"{numerator}/{denominator}"

    if re.search(r"\b(?:one\s+of\s+one|1\s+of\s+1|1/1)\b", normalized, re.I):
        return "1/1"

    return None


def collect_text_values(value: Any, depth: int = 0) -> list[str]:
    if value is None or depth > 5:
        return []

    if isinstance(value, str):
        return [value]

    if isinstance(value, dict):
        direct = [
            value.get("text"),
            value.get("fullText"),
            value.get("full_text"),
            value.get("rawText"),
            value.get("raw_text"),
            value.get("description"),
            value.get("ocrText"),
            value.get("ocr_text"),
        ]
        nested = [
            value.get("res"),
            value.get("results"),
            value.get("images"),
            value.get("pages"),
            value.get("detections"),
            value.get("lines"),
            value.get("rec_texts"),
        ]

        return [
            *[item for item in direct if isinstance(item, str)],
            *[
                text
                for item in nested
                for text in collect_text_values(item, depth + 1)
            ],
        ]

    if isinstance(value, (list, tuple)):
        return [
            text
            for item in value
            for text in collect_text_values(item, depth + 1)
        ]

    json_value = getattr(value, "json", None)
    if callable(json_value):
        try:
            return collect_text_values(json_value, depth + 1)
        except Exception:
            pass
    elif json_value is not None:
        return collect_text_values(json_value, depth + 1)

    res_value = getattr(value, "res", None)
    if res_value is not None:
        return collect_text_values(res_value, depth + 1)

    dict_value = getattr(value, "__dict__", None)
    if isinstance(dict_value, dict):
        return collect_text_values(dict_value, depth + 1)

    return []


def decode_data_url(image: OcrImage) -> bytes:
    if "," not in image.dataUrl:
        raise HTTPException(status_code=400, detail=f"{image.name} is not a data URL")

    _, encoded = image.dataUrl.split(",", 1)

    try:
        return base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"{image.name} has invalid base64 image data"
        ) from exc


def get_ocr() -> Any:
    global _ocr

    if _ocr is None:
        from paddleocr import PaddleOCR

        kwargs: dict[str, Any] = {
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
            # PaddlePaddle 3.3's Windows oneDNN/PIR path crashes on PP-OCRv6
            # models. Keep it disabled by default on Windows; it can still be
            # explicitly enabled where the runtime is known to support it.
            "enable_mkldnn": os.getenv(
                "PADDLEOCR_ENABLE_MKLDNN", "false" if os.name == "nt" else "true"
            ).lower()
            in {"1", "true", "yes", "on"},
        }

        if os.getenv("PADDLEOCR_LANG"):
            kwargs["lang"] = os.environ["PADDLEOCR_LANG"]
        if os.getenv("PADDLEOCR_VERSION"):
            kwargs["ocr_version"] = os.environ["PADDLEOCR_VERSION"]
        if os.getenv("PADDLEOCR_DEVICE"):
            kwargs["device"] = os.environ["PADDLEOCR_DEVICE"]
        if os.getenv("PADDLEOCR_CPU_THREADS"):
            kwargs["cpu_threads"] = int(os.environ["PADDLEOCR_CPU_THREADS"])
        if os.getenv("PADDLEOCR_TEXT_DET_LIMIT_SIDE_LEN"):
            kwargs["text_det_limit_side_len"] = int(
                os.environ["PADDLEOCR_TEXT_DET_LIMIT_SIDE_LEN"]
            )
        if os.getenv("PADDLEOCR_TEXT_DET_LIMIT_TYPE"):
            kwargs["text_det_limit_type"] = os.environ[
                "PADDLEOCR_TEXT_DET_LIMIT_TYPE"
            ]

        _ocr = PaddleOCR(**kwargs)

    return _ocr


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "true", "provider": "paddleocr"}


@app.post("/ocr")
def ocr_endpoint(
    request: OcrRequest, authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    expected_key = os.getenv("PADDLEOCR_API_KEY")
    if expected_key and authorization != f"Bearer {expected_key}":
        raise HTTPException(status_code=401, detail="Invalid OCR service token")

    if not request.images:
        raise HTTPException(status_code=400, detail="No images provided")

    ocr = get_ocr()
    all_texts: list[str] = []
    image_results: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory(prefix="tcos-paddleocr-") as temp_dir:
        for index, image in enumerate(request.images[:24], start=1):
            suffix = Path(image.name).suffix or ".jpg"
            image_path = Path(temp_dir) / f"{index:02d}{suffix}"
            image_path.write_bytes(decode_data_url(image))

            prediction = ocr.predict(str(image_path))
            texts = [normalize_text(text) for text in collect_text_values(prediction)]
            texts = [text for text in texts if text]
            image_text = normalize_text("\n".join(texts))

            all_texts.append(image_text)
            image_results.append(
                {
                    "name": image.name,
                    "text": image_text,
                    "serialNumber": extract_serial_number(image_text),
                }
            )

    full_text = normalize_text("\n".join(all_texts))

    return {
        "provider": "paddleocr",
        "text": full_text,
        "serialNumber": extract_serial_number(full_text),
        "checkedImages": min(len(request.images), 24),
        "images": image_results,
    }
