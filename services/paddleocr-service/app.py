import base64
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from PIL import Image, ImageOps
from pydantic import BaseModel, Field


class OcrImage(BaseModel):
    name: str = "card-image.jpg"
    dataUrl: str


class OcrRequest(BaseModel):
    images: list[OcrImage] = Field(default_factory=list)
    hints: dict[str, Any] = Field(default_factory=dict)


app = FastAPI(title="TCOS InstaComp PaddleOCR Service")
_ocr: Any | None = None


def bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default

    return max(minimum, min(maximum, value))


_ocr_concurrency = bounded_env_int("PADDLEOCR_MAX_CONCURRENCY", 1, 1, 4)
_ocr_semaphore = threading.BoundedSemaphore(_ocr_concurrency)
_ocr_init_lock = threading.Lock()
_max_prediction_images = bounded_env_int(
    "PADDLEOCR_MAX_PREDICTION_IMAGES", 14, 2, 24
)
_max_decoded_pixels = bounded_env_int(
    "PADDLEOCR_MAX_DECODED_PIXELS", 40_000_000, 1_000_000, 100_000_000
)
Image.MAX_IMAGE_PIXELS = _max_decoded_pixels

SERIAL_CROP_SPECS: tuple[tuple[str, float, float, float, float], ...] = (
    ("top-right", 0.45, 0.00, 1.00, 0.30),
    ("top-left", 0.00, 0.00, 0.55, 0.30),
    ("middle-right", 0.45, 0.20, 1.00, 0.75),
    ("bottom-right", 0.45, 0.60, 1.00, 1.00),
    ("bottom-left", 0.00, 0.60, 0.55, 1.00),
)


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


def build_serial_crops(
    image_path: Path,
    image_name: str,
    temp_dir: Path,
    available_slots: int,
) -> list[tuple[str, Path]]:
    if available_slots <= 0:
        return []

    crops: list[tuple[str, Path]] = []

    try:
        with Image.open(image_path) as source:
            source = ImageOps.exif_transpose(source).convert("RGB")
            source_width, source_height = source.size

            if not source_width or not source_height:
                return crops

            for label, left, top, right, bottom in SERIAL_CROP_SPECS:
                if len(crops) >= available_slots:
                    break

                box = (
                    max(0, round(source_width * left)),
                    max(0, round(source_height * top)),
                    min(source_width, round(source_width * right)),
                    min(source_height, round(source_height * bottom)),
                )
                crop = source.crop(box)
                crop_width, crop_height = crop.size

                if not crop_width or not crop_height:
                    continue

                target_width = min(1800, max(1200, crop_width * 2))
                target_height = max(1, round(target_width * crop_height / crop_width))
                crop = crop.resize(
                    (target_width, target_height),
                    Image.Resampling.LANCZOS,
                )
                # Foil serial stamps are frequently low contrast. A grayscale
                # auto-contrast view is materially easier for OCR than the
                # glossy color source while preserving the actual digits.
                crop = ImageOps.autocontrast(ImageOps.grayscale(crop)).convert("RGB")
                crop_path = temp_dir / (
                    f"serial-{len(crops) + 1:02d}-{Path(image_name).stem}-{label}.jpg"
                )
                crop.save(crop_path, format="JPEG", quality=88, optimize=True)
                crops.append((f"{image_name}-serial-{label}", crop_path))
    except Exception:
        # The full image is still OCR'd even when a damaged image cannot be
        # opened for targeted serial crops.
        return []

    return crops


def validate_decoded_image(image_path: Path, image_name: str) -> None:
    try:
        with Image.open(image_path) as image:
            width, height = image.size
            pixels = width * height

            if width < 1 or height < 1 or pixels > _max_decoded_pixels:
                raise HTTPException(
                    status_code=413,
                    detail=(
                        f"{image_name} exceeds the OCR decoded-pixel limit "
                        f"({_max_decoded_pixels})"
                    ),
                )

            image.verify()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"{image_name} is not a readable image",
        ) from exc


def get_ocr() -> Any:
    global _ocr

    if _ocr is not None:
        return _ocr

    with _ocr_init_lock:
        if _ocr is not None:
            return _ocr

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

    all_texts: list[str] = []
    image_results: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory(prefix="tcos-paddleocr-") as temp_dir:
        temp_path = Path(temp_dir)
        prediction_images: list[tuple[str, Path]] = []

        for index, image in enumerate(
            request.images[:_max_prediction_images], start=1
        ):
            suffix = Path(image.name).suffix or ".jpg"
            image_path = temp_path / f"input-{index:02d}{suffix}"
            image_path.write_bytes(decode_data_url(image))
            validate_decoded_image(image_path, image.name)
            prediction_images.append((image.name, image_path))

        # Persistent scan jobs upload only the two full card-side derivatives. Build
        # targeted OCR views inside the OCR service so image bytes never need
        # to be relayed through a large Next.js multipart request.
        if len(prediction_images) <= 2:
            originals = list(prediction_images)

            for image_name, image_path in originals:
                prediction_images.extend(
                    build_serial_crops(
                        image_path,
                        image_name,
                        temp_path,
                        _max_prediction_images - len(prediction_images),
                    )
                )

                if len(prediction_images) >= _max_prediction_images:
                    break

        with _ocr_semaphore:
            ocr = get_ocr()

            for image_name, image_path in prediction_images:
                prediction = ocr.predict(str(image_path))
                texts = [
                    normalize_text(text) for text in collect_text_values(prediction)
                ]
                texts = [text for text in texts if text]
                image_text = normalize_text("\n".join(texts))

                all_texts.append(image_text)
                image_results.append(
                    {
                        "name": image_name,
                        "text": image_text,
                        "serialNumber": extract_serial_number(image_text),
                    }
                )

    full_text = normalize_text("\n".join(all_texts))

    return {
        "provider": "paddleocr",
        "text": full_text,
        "serialNumber": extract_serial_number(full_text),
        "checkedImages": len(prediction_images),
        "images": image_results,
    }
