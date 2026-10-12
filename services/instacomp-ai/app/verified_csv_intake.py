"""Seller-certified CSV truth. Predictions/lessons never write inventory."""
from __future__ import annotations
import csv
import hashlib
import http.client
import io
import ipaddress
import json
import os
import re
import socket
import ssl
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlsplit
from PIL import Image
from fastapi import File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

HEADERS = ["schema_version","external_id","year","manufacturer","product","subset","card_number","player","team","sport","league","parallel","variation","serial_number","print_run","autograph","autograph_type","memorabilia","memorabilia_type","patch","patch_details","rookie","condition","grading_company","grade","grading_cert_number","front_image","back_image"]
REQUIRED = {"schema_version","external_id","year","manufacturer","product","card_number","player","sport","parallel","autograph","memorabilia","patch","rookie","condition","front_image","back_image"}
BOOLS = {"autograph","memorabilia","patch","rookie"}
MAX_IMAGE = 12 * 1024 * 1024
MAX_BATCH = 200
MAX_TOTAL = 256 * 1024 * 1024
PRICING_KEYS = ["price","marketPrice","listingPrice","listingPriceSource","suggestedPrice","marketSummary","priceGuide","soldCompEvidence","activeCompetition","providerCoverage","pricingCheckedAt","pricingStatus","pricingReason","pricing","market","compEvidence","marketComp","marketSearch","pricingWorkOrder","pricingAnalysis","pricingGroupBasePrice","pricingChosenAt","pricingGroupKey","commercialQuantity","commercialKeeperInventoryItemId","priceGuideStatus","priceGuideCheckedAt","priceGuideMessage","reliableSoldCompCount"]

def stamp():
    return datetime.now(timezone.utc).isoformat()

def packed(value):
    return json.dumps(value, sort_keys=True, separators=(",",":"), ensure_ascii=False)

def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else packed(value).encode()).hexdigest()

def is_verified(metadata):
    return isinstance(metadata, dict) and metadata.get("verifiedCsv", {}).get("authority") == "seller_verified_csv_v1"

def protected_metadata_sql(expr):
    # Entire identity subtree is immutable; only explicitly named pricing fields may change.
    paths = ["$.instacomp." + key for key in PRICING_KEYS]
    return "json_remove(" + expr + "," + ",".join("'" + p + "'" for p in paths) + ")"

