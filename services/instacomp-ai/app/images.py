from __future__ import annotations

import hashlib
import io
import json
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
    # Normalized archive used by the existing scan/memory pipeline.
    content: bytes
    sha256: str
    media_type: str
    width: int
    height: int
    extension: str
    rotation_applied: int
    # Untouched user-owned source upload. This is never used as an identity
    # authority, but it preserves every original pixel/byte for future mining.
    source_content: bytes
    source_sha256: str
    source_media_type: str
    source_width: int
    source_height: int
    source_extension: str
    # Tiny similarity/reference derivative used for perceptual matching.
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


def validate_and_normalize_image(
    content: bytes,
    max_bytes: int,
    *,
    rotation: int = 0,
) -> ValidatedImage:
    if not content:
        raise ValueError("Image is empty")
    if len(content) > max_bytes:
        raise ValueError(f"Image exceeds {max_bytes} bytes")

    source_sha256 = hashlib.sha256(content).hexdigest()
    try:
        with Image.open(io.BytesIO(content)) as source:
            source.verify()
        with Image.open(io.BytesIO(content)) as source:
            image_format = (source.format or "").upper()
            if image_format not in ALLOWED_FORMATS:
                raise ValueError("Only JPEG, PNG, and WebP images are accepted")
            source_extension = ALLOWED_FORMATS[image_format]
            source_media_type = {
                "jpg": "image/jpeg",
                "png": "image/png",
                "webp": "image/webp",
            }[source_extension]
            source_width = int(source.width)
            source_height = int(source.height)

            # EXIF orientation is useful but non-essential. Some marketplace/card
            # images contain malformed EXIF/TIFF metadata that Pillow can reject
            # even though the underlying pixels decode correctly. Never let bad
            # metadata abort a full inventory-training run; fall back to the
            # decoded image without applying EXIF orientation.
            try:
                source = ImageOps.exif_transpose(source)
            except Exception:
                source = source.copy()

            normalized_rotation = int(rotation) % 360
            if normalized_rotation not in {0, 90, 180, 270}:
                raise ValueError("Image rotation must be 0, 90, 180, or 270 degrees")
            if normalized_rotation:
                # Pillow rotates counter-clockwise; the scanner decision is the
                # clockwise correction required to make printed card text upright.
                source = source.rotate(-normalized_rotation, expand=True)

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
                rotation_applied=normalized_rotation,
                source_content=content,
                source_sha256=source_sha256,
                source_media_type=source_media_type,
                source_width=source_width,
                source_height=source_height,
                source_extension=source_extension,
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


def persisted_source_path(
    root: Path,
    normalized_sha256: str,
    side: str,
    source_extension: str,
) -> Path:
    normalized_sha = normalized_sha256.strip().lower()
    extension = source_extension.strip().lower()
    if not SHA256_PATTERN.fullmatch(normalized_sha):
        raise ValueError("Invalid archived image hash")
    if side not in {"front", "back"}:
        raise ValueError("Source image side must be front or back")
    if extension not in set(ALLOWED_FORMATS.values()):
        raise ValueError("Invalid source image extension")
    return (
        root
        / normalized_sha[:2]
        / normalized_sha[2:4]
        / f"{normalized_sha}-{side}-source.{extension}"
    )


def persisted_image_manifest_path(root: Path, sha256: str, side: str) -> Path:
    normalized_sha = sha256.strip().lower()
    if not SHA256_PATTERN.fullmatch(normalized_sha):
        raise ValueError("Invalid archived image hash")
    if side not in {"front", "back"}:
        raise ValueError("Image side must be front or back")
    return (
        root
        / normalized_sha[:2]
        / normalized_sha[2:4]
        / f"{normalized_sha}-{side}-manifest.json"
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

    # Preserve the exact submitted file byte-for-byte. The normalized SHA remains
    # the lookup key so every existing scan record can deterministically locate
    # its source without a database migration.
    source_target = persisted_source_path(
        root,
        image.sha256,
        side,
        image.source_extension,
    )
    if not source_target.exists():
        source_target.write_bytes(image.source_content)

    reference_target = persisted_reference_path(root, image.sha256, side)
    if not reference_target.exists():
        reference_target.write_bytes(image.reference_content)

    manifest_target = persisted_image_manifest_path(root, image.sha256, side)
    manifest = {
        "schema_version": "tcos.instacomp-ai.image-provenance.v1",
        "side": side,
        "normalized": {
            "sha256": image.sha256,
            "media_type": image.media_type,
            "width": image.width,
            "height": image.height,
            "bytes": len(image.content),
            "path": str(target),
            "clockwise_rotation_applied": image.rotation_applied,
        },
        "source": {
            "sha256": image.source_sha256,
            "media_type": image.source_media_type,
            "width": image.source_width,
            "height": image.source_height,
            "bytes": len(image.source_content),
            "extension": image.source_extension,
            "path": str(source_target),
            "byte_for_byte_preserved": True,
        },
        "reference": {
            "sha256": image.reference_sha256,
            "media_type": "image/webp",
            "max_edge": REFERENCE_MAX_EDGE,
            "bytes": len(image.reference_content),
            "path": str(reference_target),
            "perceptual_hash": image.perceptual_hash,
        },
    }
    encoded_manifest = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    if not manifest_target.exists() or manifest_target.read_bytes() != encoded_manifest:
        manifest_target.write_bytes(encoded_manifest)
    return target
