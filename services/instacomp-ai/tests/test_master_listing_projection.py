from pathlib import Path

from app.kingmaker_commercial_inventory import KingmakerCommercialInventory


def row(
    inventory_id: str,
    *,
    player: str,
    folder_flags: dict[str, bool] | None = None,
    exact_serial: str | None = None,
    verification: bool = False,
):
    identity = {
        "year": "2025",
        "manufacturer": "Panini",
        "product": "Prizm WNBA",
        "player": player,
        "cardNumber": "149",
        "parallel": "Green",
    }
    instacomp = {
        "source": "kingmaker_mac_scan",
        "scanId": f"scan-{inventory_id}",
        "imagePairSha256": f"pair-{inventory_id}",
        "manualIdentity": identity,
        "manualIdentityLocked": not verification,
        "identityComplete": not verification,
        "trustedForIdentity": not verification,
        "frontImageUrl": f"front-{inventory_id}",
        "backImageUrl": f"back-{inventory_id}",
        "imageOrientation": {"status": "completed" if not verification else "review_required"},
        "imageOrientationPersisted": not verification,
        "imagePersistenceVerified": True,
    }
    metadata = {
        "instacomp": instacomp,
        "master_listing_projection": folder_flags or {},
        "collectible_asset": {
            "exact_serial_number": exact_serial,
        },
    }
    return {
        "id": inventory_id,
        "status": "draft",
        "quantity": 1,
        "title": f"{player} test",
        "metadata": metadata,
        "updated_at": "2026-09-26T12:00:00Z",
    }


def test_master_listing_projection_counts_commercial_groups(tmp_path: Path):
    db = KingmakerCommercialInventory(tmp_path / "commercial.sqlite3")
    rows = [
        row("web-a", player="Kiki Iriafen", folder_flags={"websiteActive": True}),
        row("web-b", player="Kiki Iriafen", folder_flags={"websiteActive": True}),
        row("both-a", player="Aneesah Morrow", folder_flags={"websiteActive": True, "ebayActive": True}, exact_serial="001/25"),
        row("both-b", player="Aneesah Morrow", folder_flags={"websiteActive": True, "ebayActive": True}, exact_serial="002/25"),
        row("pending-a", player="Sarah Ashlee Barker"),
        row("pending-b", player="Sarah Ashlee Barker"),
        row("verify-a", player="Dominique Malonga", verification=True),
    ]

    result = db.project_master_listings(rows, replace=True)

    assert result["sourceAuthority"] == "mac_local_sqlite"
    assert result["total"] == 7
    assert result["folderCounts"]["website"] == 1
    assert result["folderCounts"]["both"] == 2
    assert result["folderCounts"]["pending"] == 1
    assert result["queueCounts"] == {"listings": 2, "verification": 1}

    website = db.list_master_listing_projection(folder="website", compact=True)
    assert website["count"] == 2
    assert website["folderCounts"]["website"] == 1

    verification = db.list_master_listing_projection(
        folder="pending",
        pending_queue="verification",
        compact=True,
    )
    assert verification["count"] == 1
    assert verification["queueCounts"]["verification"] == 1


def test_master_listing_projection_replace_removes_stale_rows(tmp_path: Path):
    db = KingmakerCommercialInventory(tmp_path / "commercial.sqlite3")
    db.project_master_listings(
        [row("old", player="Old Card", folder_flags={"websiteActive": True})],
        replace=True,
    )
    result = db.project_master_listings(
        [row("new", player="New Card", folder_flags={"ebayActive": True})],
        replace=True,
    )

    assert result["total"] == 1
    assert result["folderCounts"]["website"] == 0
    assert result["folderCounts"]["ebay"] == 1
    listed = db.list_master_listing_projection(compact=True)
    assert [item["id"] for item in listed["items"]] == ["new"]
