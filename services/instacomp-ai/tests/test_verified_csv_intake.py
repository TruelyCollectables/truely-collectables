import csv
import io
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import pytest
from PIL import Image
from app.kingmaker_commercial_inventory import KingmakerCommercialInventory
from app.verified_csv_intake import VerifiedCsvIntake, HEADERS

def photo(color):
    stream=io.BytesIO()
    Image.new("RGB",(32,48),color).save(stream,format="PNG")
    return stream.getvalue()

def card(**changes):
    result={key:"" for key in HEADERS}
    result.update(schema_version="1",external_id="test-card-001",year="2025",manufacturer="Panini",product="Select",card_number="007",player="Verified Player",sport="Basketball",parallel="Base",autograph="false",memorabilia="false",patch="false",rookie="false",condition="Near Mint or Better",front_image="front.png",back_image="back.png")
    result.update(changes)
    return result

def csv_text(rows):
    stream=io.StringIO()
    writer=csv.DictWriter(stream,fieldnames=HEADERS)
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue()

@pytest.fixture
def intake(tmp_path):
    inventory=KingmakerCommercialInventory(tmp_path/"inventory.sqlite3")
    inventory.initialize()
    return VerifiedCsvIntake(inventory,source_roots=[tmp_path/"inbox"])

def preview(intake,rows=None,**kw):
    return intake.preview(csv_text(rows or [card()]),"seller-a",kw.get("uploads",{"front.png":photo("red"),"back.png":photo("blue")}))

def imported(intake):
    p=preview(intake)
    receipt=intake.commit(p["token"],"seller-a")
    return receipt["inventoryItemIds"][0]

def test_preview_then_import_queue_and_replay(intake):
    p=preview(intake,[card(player="Player, Jr.",serial_number="06/25",print_run="25",parallel="Tie-Dye")])
    assert p["counts"]==dict(total=1,ready=1,duplicate=0,error=0)
    assert not intake.inventory.list_items()
    receipt=intake.commit(p["token"],"seller-a")
    assert receipt["imported"]==1 and receipt["verificationRequired"]==0
    item=intake.inventory.get_item(receipt["inventoryItemIds"][0])
    assert item["metadata"]["instacomp"]["ai"]["cardNumber"]=="007"
    assert item["metadata"]["instacomp"]["ai"]["serialNumber"]=="06/25"
    assert item["metadata"]["instacomp"]["ai"]["confidence"]==1.0
    assert item["metadata"]["listingWorkflow"]["queue"]=="pending_listings"
    assert intake.inventory.get_master_listing_projection(item["inventoryItemId"]) is not None
    assert intake.inventory.list_master_listing_projection(folder="pending",pending_queue="listings")["items"]
    assert intake.commit(p["token"],"seller-a")==receipt

@pytest.mark.parametrize("change,field",[
    ({"year":"bad"},"year"),
    ({"serial_number":"26/25","print_run":"25"},"serial_number"),
    ({"serial_number":"06/25","print_run":"99"},"print_run"),
    ({"patch":"true"},"patch"),
    ({"autograph":"yes"},"autograph"),
    ({"grading_company":"PSA"},"Slabs"),
    ({"schema_version":"2"},"schema_version"),
    ({"autograph":"true"},"autograph_type"),
    ({"memorabilia":"true"},"memorabilia_type"),
    ({"autograph_type":"sticker"},"autograph_type"),
])
def test_actionable_validation(intake,change,field):
    p=preview(intake,[card(**change)])
    assert p["counts"]["error"]==1
    assert field in p["rows"][0]["errors"][0]
    with pytest.raises(ValueError):
        intake.commit(p["token"],"seller-a")
    assert intake.inventory.list_items()==[]

def test_batch_atomic_and_duplicate_ids(intake):
    p=preview(intake,[card(),card(external_id="bad",year="oops")])
    with pytest.raises(ValueError):
        intake.commit(p["token"],"seller-a")
    assert intake.inventory.list_items()==[]
    assert preview(intake,[card(),card()])["counts"]["error"]==1

def test_same_images_rejected(intake):
    p=preview(intake,uploads={"front.png":photo("red"),"back.png":photo("red")})
    assert "identical" in p["rows"][0]["errors"][0]

def test_invalid_image_and_missing(intake):
    assert preview(intake,uploads={"front.png":b"fake","back.png":photo("blue")})["counts"]["error"]==1
    assert preview(intake,[card(front_image="missing.png")])["counts"]["error"]==1

def test_new_preview_duplicate_and_conflict(intake):
    imported(intake)
    assert preview(intake)["counts"]["duplicate"]==1
    assert preview(intake,[card(player="Wrong player")])["counts"]["error"]==1
    assert preview(intake,[card(external_id="different")])["counts"]["error"]==1

