from pathlib import Path

from app.local_registry_store import LocalRegistryStore


def _entry(*, identity_id: str, fingerprint: str, release_id: str, league: str):
    return {
        "identity_id": identity_id,
        "fingerprint_sha256": fingerprint,
        "source_sha256": f"source-{identity_id}",
        "release_id": release_id,
        "version_id": "v1",
        "set_id": "set1",
        "card_id": "card42",
        "normalized_card_number": "42",
        "manufacturer": "Panini",
        "brand": "Prizm",
        "product": "Prizm WNBA",
        "player": "Julie Vanloo",
        "year": "2024",
        "set_name": "Base",
        "card_number": "42",
        "parallel": "Blue",
        "variation": None,
        "serial_run": 199,
        "team": "Washington Mystics",
        "sport": "Basketball",
        "league": league,
        "language_code": None,
        "configuration_exclusivity": None,
        "is_auto": 0,
        "is_relic": 0,
        "source_label": "InstaComp Mac Registry",
        "score": 100,
        "matched_evidence_json": "[]",
        "active": 1,
    }


def test_prizm_product_hint_does_not_discard_base_subset_and_wnba_wins(tmp_path: Path):
    store = LocalRegistryStore(tmp_path / "registry.sqlite3", tmp_path)
    store.initialize()
    with store.connection() as db:
        store.upsert_semantic_entry(
            db,
            _entry(
                identity_id="clean-wnba",
                fingerprint="clean-fp",
                release_id="release:clean-wnba",
                league="WNBA",
            ),
        )
        store.upsert_semantic_entry(
            db,
            _entry(
                identity_id="stale-nba",
                fingerprint="stale-fp",
                release_id="release:stale-nba",
                league="NBA",
            ),
        )

    result = store.resolve(
        {
            "year": "2024",
            "manufacturer": "Panini",
            "brand": "Prizm",
            "setName": "Prizm",
            "cardNumber": "42",
            "player": "Julie Vanloo",
            "sport": "Basketball",
            "league": "WNBA",
            "serialNumber": "/199",
            "parallel": "Blue Prizm",
        }
    )

    assert result["status"] == "internal_exact_match"
    assert result["match"]["identityId"] == "clean-wnba"
    assert result["match"]["fingerprintSha256"] == "clean-fp"
    assert result["match"]["serialRun"] == 199
