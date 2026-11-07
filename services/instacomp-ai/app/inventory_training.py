from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

from .collx_authoritative_truth import (
    collx_id_from_inventory,
    load_authoritative_collx_source_cached,
    merge_collx_fallback_attributes,
)
from .inventory_training_keys import resolve_inventory_learning_uuid
from .models import CardIdentity


REPO_ROOT = Path(__file__).resolve().parents[3]

CARD_CATEGORY_MARKERS = (
    "sports card",
    "trading card",
    "baseball card",
    "basketball card",
    "football card",
    "hockey card",
    "soccer card",
    "wrestling card",
    "pokemon card",
    "tcg card",
)

CARD_CATEGORY_KEYS = {
    "sports card",
    "sports cards",
    "trading card",
    "trading cards",
    "baseball card",
    "baseball cards",
    "basketball card",
    "basketball cards",
    "football card",
    "football cards",
    "hockey card",
    "hockey cards",
    "soccer card",
    "soccer cards",
    "wrestling card",
    "wrestling cards",
    "pokemon card",
    "pokemon cards",
    "tcg card",
    "tcg cards",
    "trading card singles",
}

SEALED_CATEGORY_KEYS = {
    "sealed wax",
    "sealed product",
    "sealed products",
    "booster box",
    "booster boxes",
    "box",
    "boxes",
    "pack",
    "packs",
}

IDENTITY_CONTAINER_KEYS = (
    "card_identity",
    "identity",
    "instacomp_identity",
    "confirmed_identity",
)

ATTRIBUTE_ALIASES: dict[str, tuple[str, ...]] = {
    "sport": ("sport",),
    "league": ("league",),
    "year": ("year", "season"),
    "manufacturer": ("manufacturer",),
    "brand": ("brand",),
    "set_name": ("set", "set name", "card set", "product"),
    "subset": ("subset", "insert set", "insert", "card name"),
    "player": ("player", "player athlete", "athlete", "name"),
    "team": ("team",),
    "card_number": ("card number", "number", "card no", "card #"),
    "parallel": ("parallel", "parallel variety", "variety"),
    "variation": ("variation",),
    "serial_number": ("serial number", "serial", "copy number"),
    "serial_run": ("print run", "serial run", "numbered to"),
    "rookie": ("rookie",),
    "autograph": ("autographed", "autograph", "signed"),
    "inscription": ("inscription", "inscribed"),
    "inscription_text": ("inscription text",),
    "memorabilia": ("memorabilia", "relic", "game used"),
    "memorabilia_type": ("memorabilia type", "relic type"),
}

FEATURE_ALIASES = ("features", "flags", "special features")

FRONT_MARKERS = (
    "front",
    "obverse",
    "-1-",
    "_1_",
    "-1.",
    "_1.",
)
BACK_MARKERS = (
    "back",
    "reverse",
    "-2-",
    "_2_",
    "-2.",
    "_2.",
)


@dataclass(frozen=True)
class InventoryTruth:
    inventory_item_id: str
    card_uuid: str
    title: str
    identity: CardIdentity
    front_url: str
    back_url: str | None
    image_side_source: str


def _text(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    text = " ".join(str(value).strip().split())
    return text or None


def _norm_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower()).strip()


