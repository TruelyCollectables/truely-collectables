from pathlib import Path

from app.kingmaker_commercial_inventory import KingmakerCommercialInventory


def received_metadata():
    return {
        "sourceAuthority": "mac_local",
        "listingReviewRequired": True,
        "scanId": "scan-123",
        "cardUuid": "card-123",
        "registryIdentityId": "registry-123",
        "registryFingerprintSha256": "fingerprint-123",
        "frontImageUrl": "/front",
        "backImageUrl": "/back",
        "identity": {
            "year": "2025",
            "manufacturer": "Panini",
            "brand": "Select",
            "product": "Select WNBA",
            "set_name": "Base Set - Concourse",
            "player": "Saniya Rivers",
            "card_number": "52",
            "parallel": "Set - Concourse - Tie-Dye",
            "serial_number": "06/25",
            "serial_run": 25,
            "sport": "Basketball",
            "league": "WNBA",
        },
    }


def test_received_identity_is_projected_into_instacomp_pending_shape(tmp_path: Path):
    store = KingmakerCommercialInventory(tmp_path / "commercial.sqlite3")
    created = store.create_local_draft(
        {
            "inventoryItemId": "card-123",
            "title": "Saniya Rivers Tie-Dye",
            "player": "Saniya Rivers",
            "sport": "Basketball",
            "metadata": received_metadata(),
        }
    )

    metadata = created["metadata"]
    ai = metadata["instacomp"]["ai"]
    assert ai["player"] == "Saniya Rivers"
    assert ai["cardNumber"] == "52"
    assert ai["setName"] == "Base Set - Concourse"
    assert ai["checklistParallel"] == "Set - Concourse - Tie-Dye"
    assert ai["serialNumber"] == "06/25"
    assert ai["serialRun"] == 25
    assert metadata["instacomp"]["scanId"] == "scan-123"
    assert metadata["instacomp"]["cardUuid"] == "card-123"
    assert metadata["instacomp"]["identityComplete"] is True
    assert metadata["instacomp"]["trustedForIdentity"] is True
    assert metadata["instacomp"]["checklistIdentity"]["identityId"] == "registry-123"
    assert metadata["listingReviewRequired"] is False
    assert metadata["listingWorkflow"]["queue"] == "pending_listings"
    assert metadata["pending_verification"]["status"] == "resolved"
    assert metadata["collectible_asset"]["parallel_name"] == "Set - Concourse - Tie-Dye"
    assert metadata["collectible_asset"]["exact_serial_number"] == "06/25"


def test_existing_received_draft_is_repaired_on_local_edit(tmp_path: Path):
    store = KingmakerCommercialInventory(tmp_path / "commercial.sqlite3")
    raw = received_metadata()
    # Simulate the old broken shape that carried only metadata.identity.
    store.initialize()
    store.create_local_draft(
        {
            "inventoryItemId": "card-123",
            "title": "Saniya Rivers Tie-Dye",
            "metadata": {"legacy": True},
        }
    )
    updated = store.apply_local_edit(
        "card-123",
        {"metadata": raw, "status": "draft"},
        synced_to_ebay=False,
    )
    ai = updated["metadata"]["instacomp"]["ai"]
    assert ai["player"] == "Saniya Rivers"
    assert ai["cardNumber"] == "52"
    assert updated["metadata"]["instacomp"]["identityComplete"] is True


def test_exact_image_pair_lookup_uses_persisted_instacomp_hash(tmp_path: Path):
    store = KingmakerCommercialInventory(tmp_path / "commercial.sqlite3")
    store.create_local_draft(
        {
            "inventoryItemId": "pair-card-1",
            "title": "Exact pair lookup",
            "metadata": {
                "instacomp": {
                    "imagePairSha256": "pair-hash-123",
                    "source": "kingmaker_mac_scan",
                }
            },
        }
    )

    matched = store.find_by_image_pair_sha256("pair-hash-123")
    assert matched is not None
    assert matched["inventoryItemId"] == "pair-card-1"
    assert store.find_by_image_pair_sha256("missing-pair") is None


