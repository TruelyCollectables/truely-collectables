from io import BytesIO
from PIL import Image
import pytest

from app.images import pair_hash, validate_and_normalize_image


def image_bytes(width: int = 600, height: int = 840) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), "white").save(output, format="PNG")
    return output.getvalue()


def test_valid_image_is_normalized_and_hashed():
    result = validate_and_normalize_image(image_bytes(), 2_000_000)
    assert result.media_type == "image/jpeg"
    assert result.width == 600
    assert result.height == 840
    assert len(result.sha256) == 64
    assert pair_hash(result.sha256, None) != result.sha256


def test_small_image_is_rejected():
    with pytest.raises(ValueError, match="too small"):
        validate_and_normalize_image(image_bytes(100, 100), 2_000_000)