def test_concurrent_commit_idempotency(intake):
    p=preview(intake)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:intake.commit(p["token"],"seller-a"),range(2)))
    assert results[0]==results[1]
    assert len(intake.inventory.list_items())==1

@pytest.mark.parametrize("field,value",[
    ("title","Wrong"),("imageUrl","https://wrong/image.jpg"),("player","Wrong"),("sku","different"),("sport","Football"),("condition","Damaged"),("category","other")
])
def test_local_identity_update_blocked(intake,field,value):
    item_id=imported(intake)
    before=intake.inventory.get_item(item_id)
    with pytest.raises(sqlite3.IntegrityError,match="VERIFIED_CSV_IMMUTABLE"):
        intake.inventory.apply_local_edit(item_id,{field:value},False)
    assert intake.inventory.get_item(item_id)==before

@pytest.mark.parametrize("field",["ai","manualIdentity","frontImageUrl","backImageUrl","frontSha256","backSha256","humanVerified","manualIdentityLocked"])
def test_nested_fields_and_unlock_blocked(intake,field):
    item_id=imported(intake)
    item=intake.inventory.get_item(item_id)
    metadata=item["metadata"]
    metadata["instacomp"][field]="evil"
    with pytest.raises(sqlite3.IntegrityError):
        intake.inventory.apply_local_edit(item_id,{"metadata":metadata},False)

def test_direct_sql_bulk_and_replace_blocked(intake):
    item_id=imported(intake)
    with intake.inventory._connect() as db:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE commercial_inventory SET raw_json='{}'")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("DELETE FROM commercial_inventory WHERE inventory_item_id=?",(item_id,))
    with pytest.raises(sqlite3.IntegrityError):
        intake.inventory.create_local_draft({"inventoryItemId":item_id,"title":"AI overwrite"})

def test_pricing_lifecycle_allowed(intake):
    item_id=imported(intake)
    item=intake.inventory.get_item(item_id)
    metadata=item["metadata"]
    metadata["instacomp"]["marketPrice"]=30
    updated=intake.inventory.apply_local_edit(item_id,{"price":30,"metadata":metadata},False)
    assert updated["price"]==30
    assert updated["metadata"]["verifiedCsv"]==item["metadata"]["verifiedCsv"]
    assert intake.inventory.apply_local_edit(item_id,{"status":"archived"},False)["status"]=="archived"

def test_master_bulk_sync_preserves_truth(intake):
    item_id=imported(intake)
    intake.inventory.project_master_listings([{"id":item_id,"status":"draft","quantity":1,"title":"AI wrong","metadata":{"instacomp":{"ai":{"player":"Wrong"}}}}],replace=True)
    row=intake.inventory.get_master_listing_projection(item_id,compact=False)
    assert row["title"]!="AI wrong"
    assert row["metadata"]["instacomp"]["ai"]["player"]=="Verified Player"
    with pytest.raises(sqlite3.IntegrityError):
        intake.inventory.apply_master_listing_edit(item_id,{"title":"Wrong"})
    assert intake.inventory.get_master_listing_projection(item_id)["title"]!="Wrong"

def test_lessons_append_only_audited_and_separate(intake):
    item_id=imported(intake)
    before=intake.inventory.get_item(item_id)
    result=intake.feedback(item_id,"seller-a",{"player":"AI guessed wrong","autograph":True},"student-v1","scan-1")
    assert result["disagreements"]["player"]["verified"]=="Verified Player"
    assert intake.feedback(item_id,"seller-a",{"player":"AI guessed wrong","autograph":True},"student-v1","scan-1")==result
    with pytest.raises(ValueError):
        intake.feedback(item_id,"seller-a",{"player":"changed"},"student-v1","scan-1")
    with pytest.raises(ValueError):
        intake.feedback(item_id,"seller-b",{"player":"wrong"},"model","scan")
    for _ in range(2):
        lessons=intake.lessons("seller-a","replay-1")
        assert lessons["count"]==1 and not lessons["productionModified"]
    with intake.inventory._connect() as db:
        assert db.execute("SELECT count(*) FROM verified_csv_replays").fetchone()[0]==1
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE verified_csv_feedback SET verified_json='{}'")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("DELETE FROM verified_csv_feedback")
    assert intake.inventory.get_item(item_id)==before

def test_image_integrity_and_owner(intake):
    item_id=imported(intake)
    path=intake.image_path("seller-a","front",item_id)
    with pytest.raises(ValueError):
        intake.image_path("seller-b","front",item_id)
    path.chmod(0o644)
    path.write_bytes(b"tampered")
    with pytest.raises(ValueError,match="integrity"):
        intake.image_path("seller-a","front",item_id)

