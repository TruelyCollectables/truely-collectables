from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from app.config import Settings
from app.models import CardIdentity, SpecimenAttributes
from app.specimen_attributes import (
    RawSpecimenVision,
    _build_result,
    _parse_cloudflare_specimen,
    analyze_specimen_attributes,
)
from app.storage import MemoryStore


def test_patch_colors_are_post_identity_and_description_only_team_match():
    identity = CardIdentity(
        year="2024",
        set_name="Test Set",
        player="Test Player",
        team="Vegas Golden Knights",
        card_number="PA-1",
        serial_run=65,
        autograph=True,
        memorabilia=True,
        memorabilia_type="Patch",
    )
    canonical_before = identity.model_dump()

    result = _build_result(
        RawSpecimenVision(
            patch_color_count=4,
            patch_colors=["gold", "gray", "black", "white"],
            patch_type="jersey patch",
            team_color_match=True,
            team_color_match_colors=["gold", "gray", "black"],
            team_color_match_confidence=0.97,
            observation_confidence=0.99,
        ),
        identity,
    )

    assert identity.model_dump() == canonical_before
    assert result.identity_fields_mutated is False
    assert result.status == "observed"
    assert result.patch_color_count == 4
    assert result.patch_colors == ["gold", "grey", "black", "white"]
    assert result.title_suffix == "4 Color Patch"
    assert result.description_note is not None
    assert "Gold, Grey, Black, and White" in result.description_note
    assert "Vegas Golden Knights" in result.description_note


def test_count_disagreement_fails_closed_for_listing_copy():
    identity = CardIdentity(memorabilia=True, memorabilia_type="Patch")
    result = _build_result(
        RawSpecimenVision(
            patch_color_count=4,
            patch_colors=["red", "white", "blue"],
            observation_confidence=0.99,
        ),
        identity,
    )

    assert result.status == "uncertain"
    assert result.patch_color_count == 3
    assert result.title_suffix is None
    assert result.uncertainty


def test_non_memorabilia_skips_model_entirely():
    settings = Settings(patch_color_intelligence_enabled=True)
    result = asyncio.run(
        analyze_specimen_attributes(
            b"not-an-image-and-should-never-be-decoded",
            None,
            CardIdentity(player="Normal Base Card", memorabilia=False),
            settings,
        )
    )

    assert result.status == "not_applicable"
    assert result.patch_color_count is None
    assert result.identity_fields_mutated is False


def test_specimen_attributes_round_trip_separately_from_checklist(tmp_path):
    store = MemoryStore(tmp_path / "instacomp.sqlite3")
    store.initialize()
    specimen = SpecimenAttributes(
        status="observed",
        patch_color_count=2,
        patch_colors=["black", "gold"],
        observation_confidence=0.98,
        title_suffix="2 Color Patch",
        description_note="Observed memorabilia patch colors: Black and Gold.",
    )
    store.save_scan(
        scan_id="11111111-1111-4111-8111-111111111111",
        card_uuid="11111111-1111-4111-8111-111111111111",
        created_at=datetime.now(timezone.utc),
        front_sha256="front",
        back_sha256="back",
        image_pair_sha256="pair",
        local_suggestion=None,
        local_vision=None,
        specimen_attributes=specimen.model_dump(mode="json"),
        checklist={"outcome": "exact_match", "identity_id": "registry:1"},
        status="trusted_memory_match",
    )

    saved = store.get_scan("11111111-1111-4111-8111-111111111111")
    assert saved is not None
    assert saved["checklist"]["identity_id"] == "registry:1"
    assert saved["specimen_attributes"]["patch_color_count"] == 2
    assert saved["specimen_attributes"]["identity_fields_mutated"] is False


def test_cloudflare_parser_accepts_underscore_prose_and_zero_percent_uncertainty():
    raw = _parse_cloudflare_specimen(
        """
        Answer: patch_color_count: 3, patch_colors: white, blue, red,
        observation_confidence: 1, uncertainty: 0%
        """
    )
    assert raw.patch_color_count == 3
    assert raw.patch_colors == ["white", "blue", "red"]
    assert raw.observation_confidence == 1
    assert raw.uncertainty == []


def test_cloudflare_parser_accepts_markdown_patch_labels():
    raw = _parse_cloudflare_specimen(
        """
        **Patch Color Count:** 2
        **Patch Colors:** Red and Blue
        **Observation Confidence:** 100%
        **Uncertainty:** 0%
        """
    )
    assert raw.patch_color_count == 2
    assert raw.patch_colors == ["red", "blue"]
    assert raw.observation_confidence == 1
    assert raw.uncertainty == []