def test_unverified_auto_manual_lock_cannot_bypass_registry_verification():
    from app.kingmaker_commercial_inventory import _master_listing_queue

    metadata = {
        "seller_review": {"identity_confirmed": False},
        "instacomp": {
            "frontImageUrl": "/front",
            "backImageUrl": "/back",
            "imageOrientation": {"status": "completed"},
            "imageOrientationPersisted": True,
            "imagePersistenceVerified": True,
            "manualIdentityLocked": True,
            "identityComplete": True,
            "trustedForIdentity": True,
            "humanVerified": False,
            "checklistDecision": {"status": "verified"},
        },
    }
    assert _master_listing_queue(metadata) == "verification"


def test_true_human_manual_lock_can_still_reach_listings():
    from app.kingmaker_commercial_inventory import _master_listing_queue

    metadata = {
        "instacomp": {
            "frontImageUrl": "/front",
            "backImageUrl": "/back",
            "imageOrientation": {"status": "completed"},
            "imageOrientationPersisted": True,
            "imagePersistenceVerified": True,
            "manualIdentityLocked": True,
            "identityComplete": True,
            "humanVerified": True,
        },
    }
    assert _master_listing_queue(metadata) == "listings"


def test_current_mac_registry_receipt_is_authoritative_for_queue_and_group():
    from app.kingmaker_commercial_inventory import (
        _effective_pricing_group_key,
        _master_listing_queue,
    )

    metadata = {
        "seller_review": {"identity_confirmed": False},
        "instacomp": {
            "frontImageUrl": "/front",
            "backImageUrl": "/back",
            "imageOrientation": {"status": "completed"},
            "imageOrientationPersisted": True,
            "imagePersistenceVerified": True,
            "manualIdentityLocked": True,
            "identityComplete": True,
            "humanVerified": False,
            "manualIdentity": {
                "year": "2025",
                "player": "Wrong Player",
                "cardNumber": "999",
                "parallel": "Wrong Parallel",
            },
            "macReceipt": {
                "status": "trusted_memory_match",
                "checklistOutcome": "exact_match",
                "registryIdentityId": "registry-current",
                "registryFingerprintSha256": "fingerprint-current",
                "checklistIdentity": {
                    "year": "2025",
                    "player": "Aneesah Morrow",
                    "card_number": "79",
                    "parallel": "Prizms Orange Velocity",
                },
            },
        },
    }
    assert _master_listing_queue(metadata) == "listings"
    assert _effective_pricing_group_key(metadata) == "fingerprint-current"
    metadata["instacomp"]["imageOrientation"]["status"] = "review_required"
    assert _master_listing_queue(metadata) == "verification"


def test_mac_registry_receipt_is_projected_into_standard_exact_identity_shape():
    from app.kingmaker_commercial_inventory import _normalize_local_pending_metadata

    metadata = {
        "instacomp": {
            "cardUuid": "physical-card-1",
            "macReceipt": {
                "scanId": "scan-current",
                "status": "trusted_memory_match",
                "checklistOutcome": "exact_match",
                "registryIdentityId": "registry-current",
                "registryFingerprintSha256": "fingerprint-current",
                "checklistIdentity": {
                    "year": "2025",
                    "manufacturer": "Panini",
                    "brand": "Prizm",
                    "set_name": "Base",
                    "player": "Aneesah Morrow",
                    "card_number": "79",
                    "parallel": "Prizms Orange Velocity",
                    "team": "Connecticut Sun",
                    "sport": "Basketball",
                    "league": "WNBA",
                },
            },
        },
    }
    normalized = _normalize_local_pending_metadata(
        metadata, inventory_item_id="physical-card-1"
    )
    instacomp = normalized["instacomp"]
    assert instacomp["identityComplete"] is True
    assert instacomp["trustedForIdentity"] is True
    assert instacomp["registryIdentityId"] == "registry-current"
    assert instacomp["registryFingerprintSha256"] == "fingerprint-current"
    assert instacomp["checklistDecision"]["status"] == "exact_match"
    assert instacomp["ai"]["player"] == "Aneesah Morrow"
    assert instacomp["ai"]["cardNumber"] == "79"


def test_registry_id_without_fingerprint_cannot_become_exact_identity():
    from app.kingmaker_commercial_inventory import _normalize_local_pending_metadata

    metadata = {
        "registryIdentityId": "registry-no-fingerprint",
        "identity": {
            "year": "2025",
            "player": "Aneesah Morrow",
            "card_number": "79",
        },
    }
    normalized = _normalize_local_pending_metadata(metadata)
    assert normalized["instacomp"]["identityComplete"] is False
    assert normalized["instacomp"]["trustedForIdentity"] is False