def test_path_traversal_and_private_url(intake,tmp_path):
    p=tmp_path/"secret.png"
    p.write_bytes(photo("green"))
    assert preview(intake,[card(front_image=str(p))])["counts"]["error"]==1
    assert preview(intake,[card(front_image="https://127.0.0.1/secret.png")])["counts"]["error"]==1
    assert preview(intake,[card(front_image="http://example.com/front.png")])["counts"]["error"]==1

def test_schema_bom_unknown_duplicate_and_malformed(intake):
    assert intake.preview("\ufeff"+csv_text([card()]),"seller-a",{"front.png":photo("red"),"back.png":photo("blue")})["canImport"]
    with pytest.raises(ValueError,match="Duplicate"):
        intake.parse("year,year\n2025,2025\n")
    with pytest.raises(ValueError,match="unsupported"):
        intake.parse(csv_text([card()]).replace("schema_version,","unknown,"))
    with pytest.raises(ValueError,match="Malformed"):
        intake.parse(csv_text([card()]).splitlines()[0]+'\n"unclosed')


def test_sql_replace_and_master_projection_blocked(intake):
    item_id=imported(intake)
    before=intake.inventory.get_item(item_id)
    with intake.inventory._connect() as db:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT OR REPLACE INTO commercial_inventory SELECT * FROM commercial_inventory WHERE inventory_item_id=?",(item_id,))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE master_listing_projection SET row_json=json_set(row_json,'$.metadata.instacomp.ai.player','Wrong') WHERE inventory_item_id=?",(item_id,))
    assert intake.inventory.get_item(item_id)==before

def test_full_authenticated_http_flow(intake):
    from fastapi import FastAPI, APIRouter, Depends, Header, HTTPException
    from fastapi.testclient import TestClient
    from app.verified_csv_intake import attach_verified_csv_routes
    def authenticate(x_test_key: str = Header(default="")):
        if x_test_key != "isolated-test-only":
            raise HTTPException(status_code=401)
    app=FastAPI()
    router=APIRouter(prefix="/v1/kingmaker/accounting",dependencies=[Depends(authenticate)])
    attach_verified_csv_routes(router,intake.inventory)
    app.include_router(router)
    client=TestClient(app)
    base="/v1/kingmaker/accounting/verified-csv/"
    assert client.post(base+"commit",json={"owner_id":"seller-a","token":"x"}).status_code==401
    auth={"x-test-key":"isolated-test-only"}
    response=client.post(base+"preview",headers=auth,data={"owner_id":"seller-a"},files=[("csv_file",("cards.csv",csv_text([card()]),"text/csv")),("images",("front.png",photo("red"),"image/png")),("images",("back.png",photo("blue"),"image/png"))])
    assert response.status_code==200, response.text
    token=response.json()["token"]
    commit=client.post(base+"commit",headers=auth,json={"owner_id":"seller-a","token":token})
    assert commit.status_code==200, commit.text
    item_id=commit.json()["inventoryItemIds"][0]
    image=client.get(base+"image",headers=auth,params={"owner_id":"seller-a","inventory_item_id":item_id,"side":"front"})
    assert image.status_code==200 and image.content==photo("red")
    assert client.get(base+"image",headers=auth,params={"owner_id":"seller-b","inventory_item_id":item_id,"side":"back"}).status_code==404
    feedback=client.post(base+"feedback",headers=auth,json={"owner_id":"seller-a","inventory_item_id":item_id,"prediction":{"player":"Wrong"},"model_version":"isolated-v1","source_event_id":"scan-1"})
    assert feedback.status_code==200
    replay=client.post(base+"replay",headers=auth,json={"owner_id":"seller-a","token":"replay-1"})
    assert replay.status_code==200 and replay.json()["count"]==1 and not replay.json()["productionModified"]
    assert client.post(base+"commit",headers=auth,json={"owner_id":"seller-b","token":token}).status_code==409

def test_local_inbox_paths_and_source_independence(intake):
    root=intake.source_roots[0]
    root.mkdir()
    (root/"front.png").write_bytes(photo("red"))
    (root/"back.png").write_bytes(photo("blue"))
    p=intake.preview(csv_text([card()]),"seller-a")
    assert p["canImport"]
    receipt=intake.commit(p["token"],"seller-a")
    # Source files may change later; captured listing bytes remain the verified originals.
    (root/"front.png").write_bytes(photo("green"))
    assert intake.image_path("seller-a","front",receipt["inventoryItemIds"][0]).read_bytes()==photo("red")

