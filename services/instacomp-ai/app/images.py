from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path
from PIL import Image, ImageOps

ALLOWED_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


@dataclass(frozen=True)
class ValidatedImage:
    content: bytes
    sha256: str
    media_type: str
    width: int
    height: int
    extension: str


def validate_and_normalize_image(content: bytes, max_bytes: int) -> ValidatedImage:
    if not content:
        raise ValueError("Image is empty")
    if len(content) > max_bytes:
        raise ValueError(f"Image exceeds {max_bytes} bytes")

    try:
        with Image.open(io.BytesIO(content)) as source:
            source.verify()
        with Image.open(io.BytesIO(content)) as source:
            image_format = (source.format or "").upper()
            if image_format not in ALLOWED_FORMATS:
                raise ValueError("Only JPEG, PNG, and WebP images are accepted")
            source = ImageOps.exif_transpose(source)
            if source.width < 200 or source.height < 200:
                raise ValueError("Image is too small for reliable card identification")
            if source.width * source.height > 60_000_000:
                raise ValueError("Image dimensions are too large")
            rgb = source.convert("RGB")
            output = io.BytesIO()
            rgb.save(output, format="JPEG", quality=92, optimize=True)
            normalized = output.getvalue()
            return ValidatedImage(
                content=normalized,
                sha256=hashlib.sha256(normalized).hexdigest(),
                media_type="image/jpeg",
                width=rgb.width,
                height=rgb.height,
                extension="jpg",
            )
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Image could not be decoded safely") from exc


def pair_hash(front_sha256: str, back_sha256: str | None) -> str:
    value = f"front:{front_sha256}|back:{back_sha256 or ''}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def persist_image(image: ValidatedImage, root: Path, side: str) -> Path:
    directory = root / image.sha256[:2] / image.sha256[2:4]
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{image.sha256}-{side}.{image.extension}"
    if not target.exists():
        target.write_bytes(image.content)
    return target
