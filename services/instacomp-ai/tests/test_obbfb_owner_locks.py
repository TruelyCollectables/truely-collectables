"""OBBFB regression: temporary Mac-local SQLite, no production inventory mutations."""
import sys
import tempfile
import unittest
import types
import os
import importlib.util
from pathlib import Path

service_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(service_root))
# Import the inventory layer without importing optional CV2/teacher vision runtime.
module = types.ModuleType("app")
module.__path__ = [str(service_root / "app")]
sys.modules.setdefault("app", module)
# The verified CSV parser imports optional native imaging libraries. These
# isolated OBBFB tests exercise the SQLite owner-lock layer only; its unrelated
# CSV image guard is a no-op in the in-memory test module, never in production.
csv_stub = types.ModuleType("app.verified_csv_intake")
csv_stub.install_guards = lambda db: None
sys.modules.setdefault("app.verified_csv_intake", csv_stub)
if os.environ.get("OBBFB_TEST_INVENTORY_MODULE"):
    spec = importlib.util.spec_from_file_location(
        "app.kingmaker_commercial_inventory",
        os.environ["OBBFB_TEST_INVENTORY_MODULE"],
    )
    assert spec is not None and spec.loader is not None
    inventory_module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = inventory_module
    spec.loader.exec_module(inventory_module)
    KingmakerCommercialInventory = inventory_module.KingmakerCommercialInventory
else:
    from app.kingmaker_commercial_inventory import KingmakerCommercialInventory


class OBBFBOwnerLockTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="obbfb-sqlite-")
        self.addCleanup(self.tmp.cleanup)
        self.catalog = KingmakerCommercialInventory(Path(self.tmp.name) / "database" / "kingmaker_commercial_inventory.sqlite3")
        self.catalog.initialize()
        self.identifier = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        self.base_metadata = {
            "instacomp": {
                "intakeEngine": "obbfb_direct_vision_v1",
                "source": "obbfb_direct_vision_v1",
                "ai": {"year": "2024", "brandSet": "Prizm", "player": "Jane Doe", "cardNumber": "94"},
                "identityComplete": True,
                "frontImageUrl": "/front.jpg", "backImageUrl": "/back.jpg",
                "imageOrientation": {"status": "completed"},
                "imagePersistenceVerified": True,
                "listingPublishBlocked": True,
                "manualIdentityLocked": False,
                "sellerPriceOverride": False,
            },
            "listingWorkflow": {"queue": "pending_listings", "publishAllowed": False},
            "seller_review": {"identity_confirmed": False},
        }
    def make_draft(self):
        return self.catalog.create_local_draft({
            "inventoryItemId": self.identifier,
            "title": "2024 Prizm Jane Doe #94 /99",
            "description": "Exact serial 09/99",
            "sku": "KM-test-obbfb", "category": "Trading Card Singles",
            "price": 14.99, "metadata": self.base_metadata,
        })

    def test_create_projects_pending_without_registry(self):
        self.make_draft()
        self.catalog.project_master_listings([self.catalog.get_item(self.identifier)])
        pending = self.catalog.list_master_listing_projection(folder="pending", pending_queue="listings")
        self.assertTrue(any(str(i.get("id") or i.get("inventoryItemId")) == self.identifier for i in pending["items"]))

    def test_duplicate_uuid_does_not_overwrite(self):
        self.make_draft()
        with self.assertRaisesRegex(ValueError, "OBBFB_DUPLICATE_CARD_UUID"):
            self.make_draft()
        self.assertEqual(self.catalog.get_item(self.identifier)["price"], 14.99)

    def test_locked_owner_price_resists_sweeps_and_projection(self):
        self.make_draft()
        item = self.catalog.get_item(self.identifier)
        locked = item["metadata"]
        locked["instacomp"].update({
            "manualIdentityLocked": True, "sellerPriceOverride": True,
            "manualListingTitleLocked": True, "humanVerified": True,
            "manualIdentity": {
                "year": "2024", "brandSet": "Prizm", "player": "Jane Doe",
                "cardNumber": "94", "serialNumber": "09/99"
            },
        })
        edited = self.catalog.apply_local_edit(self.identifier, {
            "title": "Owner 2024 Prizm Jane Doe #94 /99",
            "price": 39.99, "metadata": locked, "obbfbOperatorSave": True,
        }, synced_to_ebay=False)
        self.assertEqual(edited["price"], 39.99)
        with self.assertRaisesRegex(ValueError, "OBBFB_OPERATOR_LOCKED"):
            self.catalog.apply_local_edit(self.identifier, {"price": 2.99}, synced_to_ebay=False)
        self.catalog.project_master_listings([{
            "inventoryItemId": self.identifier, "title": "Cloud overwrite",
            "price": 1.99, "status": "draft", "quantity": 1, "metadata": self.base_metadata,
        }])
        self.assertEqual(self.catalog.get_item(self.identifier)["price"], 39.99)
        self.catalog.absorb_ebay_snapshot([{
            "inventoryItemId": self.identifier, "ebayItemId": "317010101010",
            "sku": "KM-test-obbfb", "title": "Overwrite", "price": 1.99,
            "status": "active", "quantity": 1, "metadata": self.base_metadata,
        }])
        self.assertEqual(self.catalog.get_item(self.identifier)["price"], 39.99)
        self.assertEqual(self.catalog.get_item(self.identifier)["title"], "Owner 2024 Prizm Jane Doe #94 /99")

    def test_master_update_operator_lock_flow(self):
        self.make_draft()
        self.catalog.project_master_listings([self.catalog.get_item(self.identifier)])
        item = self.catalog.get_item(self.identifier)
        metadata = item["metadata"]
        metadata["instacomp"].update({
            "manualIdentityLocked": True, "sellerPriceOverride": True,
            "manualListingTitleLocked": True, "humanVerified": True,
            "manualIdentity": {"year": "2024", "brandSet": "Prizm", "player": "Jane Doe",
                               "cardNumber": "94", "serialNumber": "09/99"},
        })
        changed = self.catalog.apply_master_listing_edit(self.identifier, {
            "title": "Operator Prizm Jane Doe #94 /99",
            "description": "Serial 09/99, seller approved.",
            "price": 25.99, "metadata": metadata,
            "obbfbOperatorSave": True,
        })
        self.assertEqual(changed["price"], 25.99)
        self.assertEqual(self.catalog.get_item(self.identifier)["price"], 25.99)
        with self.assertRaisesRegex(ValueError, "OBBFB_OPERATOR_LOCKED"):
            self.catalog.apply_master_listing_edit(self.identifier, {"price": 1.99})
        self.assertEqual(self.catalog.get_master_listing_projection(self.identifier)["price"], 25.99)

    def test_need_to_merge_routing(self):
        draft = self.make_draft()
        md = draft["metadata"]
        md["listingWorkflow"]["queue"] = "need_to_merge"
        self.catalog.apply_local_edit(self.identifier, {"metadata": md}, synced_to_ebay=False)
        row = self.catalog.get_item(self.identifier)
        self.catalog.project_master_listings([row])
        listing = self.catalog.get_master_listing_projection(self.identifier)
        self.assertIsNotNone(listing)
        summary = self.catalog.master_listing_projection_summary()
        self.assertGreaterEqual(summary["queueCounts"].get("need_to_merge", 0), 1)

if __name__ == "__main__":
    unittest.main()
