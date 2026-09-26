from pathlib import Path

from app.kingmaker_commercial_inventory import KingmakerCommercialInventory


def row(
    inventory_id: str,
    *,
    group_key: str,
    folder: str = "website",
    queue: str = "listings",
    quantity: int = 1,
    status: str = "draft",
):
    projection = {
        "websiteActive": folder in {"website", "both", "website_mercari", "all3"},
        "ebayActive": folder in {"ebay", "both", "ebay_mercari", "all3"},
        "mercariActive": folder in {"mercari", "website_mercari", "ebay_mercari", "all3"},
    }
    insta = {
        "source": "mac_registry_scanner",
        "scanId": f"scan-{inventory_id}",
        "frontImageUrl": f"https://example.test/{inventory_id}-front.jpg",
        "backImageUrl": f"https://example.test/{inventory_id}-back.jpg",
        "imagePairSha256": f"pair-{inventory_id}",
        "pricingGroupKey": group_key,
        "identityComplete": True,
        "manualIdentityLocked": queue == "listings",
        "imageOrientation": {"status": "completed"},
        "imageOrientationPersisted": True,
        "imagePersistenceVerified": True,
    }
    return {
        "id": inventory_id,
        "title": f"Card {inventory_id}",
        "status": status,
        "quantity": quantity,
        "price": 10.0,
        "updated_at": "2026-09-26T15:00:00Z",
        "metadata": {
            "instacomp": insta,
            "master_listing_projection": projection,
        },
    }


def test_projection_groups_exact_copies_and_keeps_counts_in_sql(tmp_path: Path):
    inventory = KingmakerCommercialInventory(tmp_path / "commercial.sqlite3")
    items = [
        row("copy-a", group_key="same-card", folder="website"),
        row("copy-b", group_key="same-card", folder="website"),
        row("combo", group_key="combo-card", folder="both"),
        row("pending", group_key="pending-card", folder="pending"),
    ]
    result = inventory.project_master_listings(items, replace=True)
    assert result["folderCounts"]["website"] == 1
    assert result["folderCounts"]["both"] == 1
    assert result["folderCounts"]["pending"] == 1
    assert result["queueCounts"]["listings"] == 1

    with inventory._read_connect() as db:
        columns = {
            str(r[1]) for r in db.execute("PRAGMA table_info(master_listing_projection)")
        }
        assert "group_key" in columns
        grouped = db.execute(
            "SELECT COUNT(DISTINCT group_key) FROM master_listing_projection WHERE folder='website'"
        ).fetchone()[0]
        assert grouped == 1


def test_archived_or_zero_quantity_rows_are_removed_from_projection(tmp_path: Path):
    inventory = KingmakerCommercialInventory(tmp_path / "commercial.sqlite3")
    inventory.project_master_listings(
        [row("card-a", group_key="card-a", folder="website")],
        replace=True,
    )
    assert inventory.list_master_listing_projection(folder="website")["count"] == 1

    inventory.project_master_listings(
        [row("card-a", group_key="card-a", folder="website", quantity=0)]
    )
    assert inventory.list_master_listing_projection(folder="website")["count"] == 0