def test_two_previews_concurrent_commit(intake):
    previews=[preview(intake),preview(intake)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts=list(pool.map(lambda p:intake.commit(p["token"],"seller-a"),previews))
    assert sum(r["imported"] for r in receipts)==1
    assert sum(r["duplicates"] for r in receipts)==1

def test_tampered_images_block_training_replay(intake):
    item_id=imported(intake)
    intake.feedback(item_id,"seller-a",{"player":"wrong"},"model","event")
    path=intake.image_path("seller-a","front",item_id)
    path.chmod(0o644)
    path.write_bytes(b"changed")
    with pytest.raises(ValueError,match="integrity"):
        intake.lessons("seller-a","replay")

def test_scanner_pair_hash_compatibility(intake):
    from app.verified_csv_intake import digest
    item_id=imported(intake)
    item=intake.inventory.get_item(item_id)
    ic=item["metadata"]["instacomp"]
    assert ic["imagePairSha256"]==digest(("front:"+ic["frontSha256"]+"|back:"+ic["backSha256"]).encode())
    assert intake.inventory.find_by_image_pair_sha256(ic["imagePairSha256"])["inventoryItemId"]==item_id

@pytest.mark.parametrize("pricing_fields", [
    {"priceGuideStatus": "no_matches", "priceGuideCheckedAt": "2026-10-12T02:30:00Z", "priceGuideMessage": "No exact guide", "priceGuideCoverage": {"status": "no_matches"}, "providerCoverage": []},
    {"marketPrice": 0, "suggestedPrice": 0, "pricingStatus": "seller_price_required", "pricingReason": "No exact sold comps", "pricingAnalysis": {"sold": 0}, "reliableSoldCompCount": 0, "trustedForPricing": False, "soldCompEvidence": [], "activeCompetition": [], "activePricingEvidenceCount": 0, "providerCoverage": [], "exactMarketQueries": ["verified card"], "fastMarketLane": {"source": "ebay"}, "pricingCheckedAt": "2026-10-12T02:30:00Z"},
])
def test_verified_card_price_guide_and_fast_market_updates_preserve_truth(intake, pricing_fields):
    item_id = imported(intake)
    original = intake.inventory.get_item(item_id)
    before = original["metadata"]["verifiedCsv"]
    metadata = json.loads(json.dumps(original["metadata"]))
    metadata["instacomp"].update(pricing_fields)
    updated = intake.inventory.apply_master_listing_edit(item_id, {"metadata": metadata})
    assert updated is not None
    saved = intake.inventory.get_item(item_id)
    assert saved["metadata"]["verifiedCsv"] == before
    for field, value in pricing_fields.items():
        assert saved["metadata"]["instacomp"][field] == value
    assert updated["metadata"]["instacomp"]["manualIdentity"] == original["metadata"]["instacomp"]["manualIdentity"]
    assert updated["metadata"]["instacomp"]["frontSha256"] == original["metadata"]["instacomp"]["frontSha256"]
    assert updated["metadata"]["instacomp"]["backSha256"] == original["metadata"]["instacomp"]["backSha256"]


def test_verified_card_trigger_upgrade_allows_new_pricing_only_fields(intake):
    item_id = imported(intake)
    with intake.inventory._connect() as db:
        db.execute("DROP TRIGGER verified_csv_inventory_lock")
        db.execute("CREATE TRIGGER verified_csv_inventory_lock BEFORE UPDATE ON commercial_inventory WHEN json_extract(OLD.raw_json,'$.verifiedCsv.authority')='seller_verified_csv_v1' AND json_extract(NEW.raw_json,'$.instacomp') IS NOT json_extract(OLD.raw_json,'$.instacomp') BEGIN SELECT RAISE(ABORT,'VERIFIED_CSV_IMMUTABLE: legacy protection'); END")
    from app.verified_csv_intake import install_guards
    with intake.inventory._connect() as db:
        install_guards(db)
    item = intake.inventory.get_item(item_id)
    m = json.loads(json.dumps(item["metadata"]))
    m["instacomp"]["priceGuideCoverage"] = {"status":"no_matches"}
    updated = intake.inventory.apply_master_listing_edit(item_id, {"metadata":m})
    assert updated["metadata"]["instacomp"]["priceGuideCoverage"]["status"] == "no_matches"
    m["instacomp"]["frontSha256"] = "0" * 64
    with pytest.raises(sqlite3.IntegrityError, match="VERIFIED_CSV_IMMUTABLE"):
        intake.inventory.apply_master_listing_edit(item_id, {"metadata":m})