def install_guards(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS verified_csv_previews(
      token TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      manifest_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS verified_csv_imports(
      import_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
      receipt_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS verified_csv_feedback(
      lesson_id TEXT PRIMARY KEY, inventory_item_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      prediction_json TEXT NOT NULL, verified_json TEXT NOT NULL, disagreements_json TEXT NOT NULL,
      model_version TEXT NOT NULL, source_event_id TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(inventory_item_id,model_version,source_event_id));
    CREATE TABLE IF NOT EXISTS verified_csv_replays(
      replay_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, lesson_id TEXT NOT NULL,
      purpose TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS verified_csv_external_id_idx ON commercial_inventory(
      json_extract(raw_json,'$.verifiedCsv.ownerId'),json_extract(raw_json,'$.verifiedCsv.externalId'))
      WHERE json_extract(raw_json,'$.verifiedCsv.authority')='seller_verified_csv_v1';
    CREATE UNIQUE INDEX IF NOT EXISTS verified_csv_image_pair_idx ON commercial_inventory(
      json_extract(raw_json,'$.instacomp.imagePairSha256'))
      WHERE json_extract(raw_json,'$.verifiedCsv.authority')='seller_verified_csv_v1';
    CREATE TRIGGER IF NOT EXISTS verified_csv_feedback_no_update BEFORE UPDATE ON verified_csv_feedback
      BEGIN SELECT RAISE(ABORT,'Verified CSV lessons are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS verified_csv_feedback_no_delete BEFORE DELETE ON verified_csv_feedback
      BEGIN SELECT RAISE(ABORT,'Verified CSV lessons are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS verified_csv_inventory_no_delete BEFORE DELETE ON commercial_inventory
      WHEN json_extract(OLD.raw_json,'$.verifiedCsv.authority')='seller_verified_csv_v1'
      BEGIN SELECT RAISE(ABORT,'VERIFIED_CSV_IMMUTABLE: archive instead of delete'); END;
    """)
    db.executescript("""
    CREATE TRIGGER IF NOT EXISTS verified_csv_inventory_no_replace BEFORE INSERT ON commercial_inventory
      WHEN EXISTS(SELECT 1 FROM commercial_inventory WHERE inventory_item_id=NEW.inventory_item_id AND json_extract(raw_json,'$.verifiedCsv.authority')='seller_verified_csv_v1')
      BEGIN SELECT RAISE(ABORT,'VERIFIED_CSV_IMMUTABLE: replacement of verified rows is blocked'); END;
    """)
    for operation in ["INSERT","UPDATE"]:
        db.executescript("""
        CREATE TRIGGER IF NOT EXISTS verified_csv_master_lock_""" + operation.lower() + """
        BEFORE """ + operation + """ ON master_listing_projection
        WHEN EXISTS(SELECT 1 FROM commercial_inventory c WHERE c.inventory_item_id=NEW.inventory_item_id
          AND json_extract(c.raw_json,'$.verifiedCsv.authority')='seller_verified_csv_v1'
          AND (json_extract(NEW.row_json,'$.title') IS NOT c.title
            OR json_extract(NEW.row_json,'$.metadata.verifiedCsv') IS NOT json_extract(c.raw_json,'$.verifiedCsv')
            OR json_extract(NEW.row_json,'$.metadata.instacomp.ai') IS NOT json_extract(c.raw_json,'$.instacomp.ai')
            OR json_extract(NEW.row_json,'$.metadata.instacomp.manualIdentity') IS NOT json_extract(c.raw_json,'$.instacomp.manualIdentity')
            OR json_extract(NEW.row_json,'$.metadata.instacomp.frontImageUrl') IS NOT json_extract(c.raw_json,'$.instacomp.frontImageUrl')
            OR json_extract(NEW.row_json,'$.metadata.instacomp.backImageUrl') IS NOT json_extract(c.raw_json,'$.instacomp.backImageUrl')))
        BEGIN SELECT RAISE(ABORT,'VERIFIED_CSV_IMMUTABLE: Master Listings projection cannot overwrite verified truth'); END;
        """)
    # Compare canonical JSON produced by packed(); JSON1 strips permitted pricing fields.
    keys = ["verifiedCsv","verified_reference","identity","card_identity","sale_identity","collectible_asset","seller_review"]
    tests = ["json_extract(NEW.raw_json,'$."+key+"') IS NOT json_extract(OLD.raw_json,'$."+key+"')" for key in keys]
    old_ic = "COALESCE(json_extract(OLD.raw_json,'$.instacomp'),'{}')"
    new_ic = "COALESCE(json_extract(NEW.raw_json,'$.instacomp'),'{}')"
    # Remove only direct properties of the InstaComp subtree.
    remove = lambda x: "json_remove("+x+","+",".join("'$."+k+"'" for k in PRICING_KEYS)+")"
    tests.append(remove(new_ic) + " IS NOT " + remove(old_ic))
    tests.extend("NEW."+key+" IS NOT OLD."+key for key in ["inventory_item_id","sku","title","player","sport","category","condition","image_url"])
    db.executescript("""
    CREATE TRIGGER IF NOT EXISTS verified_csv_inventory_lock BEFORE UPDATE ON commercial_inventory
    WHEN json_extract(OLD.raw_json,'$.verifiedCsv.authority')='seller_verified_csv_v1' AND (
    """ + " OR ".join(tests) + """
    ) BEGIN SELECT RAISE(ABORT,'VERIFIED_CSV_IMMUTABLE: identity and front/back images cannot change'); END;
    """)

class VerifiedCsvIntake:
    def __init__(self, inventory, image_root=None, source_roots=None):
        self.inventory = inventory
        self.image_root = Path(image_root or inventory.path.parent / "verified-csv-images")
        self.source_roots = [Path(p).resolve() for p in (source_roots or os.environ.get("KINGMAKER_VERIFIED_CSV_IMAGE_ROOTS", "/Volumes/WD40 Data/Projects/truely-collectables/verified-csv-inbox").split(os.pathsep))]
        with inventory._connect() as db:
            install_guards(db)

    def _public_https(self, reference):
        u = urlsplit(reference)
        if u.scheme != "https" or not u.hostname or u.username or u.password or u.port not in {None,443}:
            raise ValueError("Image URL must be public HTTPS on port 443, without credentials.")
        answers = socket.getaddrinfo(u.hostname, 443, type=socket.SOCK_STREAM)
        addresses = list(dict.fromkeys(a[4][0] for a in answers))
        if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
            raise ValueError("Private, local, and reserved image URL addresses are blocked.")
        # Pin the validated address; TLS still verifies the original hostname.
        connection = http.client.HTTPSConnection(u.hostname, 443, timeout=15)
        connection.sock = ssl.create_default_context().wrap_socket(socket.create_connection((addresses[0],443),timeout=15), server_hostname=u.hostname)
        try:
            connection.request("GET",u.path or "/" if not u.query else (u.path or "/")+"?"+u.query,headers={"User-Agent":"KingmakerVerifiedCSV/1"})
            response = connection.getresponse()
            if response.status != 200:
                raise ValueError("Image URL returned HTTP "+str(response.status)+". Redirects are not followed; use the final HTTPS URL.")
            data = response.read(MAX_IMAGE+1)
        finally:
            connection.close()
        return data

    def image(self, reference, uploads):
        if reference in uploads:
            data = uploads[reference]
        elif reference.startswith("https://"):
            data = self._public_https(reference)
        elif reference.startswith("http://"):
            raise ValueError("Use HTTPS for image URLs.")
        else:
            candidates = [Path(reference)] if Path(reference).is_absolute() else [r / reference for r in self.source_roots]
            resolved = next((p.resolve() for p in candidates if p.exists()),None)
            if resolved is None:
                raise ValueError("Image not found. Upload the matching filename or place it in verified-csv-inbox.")
            if not any(resolved.is_relative_to(r) for r in self.source_roots):
                raise ValueError("Image path is outside the configured verified CSV inbox.")
            if not resolved.is_file() or resolved.stat().st_size > MAX_IMAGE:
                raise ValueError("Image must be a file no larger than 12 MiB.")
            data = resolved.read_bytes()
        if not data or len(data)>MAX_IMAGE:
            raise ValueError("Image must be nonempty and no larger than 12 MiB.")
        try:
            with Image.open(io.BytesIO(data)) as im:
                fmt = im.format
                if fmt not in {"JPEG","PNG","WEBP"}:
                    raise ValueError("Only JPEG, PNG, and WebP images are supported.")
                if im.width * im.height > 50_000_000:
                    raise ValueError("Image exceeds 50 megapixels.")
                im.verify()
        except Exception as exc:
            raise ValueError("Invalid image: "+str(exc)) from exc
        sha = digest(data)
        extension = {"JPEG":".jpg","PNG":".png","WEBP":".webp"}[fmt]
        self.image_root.mkdir(parents=True,exist_ok=True)
        target = self.image_root / (sha+extension)
        if target.exists():
            if digest(target.read_bytes()) != sha:
                raise ValueError("Stored image integrity failed; repair the image store before importing.")
        else:
            try:
                with target.open("xb") as stream:
                    stream.write(data)
                target.chmod(0o444)
            except FileExistsError:
                if digest(target.read_bytes()) != sha:
                    raise ValueError("Stored image integrity failed.")
        return {"sha256":sha,"file":target.name,"bytes":len(data),"reference":reference}

    def parse(self, csv_text):
        if len(csv_text.encode()) > 2*1024*1024:
            raise ValueError("CSV is larger than 2 MiB.")
        try:
            reader = csv.reader(io.StringIO(csv_text.lstrip("\ufeff")),strict=True)
            header = next(reader)
            header = [v.strip().lower().replace(" ","_") for v in header]
            if len(header)!=len(set(header)):
                raise ValueError("Duplicate CSV column names.")
            missing = REQUIRED - set(header)
            unknown = set(header)-set(HEADERS)
            if missing or unknown:
                raise ValueError("CSV schema: missing "+", ".join(sorted(missing))+"; unsupported "+", ".join(sorted(unknown))+". Download the template.")
            rows = []
            for values in reader:
                line = reader.line_num
                if not any(v.strip() for v in values):
                    continue
                if len(values)!=len(header):
                    rows.append((line,None,"Expected "+str(len(header))+" cells; found "+str(len(values))+". Quote fields containing commas."))
                else:
                    rows.append((line,{k:v.strip() for k,v in zip(header,values)},None))
                if len(rows)>MAX_BATCH:
                    raise ValueError("Maximum 200 cards per batch; split the CSV.")
            if not rows:
                raise ValueError("CSV has no card rows.")
            return rows
        except (csv.Error,StopIteration) as exc:
            raise ValueError("Malformed CSV: "+str(exc)) from exc

    def identity(self, row):
        for key in REQUIRED:
            if not row.get(key):
                raise ValueError(key+": required; explicitly use Base / false where applicable.")
        if row["schema_version"] != "1":
            raise ValueError("schema_version: supported version is 1.")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,119}",row["external_id"]):
            raise ValueError("external_id: use a stable physical-card ID, up to 120 letters/numbers/._:-.")
        for key,value in row.items():
            if len(value)>1000 or "\x00" in value:
                raise ValueError(key+": exceeds 1000 characters or contains a NUL.")
        if not re.fullmatch(r"(18|19|20|21)\d{2}(-\d{2,4})?",row["year"]):
            raise ValueError("year: use YYYY or YYYY-YY.")
        booleans = {}
        for key in BOOLS:
            if row[key].lower() not in {"true","false"}:
                raise ValueError(key+": use true or false.")
            booleans[key] = row[key].lower()=="true"
        if booleans["patch"] and (not booleans["memorabilia"] or not row.get("patch_details")):
            raise ValueError("patch=true requires memorabilia=true and patch_details.")
        if booleans["memorabilia"] and not row.get("memorabilia_type"):
            raise ValueError("memorabilia_type: required when memorabilia=true.")
        if booleans["autograph"] and not row.get("autograph_type"):
            raise ValueError("autograph_type: required when autograph=true (e.g. manufacturer_certified, on_card, sticker, authenticated).")
        if not booleans["autograph"] and row.get("autograph_type"):
            raise ValueError("autograph_type: clear when autograph=false.")
        if not booleans["memorabilia"] and row.get("memorabilia_type"):
            raise ValueError("memorabilia_type: clear when memorabilia=false.")
        if not booleans["patch"] and row.get("patch_details"):
            raise ValueError("patch_details: clear when patch=false.")
        run = None
        if row.get("print_run"):
            if not row["print_run"].isdigit() or int(row["print_run"])<1:
                raise ValueError("print_run: use a positive integer.")
            run = int(row["print_run"])
        serial = row.get("serial_number","")
        if serial:
            match = re.fullmatch(r"(\d+)/(\d+)",serial)
            if not match or not 1 <= int(match[1]) <= int(match[2]):
                raise ValueError("serial_number: use a valid physical numerator/denominator, e.g. 06/25.")
            if run is None or run != int(match[2]):
                raise ValueError("print_run must match serial_number denominator.")
        grading = [bool(row.get(k)) for k in ["grading_company","grade","grading_cert_number"]]
        if any(grading) and not all(grading):
            raise ValueError("Slabs require grading_company, grade, and grading_cert_number together.")
        identity = dict(row)
        for key in ["schema_version","external_id","front_image","back_image"]:
            identity.pop(key,None)
        identity.update(booleans)
        identity["print_run"] = run
        return identity

    def preview(self, csv_text, owner, uploads=None):
        if not owner:
            raise ValueError("Authenticated owner is required.")
        uploads = uploads or {}
        if sum(len(v) for v in uploads.values())>MAX_TOTAL:
            raise ValueError("Uploaded images exceed 256 MiB.")
        results, seen, pairs, cached = [],set(),set(),{}
        total = 0
        for line,row,error in self.parse(csv_text):
            output = {"line":line,"externalId":row.get("external_id","") if row else "", "status":"error","errors":[]}
            try:
                if error:
                    raise ValueError(error)
                if total >= MAX_TOTAL:
                    raise ValueError("Batch image limit reached; split the CSV.")
                identity = self.identity(row)
                if row["external_id"] in seen:
                    raise ValueError("external_id: repeated in this batch; each physical card needs its own ID.")
                seen.add(row["external_id"])
                images = []
                for side in ["front","back"]:
                    ref = row[side+"_image"]
                    if ref not in cached:
                        try:
                            cached[ref] = self.image(ref,uploads)
                        except ValueError as exc:
                            raise ValueError(side+"_image: "+str(exc)) from exc
                    images.append(cached[ref])
                front,back = images
                total += front["bytes"]+back["bytes"]
                if total>MAX_TOTAL:
                    raise ValueError("Batch image bytes exceed 256 MiB; split the CSV.")
                if front["sha256"]==back["sha256"]:
                    raise ValueError("front_image/back_image: images are identical; supply different sides.")
                pair = digest(("front:"+front["sha256"]+"|back:"+back["sha256"]).encode())
                if pair in pairs:
                    raise ValueError("Image pair repeated in this batch; cannot import the same physical photographs twice.")
                pairs.add(pair)
                content = digest({"identity":identity,"front":front["sha256"],"back":back["sha256"]})
                item_id = str(uuid.uuid5(uuid.NAMESPACE_URL,"kingmaker:verified-csv:"+owner+":"+row["external_id"]))
                existing = self.inventory.get_item(item_id)
                duplicate = self.inventory.find_by_image_pair_sha256(pair)
                status = "ready"
                if existing:
                    meta = existing.get("metadata",{}).get("verifiedCsv",{})
                    if meta.get("contentSha256")!=content:
                        raise ValueError("external_id already exists with different verified data/images. Existing truth will not be overwritten.")
                    status = "duplicate"
                elif duplicate:
                    raise ValueError("These photographs already belong to inventory "+duplicate["inventoryItemId"]+". Existing records will not be merged or overwritten.")
                title = " ".join(v for v in [identity["year"],identity["manufacturer"],identity["product"],identity.get("subset"),"#"+identity["card_number"],identity["player"],identity["parallel"],identity.get("serial_number")] if v)
                output.update(status=status,inventoryItemId=item_id,title=title,identity=identity,front=front,back=back,imagePairSha256=pair,contentSha256=content,queue="pending_listings",confidence=1.0)
            except (ValueError,OSError) as exc:
                output["errors"]=[str(exc)]
            results.append(output)
        token = str(uuid.uuid4())
        manifest = {"token":token,"ownerId":owner,"rows":results,"csvSha256":digest(csv_text.encode()),"expiresAt":(datetime.now(timezone.utc)+timedelta(hours=24)).isoformat()}
        with self.inventory._connect() as db:
            db.execute("INSERT INTO verified_csv_previews VALUES(?,?,?,?,?)",(token,owner,manifest["expiresAt"],packed(manifest),stamp()))
        return self.public_preview(manifest)

    def public_preview(self,manifest):
        counts = {k:sum(r["status"]==k for r in manifest["rows"]) for k in ["ready","duplicate","error"]}
        rows = []
        for raw in manifest["rows"]:
            row = {k:v for k,v in raw.items() if k not in {"imagePairSha256","contentSha256"}}
            for side in ["front","back"]:
                if side in row:
                    row[side] = {k:v for k,v in row[side].items() if k!="file"}
                    row[side]["url"] = "/api/kingmaker/verified-csv/image?token="+manifest["token"]+"&line="+str(row["line"])+"&side="+side
            rows.append(row)
        return {"ok":True,"token":manifest["token"],"expiresAt":manifest["expiresAt"],"rows":rows,"counts":{**counts,"total":len(rows)},"canImport":counts["error"]==0 and counts["ready"]>0,"queue":"pending_listings"}

    def metadata(self,row,owner,import_id):
        identity = row["identity"]
        item_id = row["inventoryItemId"]
        origin = os.environ.get("KINGMAKER_VERIFIED_CSV_PUBLIC_ORIGIN","https://truelycollectables.com").rstrip("/")
        side_urls = {side:origin+"/api/kingmaker/verified-csv/image?inventoryItemId="+item_id+"&side="+side+"&sha256="+row[side]["sha256"] for side in ["front","back"]}
        ai = {**identity,"cardNumber":identity["card_number"],"setName":identity["product"],"serialNumber":identity.get("serial_number"),"serialRun":identity.get("print_run"),"isAuto":identity["autograph"],"isRelic":identity["memorabilia"],"isRookie":identity["rookie"],"checklistParallel":identity["parallel"],"confidence":1.0,"memorabiliaType":identity.get("memorabilia_type"),"gradingCompany":identity.get("grading_company"),"gradeValue":identity.get("grade"),"gradingCertNumber":identity.get("grading_cert_number"),"certificationNumber":identity.get("grading_cert_number"),"patchDetails":identity.get("patch_details")}
        asset = {"parallel_name":identity["parallel"],"exact_serial_number":identity.get("serial_number"),"print_run":identity.get("print_run"),"autograph":identity["autograph"],"memorabilia":identity["memorabilia"],"patch":identity["patch"],"patch_details":identity.get("patch_details"),"grading_company":identity.get("grading_company"),"grading_cert_number":identity.get("grading_cert_number"),"grade":identity.get("grade"),"grader_verification_status":"manual_verified" if identity.get("grading_company") else None}
        return {"sourceAuthority":"mac_local","verifiedCsv":{"authority":"seller_verified_csv_v1","schemaVersion":1,"ownerId":owner,"externalId":row["externalId"],"contentSha256":row["contentSha256"],"importId":import_id,"verifiedAt":stamp(),"identity":identity,"images":{side:row[side] for side in ["front","back"]}},
            "verified_reference":{**ai,"front_sha256":row["front"]["sha256"],"back_sha256":row["back"]["sha256"]},
            "identity":ai,"collectible_asset":asset,"seller_review":{"identity_confirmed":True},
            "listingReviewRequired":False,"listingWorkflow":{"queue":"pending_listings","source":"verified_csv","stage":"pricing_pending"},
            "pending_verification":{"status":"resolved","source":"verified_csv"},
            "instacomp":{"source":"seller_verified_csv","identitySource":"seller_verified_csv","cardUuid":item_id,"ai":ai,"manualIdentity":ai,"manualIdentityLocked":True,"manualIdentityEdit":True,"humanVerified":True,"identityComplete":True,"trustedForIdentity":True,"identityRefreshRequired":False,"verificationConfidence":1.0,"frontImageUrl":side_urls["front"],"backImageUrl":side_urls["back"],"frontSha256":row["front"]["sha256"],"backSha256":row["back"]["sha256"],"imagePairSha256":row["imagePairSha256"],"hasBackImage":True,"imagePersistenceVerified":True,"imageOrientationPersisted":True,"imageOrientation":{"status":"completed","source":"seller_verified_csv","frontRotation":0,"backRotation":0},"pricingStatus":"identity_complete_pricing_pending","lastStatus":"identity_complete","lastStage":"verified_csv","publicationStatus":"ready"}}

    def commit(self,token,owner):
        with self.inventory._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            done = db.execute("SELECT receipt_json FROM verified_csv_imports WHERE token=? AND owner_id=?",(token,owner)).fetchone()
            if done:
                return json.loads(done[0])
            stored = db.execute("SELECT manifest_json,expires_at FROM verified_csv_previews WHERE token=? AND owner_id=?",(token,owner)).fetchone()
            if not stored:
                raise ValueError("Preview not found for this seller; preview the CSV again.")
            if stored["expires_at"]<stamp():
                raise ValueError("Preview expired; preview the CSV again.")
            manifest = json.loads(stored["manifest_json"])
            if any(r["status"]=="error" for r in manifest["rows"]):
                raise ValueError("Fix all preview errors before importing. No cards were imported.")
            import_id = str(uuid.uuid4())
            imported,duplicates,ids = 0,0,[]
            for row in manifest["rows"]:
                for side in ["front","back"]:
                    image = row[side]
                    if digest((self.image_root/image["file"]).read_bytes())!=image["sha256"]:
                        raise ValueError("Image changed after preview. Preview again; no cards were imported.")
                existing = db.execute("SELECT raw_json FROM commercial_inventory WHERE inventory_item_id=?",(row["inventoryItemId"],)).fetchone()
                if existing:
                    if json.loads(existing[0]).get("verifiedCsv",{}).get("contentSha256")!=row["contentSha256"]:
                        raise ValueError("Concurrent import conflict; no records overwritten.")
                    duplicates+=1
                    ids.append(row["inventoryItemId"])
                    continue
                pair = db.execute("SELECT inventory_item_id FROM commercial_inventory WHERE json_extract(raw_json,'$.instacomp.imagePairSha256')=?",(row["imagePairSha256"],)).fetchone()
                if pair:
                    raise ValueError("Photographs were imported since preview. Preview again; no cards were imported.")
                metadata = self.metadata(row,owner,import_id)
                current = stamp()
                sku = "vcsv-"+row["inventoryItemId"]
                db.execute("""INSERT INTO commercial_inventory(inventory_item_id,sku,ebay_listing_id,title,description,player,sport,category,condition,status,quantity,price,image_url,local_dirty,created_at,updated_at,raw_json)
                  VALUES(?,?,?,?,?,?,?,?,?,'draft',1,0,?,1,?,?,?)""",(row["inventoryItemId"],sku,"local:"+row["inventoryItemId"],row["title"],"Seller-verified CSV card. Identity and both photographs are immutable.",row["identity"]["player"],row["identity"]["sport"],"Trading Card Singles",row["identity"]["condition"],metadata["instacomp"]["frontImageUrl"],current,current,packed(metadata)))
                projection = {"id":row["inventoryItemId"],"card_uuid":row["inventoryItemId"],"sku":sku,"title":row["title"],"description":"Seller-verified CSV card.","category":"Trading Card Singles","condition":row["identity"]["condition"],"status":"draft","quantity":1,"price":0,"image_url":metadata["instacomp"]["frontImageUrl"],"metadata":metadata,"seller_account_id":owner,"created_at":current,"updated_at":current}
                db.execute("INSERT INTO master_listing_projection(inventory_item_id,folder,pending_queue,group_key,source_updated_at,projected_at,row_json) VALUES(?,'pending','listings',?,?,?,?)",(row["inventoryItemId"],"physical:"+row["inventoryItemId"],current,current,packed(projection)))
                imported+=1
                ids.append(row["inventoryItemId"])
            receipt = {"ok":True,"importId":import_id,"token":token,"imported":imported,"duplicates":duplicates,"errors":0,"inventoryItemIds":ids,"queue":"pending_listings","pricingPending":imported,"verificationRequired":0,"createdAt":stamp()}
            db.execute("INSERT INTO verified_csv_imports VALUES(?,?,?,?,?)",(import_id,owner,token,packed(receipt),stamp()))
        return receipt

    def item(self,item_id,owner):
        item = self.inventory.get_item(item_id)
        if not item or item.get("metadata",{}).get("verifiedCsv",{}).get("ownerId")!=owner:
            raise ValueError("Verified card not found for this seller.")
        return item

    def image_path(self,owner,side,item_id=None,token=None,line=None):
        if side not in {"front","back"}:
            raise ValueError("side must be front or back.")
        if item_id:
            receipt = self.item(item_id,owner)["metadata"]["verifiedCsv"]["images"][side]
        else:
            with self.inventory._read_connect() as db:
                stored = db.execute("SELECT manifest_json,expires_at FROM verified_csv_previews WHERE token=? AND owner_id=?",(token,owner)).fetchone()
            if not stored or stored["expires_at"]<stamp():
                raise ValueError("Preview not found or expired.")
            row = next((r for r in json.loads(stored[0])["rows"] if r["line"]==line),{})
            receipt = row.get(side)
            if not receipt:
                raise ValueError("Preview side not found.")
        path = self.image_root / receipt["file"]
        if digest(path.read_bytes())!=receipt["sha256"]:
            raise ValueError("Image integrity check failed.")
        return path

    def feedback(self,item_id,owner,prediction,model,event):
        item = self.item(item_id,owner)
        truth = item["metadata"]["verifiedCsv"]["identity"]
        unknown = set(prediction)-set(truth)
        if unknown:
            raise ValueError("Unsupported prediction fields: "+", ".join(sorted(unknown))+". Use CSV identity field names.")
        if not prediction or not model.strip() or not event.strip() or len(packed(prediction))>32_000:
            raise ValueError("Provide prediction fields, model_version, and source_event_id (max 32 KB).")
        disagreements = {key:{"prediction":value,"verified":truth[key]} for key,value in prediction.items() if value!=truth[key]}
        lesson_id = str(uuid.uuid5(uuid.NAMESPACE_URL,item_id+":"+model+":"+event))
        verified = {"identity":truth,"images":item["metadata"]["verifiedCsv"]["images"],"contentSha256":item["metadata"]["verifiedCsv"]["contentSha256"]}
        with self.inventory._connect() as db:
            old = db.execute("SELECT prediction_json FROM verified_csv_feedback WHERE lesson_id=?",(lesson_id,)).fetchone()
            if old and old[0]!=packed(prediction):
                raise ValueError("Feedback event already exists with a different prediction; use a new event ID.")
            db.execute("INSERT OR IGNORE INTO verified_csv_feedback VALUES(?,?,?,?,?,?,?,?,?)",(lesson_id,item_id,owner,packed(prediction),packed(verified),packed(disagreements),model,event,stamp()))
        return {"ok":True,"lessonId":lesson_id,"disagreements":disagreements,"productionModified":False}

    def lessons(self,owner,replay_id=None):
        with self.inventory._connect() as db:
            rows = db.execute("SELECT * FROM verified_csv_feedback WHERE owner_id=? ORDER BY created_at,lesson_id LIMIT 1000",(owner,)).fetchall()
            lessons=[]
            for row in rows:
                item = self.item(row["inventory_item_id"],owner)
                verified = json.loads(row["verified_json"])
                for side in ["front", "back"]:
                    self.image_path(owner, side, row["inventory_item_id"])
                if item["metadata"]["verifiedCsv"]["contentSha256"]!=verified["contentSha256"]:
                    raise ValueError("Truth mismatch; replay blocked.")
                lesson={"lessonId":row["lesson_id"],"inventoryItemId":row["inventory_item_id"],"prediction":json.loads(row["prediction_json"]),"verified":verified,"disagreements":json.loads(row["disagreements_json"]),"modelVersion":row["model_version"],"sourceEventId":row["source_event_id"],"createdAt":row["created_at"],"purpose":"training_feedback_only","productionWriteAllowed":False}
                lessons.append(lesson)
                if replay_id:
                    rid = digest((owner+":"+replay_id+":"+row["lesson_id"]).encode())
                    db.execute("INSERT OR IGNORE INTO verified_csv_replays VALUES(?,?,?,?,?)",(rid,owner,row["lesson_id"],"training_feedback_only",stamp()))
        return {"ok":True,"lessons":lessons,"count":len(lessons),"limit":1000,"productionModified":False}

class CommitRequest(BaseModel):
    token: str = Field(min_length=1,max_length=100)
    owner_id: str = Field(min_length=1,max_length=100)

class FeedbackRequest(BaseModel):
    owner_id: str = Field(min_length=1,max_length=100)
    inventory_item_id: str = Field(min_length=1,max_length=100)
    prediction: dict = Field(default_factory=dict)
    model_version: str = Field(min_length=1,max_length=200)
    source_event_id: str = Field(min_length=1,max_length=200)

def attach_verified_csv_routes(router,inventory):
    intake = VerifiedCsvIntake(inventory)
    @router.post("/verified-csv/preview")
    async def preview(csv_file: UploadFile=File(...),owner_id: str=Form(...),images: list[UploadFile]=File(default=[])):
        try:
            raw = await csv_file.read(2*1024*1024+1)
            if len(raw)>2*1024*1024:
                raise ValueError("CSV exceeds 2 MiB.")
            uploads={}
            total=0
            for image in images:
                name = image.filename or ""
                if not name or name in uploads:
                    raise ValueError("Uploaded image filenames must be unique.")
                data = await image.read(MAX_IMAGE+1)
                total+=len(data)
                if len(data)>MAX_IMAGE or total>MAX_TOTAL:
                    raise ValueError("Images exceed 12 MiB per image / 256 MiB batch.")
                uploads[name]=data
            return intake.preview(raw.decode("utf-8-sig"),owner_id,uploads)
        except (ValueError,UnicodeError,OSError) as exc:
            raise HTTPException(status_code=422,detail=str(exc)) from exc
    @router.post("/verified-csv/commit")
    def commit(request: CommitRequest):
        try:
            return intake.commit(request.token,request.owner_id)
        except (ValueError,OSError) as exc:
            raise HTTPException(status_code=409,detail=str(exc)) from exc
    @router.get("/verified-csv/image")
    def image(side: str,owner_id: str|None=None,inventory_item_id: str|None=None,token: str|None=None,line: int|None=None,sha256: str|None=None):
        try:
            if inventory_item_id and sha256:
                item = inventory.get_item(inventory_item_id)
                verified = (item or {}).get("metadata", {}).get("verifiedCsv", {})
                receipt = verified.get("images", {}).get(side, {})
                if verified.get("authority") != "seller_verified_csv_v1" or receipt.get("sha256") != sha256:
                    raise ValueError("Image capability does not match the verified snapshot.")
                owner_id = verified.get("ownerId")
            if not owner_id:
                raise ValueError("Authenticated owner or certified image capability is required.")
            return FileResponse(intake.image_path(owner_id,side,inventory_item_id,token,line),headers={"Cache-Control":"private, no-store"})
        except (ValueError,OSError) as exc:
            raise HTTPException(status_code=404,detail=str(exc)) from exc
    @router.post("/verified-csv/feedback")
    def feedback(request: FeedbackRequest):
        try:
            return intake.feedback(request.inventory_item_id,request.owner_id,request.prediction,request.model_version,request.source_event_id)
        except ValueError as exc:
            raise HTTPException(status_code=409,detail=str(exc)) from exc
    @router.get("/verified-csv/lessons")
    def lessons(owner_id: str):
        return intake.lessons(owner_id)
    @router.post("/verified-csv/replay")
    def replay(request: CommitRequest):
        return intake.lessons(request.owner_id,request.token)
