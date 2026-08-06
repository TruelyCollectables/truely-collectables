from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

ALLOWED_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
REFERENCE_MAX_EDGE = 384
NORMALIZED_MAX_EDGE = 1600


@dataclass(frozen=True)
class ValidatedImage:
    content: bytes
    sha256: str
    media_type: str
    width: int
    height: int
    extension: str
    reference_content: bytes
    reference_sha256: str
    perceptual_hash: str


def _perceptual_dhash(image: Image.Image) -> str:
    """Return a compact 64-bit difference hash for near-image matching."""
    grayscale = image.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    pixels = list(grayscale.getdata())
    bits = 0
    for row in range(8):
        offset = row * 9
        for column in range(8):
            bits = (bits << 1) | int(
                pixels[offset + column] > pixels[offset + column + 1]
            )
    return f"{bits:016x}"


def perceptual_hash_distance(left: str | None, right: str | None) -> int | None:
    if not left or not right:
        return None
    try:
        return (int(left, 16) ^ int(right, 16)).bit_count()
    except ValueError:
        return None


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
            normalized_image = rgb.copy()
            normalized_image.thumbnail(
                (NORMALIZED_MAX_EDGE, NORMALIZED_MAX_EDGE),
                Image.Resampling.LANCZOS,
            )
            normalized_output = io.BytesIO()
            normalized_image.save(
                normalized_output,
                format="JPEG",
                quality=88,
                optimize=True,
                progressive=True,
            )
            normalized = normalized_output.getvalue()

            reference_image = rgb.copy()
            reference_image.thumbnail(
                (REFERENCE_MAX_EDGE, REFERENCE_MAX_EDGE),
                Image.Resampling.LANCZOS,
            )
            reference_output = io.BytesIO()
            reference_image.save(
                reference_output,
                format="WEBP",
                quality=72,
                method=6,
            )
            reference = reference_output.getvalue()

            return ValidatedImage(
                content=normalized,
                sha256=hashlib.sha256(normalized).hexdigest(),
                media_type="image/jpeg",
                width=normalized_image.width,
                height=normalized_image.height,
                extension="jpg",
                reference_content=reference,
                reference_sha256=hashlib.sha256(reference).hexdigest(),
                perceptual_hash=_perceptual_dhash(reference_image),
            )
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Image could not be decoded safely") from exc


def pair_hash(front_sha256: str, back_sha256: str | None) -> str:
    value = f"front:{front_sha256}|back:{back_sha256 or ''}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def persisted_image_path(root: Path, sha256: str, side: str) -> Path:
    normalized_sha = sha256.strip().lower()
    if not SHA256_PATTERN.fullmatch(normalized_sha):
        raise ValueError("Invalid archived image hash")
    if side not in {"front", "back"}:
        raise ValueError("Archived image side must be front or back")
    return (
        root
        / normalized_sha[:2]
        / normalized_sha[2:4]
        / f"{normalized_sha}-{side}.jpg"
    )


def persisted_reference_path(root: Path, sha256: str, side: str) -> Path:
    normalized_sha = sha256.strip().lower()
    if not SHA256_PATTERN.fullmatch(normalized_sha):
        raise ValueError("Invalid reference image hash")
    if side not in {"front", "back"}:
        raise ValueError("Reference image side must be front or back")
    return (
        root
        / normalized_sha[:2]
        / normalized_sha[2:4]
        / f"{normalized_sha}-{side}-reference.webp"
    )


def persist_image(image: ValidatedImage, root: Path, side: str) -> Path:
    target = persisted_image_path(root, image.sha256, side)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(image.content)

    reference_target = persisted_reference_path(root, image.sha256, side)
    if not reference_target.exists():
        reference_target.write_bytes(image.reference_content)
    return target
