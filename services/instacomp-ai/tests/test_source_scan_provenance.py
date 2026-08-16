from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

from PIL import Image

from app.images import (
    NORMALIZED_MAX_EDGE,
    REFERENCE_MAX_EDGE,
    persist_image,
    persisted_image_manifest_path,
    persisted_image_path,
    persisted_reference_path,
    persisted_source_path,
    validate_and_normalize_image,
)


def _png_bytes(size: tuple[int, int] = (2400, 1800)) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", size, (33, 77, 121)).save(output, format="PNG")
    return output.getvalue()


def test_source_upload_is_preserved_byte_for_byte_beside_derivatives(tmp_path: Path) -> None:
    source = _png_bytes()
    image = validate_and_normalize_image(source, max_bytes=20 * 1024 * 1024)

    assert image.source_content == source
    assert image.source_sha256 == hashlib.sha256(source).hexdigest()
    assert image.source_extension == "png"
    assert image.source_width == 2400
    assert image.source_height == 1800
    assert max(image.width, image.height) <= NORMALIZED_MAX_EDGE

    archive = persist_image(image, tmp_path, "front")
    source_path = persisted_source_path(
        tmp_path,
        image.sha256,
        "front",
        image.source_extension,
    )
    reference_path = persisted_reference_path(tmp_path, image.sha256, "front")
    manifest_path = persisted_image_manifest_path(tmp_path, image.sha256, "front")

    assert archive == persisted_image_path(tmp_path, image.sha256, "front")
    assert archive.read_bytes() == image.content
    assert source_path.read_bytes() == source
    assert hashlib.sha256(source_path.read_bytes()).hexdigest() == image.source_sha256
    assert reference_path.read_bytes() == image.reference_content
    assert manifest_path.is_file()

    manifest = json.loads(manifest_path.read_text("utf-8"))
    assert manifest["source"]["sha256"] == image.source_sha256
    assert manifest["source"]["byte_for_byte_preserved"] is True
    assert manifest["source"]["width"] == 2400
    assert manifest["source"]["height"] == 1800
    assert manifest["normalized"]["sha256"] == image.sha256
    assert manifest["reference"]["sha256"] == image.reference_sha256
    assert manifest["reference"]["max_edge"] == REFERENCE_MAX_EDGE


def test_repeated_persist_does_not_rewrite_source_scan(tmp_path: Path) -> None:
    source = _png_bytes((1200, 900))
    image = validate_and_normalize_image(source, max_bytes=20 * 1024 * 1024)
    persist_image(image, tmp_path, "back")
    source_path = persisted_source_path(
        tmp_path,
        image.sha256,
        "back",
        image.source_extension,
    )
    before_mtime = source_path.stat().st_mtime_ns
    before = source_path.read_bytes()

    persist_image(image, tmp_path, "back")

    assert source_path.read_bytes() == before == source
    assert source_path.stat().st_mtime_ns == before_mtime