def _norm_value(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    normalized = _norm_value(value)
    if not normalized:
        return None
    if normalized in {"yes", "true", "1", "y", "rookie", "autograph", "signed", "relic", "memorabilia"}:
        return True
    if normalized in {"no", "false", "0", "n", "none", "not autographed"}:
        return False
    return None


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    text = _text(value)
    if not text:
        return None
    match = re.fullmatch(r"(?:/\s*)?(\d{1,7})", text.replace(",", "").strip())
    if not match:
        return None
    parsed = int(match.group(1))
    return parsed if parsed > 0 else None


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _normalized_mapping(value: object) -> dict[str, object]:
    if not isinstance(value, Mapping):
        return {}
    return {_norm_key(key): item for key, item in value.items()}


def _first(mapping: Mapping[str, object], aliases: Iterable[str]) -> object | None:
    for alias in aliases:
        value = mapping.get(_norm_key(alias))
        if _text(value) is not None:
            return value
    return None


def _identity_container(metadata: Mapping[str, Any]) -> Mapping[str, Any]:
    for key in IDENTITY_CONTAINER_KEYS:
        value = metadata.get(key)
        if isinstance(value, Mapping):
            return value
    return {}


def _feature_text(*sources: Mapping[str, object]) -> str:
    values: list[str] = []
    for source in sources:
        for alias in FEATURE_ALIASES:
            value = source.get(_norm_key(alias))
            if value is None:
                continue
            if isinstance(value, (list, tuple, set)):
                values.extend(str(item) for item in value)
            else:
                values.append(str(value))
    return " ".join(values).lower()


def _feature_flag(text: str, markers: tuple[str, ...]) -> bool | None:
    if not text:
        return None
    return True if any(marker in text for marker in markers) else None


def inventory_card_reason(
    item: Mapping[str, Any],
    product: Mapping[str, Any] | None = None,
) -> str | None:
    """Classify a single-card inventory row using durable structured evidence.

    The 2026-08-11 full CollX migration source is a card collection export and
    minted durable COLLX-* SKUs for its rows. That SKU survives activation even
    after one-time migration metadata is intentionally removed. Sealed product
    categories remain excluded from visual single-card training.
    """
    product = product or {}
    item_category = _norm_key(item.get("category"))
    product_category = _norm_key(product.get("category"))

    if item_category in SEALED_CATEGORY_KEYS or product_category in SEALED_CATEGORY_KEYS:
        return None
    if item_category in CARD_CATEGORY_KEYS:
        return "inventory_card_category"
    if product_category in CARD_CATEGORY_KEYS:
        return "product_card_category"

    sku = str(item.get("sku") or product.get("sku") or "").strip().upper()
    if sku.startswith("COLLX-"):
        return "collx_card_sku"

    metadata = _mapping(item.get("metadata"))
    source = _norm_key(metadata.get("source"))
    if source.startswith("collx"):
        return "collx_card_source"

    explicit = _identity_container(metadata)
    if explicit:
        normalized = _normalized_mapping(explicit)
        if any(
            _first(normalized, aliases)
            for aliases in (
                ATTRIBUTE_ALIASES["card_number"],
                ATTRIBUTE_ALIASES["set_name"],
                ATTRIBUTE_ALIASES["player"],
            )
        ):
            return "explicit_card_identity"

    values = [
        item.get("category"),
        item.get("title"),
        product.get("category"),
        product.get("title"),
    ]
    combined = " ".join(_norm_key(value) for value in values if value is not None)
    if any(marker in combined for marker in CARD_CATEGORY_MARKERS):
        return "card_text_marker"
    return None


def inventory_item_is_card(item: Mapping[str, Any], product: Mapping[str, Any] | None = None) -> bool:
    return inventory_card_reason(item, product) is not None


def extract_inventory_identity(
    item: Mapping[str, Any],
    *,
    attributes: Mapping[str, Any] | None = None,
    product: Mapping[str, Any] | None = None,
) -> CardIdentity:
    """Map already-correct structured inventory truth into CardIdentity.

    Priority is explicit stored identity -> current inventory attributes -> product
    fields -> source metadata. For durable COLLX-* rows, the exact checksummed
    6,909-row operator-owned CollX export is used only as a fallback beneath current
    inventory attributes. Arbitrary listing-title prose is never promoted into
    trusted truth.
    """
    metadata_raw = _mapping(item.get("metadata"))
    explicit_raw = _identity_container(metadata_raw)
    explicit = _normalized_mapping(explicit_raw)

    current_attributes = dict(attributes or {})
    collx_id = collx_id_from_inventory(item, product)
    if collx_id:
        source_rows = load_authoritative_collx_source_cached(str(REPO_ROOT))
        source_row = source_rows.get(collx_id)
        current_attributes = merge_collx_fallback_attributes(current_attributes, source_row)

    attrs = _normalized_mapping(current_attributes)
    metadata = _normalized_mapping(metadata_raw)
    product_map = _normalized_mapping(product or {})

    def value_for(field: str) -> object | None:
        aliases = ATTRIBUTE_ALIASES[field]
        return (
            _first(explicit, (field, *aliases))
            or _first(attrs, aliases)
            or _first(product_map, (field, *aliases))
            or _first(metadata, (field, *aliases))
        )

    feature_text = _feature_text(explicit, attrs, metadata)

    rookie = _bool(value_for("rookie"))
    if rookie is None:
        rookie = _feature_flag(feature_text, ("rookie", " rc ", "rc card"))

    autograph = _bool(value_for("autograph"))
    if autograph is None:
        autograph = _feature_flag(feature_text, ("autograph", "autographed", "signed"))

    inscription = _bool(value_for("inscription"))
    if inscription is None:
        inscription = _feature_flag(feature_text, ("inscription", "inscribed"))

    memorabilia = _bool(value_for("memorabilia"))
    if memorabilia is None:
        memorabilia = _feature_flag(
            feature_text,
            ("memorabilia", "relic", "patch", "jersey", "game used", "game-used"),
        )

    payload: dict[str, Any] = {}
    for field in (
        "sport",
        "league",
        "year",
        "manufacturer",
        "brand",
        "set_name",
        "subset",
        "player",
        "team",
        "card_number",
        "parallel",
        "variation",
        "serial_number",
        "inscription_text",
        "memorabilia_type",
    ):
        payload[field] = _text(value_for(field))

    payload["serial_run"] = _positive_int(value_for("serial_run"))
    payload["rookie"] = rookie
    payload["autograph"] = autograph
    payload["inscription"] = inscription
    payload["memorabilia"] = memorabilia

    return CardIdentity(**payload)


def identity_has_training_truth(identity: CardIdentity) -> bool:
    """Require enough structured truth to avoid teaching an empty/weak label."""
    subject = bool(identity.player or identity.team)
    release = bool(identity.year or identity.set_name or identity.brand or identity.manufacturer)
    discriminator = bool(
        identity.card_number
        or identity.set_name
        or identity.parallel
        or identity.variation
        or identity.subset
    )
    return subject and release and discriminator


def _image_url(image: Mapping[str, Any]) -> str | None:
    # Production inventory_images uses image_url. `url` remains a compatibility
    # fallback for older tests/import receipts and synthesized product image rows.
    return _text(image.get("image_url")) or _text(image.get("url"))


def _image_marker(image: Mapping[str, Any]) -> str:
    url = _norm_value(_image_url(image))
    alt = _norm_value(image.get("alt_text"))
    parsed = urlparse(_image_url(image) or "")
    filename = parsed.path.rsplit("/", 1)[-1].lower()
    return f"{alt} {filename} {url}"


def select_inventory_images(images: Iterable[Mapping[str, Any]]) -> tuple[str | None, str | None, str]:
    rows = [
        row
        for row in images
        if _image_url(row) and str(_image_url(row)).lower().startswith("https://")
    ]
    rows.sort(key=lambda row: (int(row.get("sort_order") or 0), _image_url(row) or ""))
    if not rows:
        return None, None, "none"

    explicit_front = next(
        (row for row in rows if any(marker in _image_marker(row) for marker in FRONT_MARKERS)),
        None,
    )
    explicit_back = next(
        (row for row in rows if any(marker in _image_marker(row) for marker in BACK_MARKERS)),
        None,
    )

    front = explicit_front or rows[0]
    back = explicit_back
    source = "explicit_markers" if explicit_front or explicit_back else "ordered_inventory_images"

    if back is None and len(rows) == 2 and rows[1] is not front:
        # Inventory ingestion and CollX mirroring preserve front/back sort order.
        # Only use this fallback for an exact two-image card, never a gallery.
        back = rows[1]
        source = "two_image_order"

    front_url = _image_url(front)
    back_url = _image_url(back) if back and back is not front else None
    return front_url, back_url, source


def build_inventory_truth(
    item: Mapping[str, Any],
    *,
    attributes: Mapping[str, Any] | None,
    images: Iterable[Mapping[str, Any]],
    product: Mapping[str, Any] | None = None,
) -> InventoryTruth | None:
    if not inventory_item_is_card(item, product):
        return None
    card_uuid, _uuid_source = resolve_inventory_learning_uuid(item, product)
    item_id = _text(item.get("id"))
    if not card_uuid or not item_id:
        return None
    identity = extract_inventory_identity(item, attributes=attributes, product=product)
    if not identity_has_training_truth(identity):
        return None
    front_url, back_url, source = select_inventory_images(images)
    if not front_url:
        return None
    return InventoryTruth(
        inventory_item_id=item_id,
        card_uuid=card_uuid,
        title=_text(item.get("title")) or _text((product or {}).get("title")) or item_id,
        identity=identity,
        front_url=front_url,
        back_url=back_url,
        image_side_source=source,
    )
