#!/usr/bin/env python3
import csv
import hashlib
import json
import os
import re
from pathlib import Path

OUTPUT_DIR = Path(
    os.environ.get(
        "TRUELY_DEAL_HUNTER_OUTPUT_DIR",
        ".codex-run/truely-deal-hunter-producer",
    )
)
ARTIFACT_PATH = OUTPUT_DIR / "producer-artifact.json"
RUN_ID = os.environ["HANDOFF_RUN_ID"]
SEQUENCE = int(os.environ["HANDOFF_SEQUENCE"])

CANDIDATE_HEADERS = [
    "candidate_id",
    "run_id",
    "run_sequence",
    "observed_at",
    "lane",
    "watched_person",
    "item_type",
    "marketplace",
    "seller_name",
    "seller_id",
    "listing_item_id",
    "listing_url",
    "listing_status",
    "title",
    "seller_claimed_identity_json",
    "verified_identity_json",
    "identity_key",
    "physical_copy_key",
    "front_image_url",
    "back_image_url",
    "front_verified",
    "back_verified",
    "rookie_status_verified",
    "true_first_bowman_verified",
    "chronology_evidence_json",
    "parallel",
    "serial_tier",
    "serial_number",
    "autograph_status",
    "memorabilia_status",
    "raw_or_graded",
    "grading_company",
    "grade",
    "certification_number",
    "condition_summary",
    "seller_risk",
    "fraud_risks_json",
    "item_price",
    "inbound_shipping",
    "buyer_fees",
    "tax",
    "other_acquisition_costs",
    "delivered_acquisition_cost",
    "exact_sold_count",
    "lookback_days",
    "thin_comps",
    "median_delivered_sold",
    "average_delivered_sold",
    "low_delivered_sold",
    "high_delivered_sold",
    "most_recent_sold_date",
    "latest_three_sales_json",
    "movement_30d",
    "movement_90d",
    "liquidity",
    "confidence_grade",
    "conservative_resale",
    "selling_fee_rate",
    "selling_fee_amount",
    "order_fee",
    "return_reserve",
    "outbound_shipping",
    "insurance",
    "supplies",
    "authentication_cost",
    "expected_net_proceeds",
    "expected_net_profit",
    "expected_net_roi",
    "max_delivered_cost_20_roi",
    "absolute_max_item_price",
    "opening_offer",
    "target_price",
    "deal_label",
    "actionable",
    "owned_copy_exclusion_pass",
    "suppression_reasons_json",
    "raw_payload_json",
]

FEED_LABELS = {
    "wnba": "WNBA",
    "ivan_demidov": "IVAN",
    "matvei_michkov_young_guns": "MICHKOV YG",
    "matvei_michkov_opc_platinum": "MICHKOV OPCP",
    "baseball_prospects": "MLB PROSPECT",
    "signed_baseballs": "SIGNED BALL",
}


def compact(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def slug(value):
    normalized = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return normalized or "unknown"


def numeric_item(listing):
    match = re.search(r"/itm/(?:[^/?]+/)?(\d{9,15})", listing.get("listingUrl", ""))
    if match:
        return match.group(1)
    match = re.search(r"(\d{9,15})", str(listing.get("listingItemId", "")))
    return match.group(1) if match else str(listing.get("listingItemId") or "")


def grading(title, condition):
    match = re.search(r"\b(PSA|BGS|SGC|CGC|HGA|TAG|CSG)\s*(\d+(?:\.\d+)?)\b", title, re.I)
    if match:
        return "GRADED", match.group(1).upper(), match.group(2)
    if str(condition).lower() == "graded":
        return "GRADED", "", ""
    if str(condition).lower() == "ungraded":
        return "RAW", "", ""
    return "UNKNOWN", "", ""


def csv_value(value):
    if value is None:
        return ""
    if value is True:
        return "TRUE"
    if value is False:
        return "FALSE"
    return value


artifact = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
if artifact.get("summary", {}).get("ok") is not True:
    raise SystemExit("Producer artifact is not complete")
if artifact.get("summary", {}).get("successfulQueryFamilyCount") != 51:
    raise SystemExit("Producer artifact does not contain 51 successful families")

observed_at = artifact["summary"]["generatedAt"]
family_meta = {}
for feed in artifact["feeds"]:
    payload = feed["payload"]
    for coverage in payload["sourceCoverage"]:
        family_meta[coverage["familyId"]] = {
            "query": coverage.get("query"),
            "feed": feed["key"],
            "host": feed["host"],
            "endpoint": feed["url"],
            "deployment": payload.get("deployment") or {},
        }

candidate_ids = []
candidate_rows = []
for listing in artifact["aggregateListings"]:
    item_id = numeric_item(listing)
    seed = "|".join(
        [
            str(listing.get("marketplace") or ""),
            str(listing.get("sellerName") or ""),
            item_id,
            str(listing.get("listingUrl") or ""),
        ]
    )
    candidate_id = "cand-s14-ebay-" + hashlib.sha256(seed.encode()).hexdigest()[:20]
    candidate_ids.append(candidate_id)

    feeds = list(listing.get("sourceFeedKeys") or [])
    if not feeds:
        feeds = sorted(
            {
                family_meta.get(family_id, {}).get("feed")
                for family_id in listing.get("queryFamilyIds", [])
                if family_meta.get(family_id, {}).get("feed")
            }
        )
    primary_feed = feeds[0] if feeds else "unknown"
    lane = f"{FEED_LABELS.get(primary_feed, primary_feed.upper())}/{listing.get('lane') or 'unknown'}"
    family_ids = list(listing.get("queryFamilyIds") or [])
    metas = [family_meta.get(family_id, {}) for family_id in family_ids]
    raw_or_graded, grading_company, grade = grading(
        listing.get("title", ""), listing.get("condition")
    )

    search_text = " ".join(
        [
            str(listing.get("itemType") or ""),
            str(listing.get("lane") or ""),
            str(listing.get("title") or ""),
        ]
    ).lower()
    autograph_status = (
        "CLAIMED_ONLY" if re.search(r"\b(auto|autograph|signed)\b", search_text) else "NO"
    )
    memorabilia_status = (
        "CLAIMED_ONLY" if re.search(r"\b(patch|relic|memorabilia)\b", search_text) else "NO"
    )

    suppression = [
        "exact_front_back_identity_not_verified",
        "identical_completed_sales_not_persisted",
        "delivered_acquisition_cost_incomplete",
        "truely_collectables_owned_copy_exclusion_not_proven",
    ]
    if primary_feed == "wnba":
        suppression.append("silver_equivalent_or_better_not_image_verified")
    if primary_feed == "matvei_michkov_young_guns":
        suppression.append("exact_upper_deck_young_guns_identity_not_image_verified")
    if primary_feed == "matvei_michkov_opc_platinum":
        suppression.append("rainbow_or_better_tier_not_image_verified")
    if primary_feed == "baseball_prospects":
        suppression.append("true_first_bowman_chronology_not_verified")
    if primary_feed == "signed_baseballs":
        suppression.extend(
            ["signature_authentication_not_verified", "provenance_not_verified"]
        )
    suppression.extend(list(listing.get("preliminaryRisks") or []))
    suppression = list(dict.fromkeys(suppression))

    fraud_risks = ["identity_and_images_unverified"]
    if primary_feed == "signed_baseballs":
        fraud_risks.extend(
            [
                "authentication_certification_not_verified",
                "raw_signature_must_not_be_called_authentic",
            ]
        )

    seller_claim = {
        "query_family_ids": family_ids,
        "preliminary_scope_status": listing.get("preliminaryScopeStatus"),
    }
    deployment = next(
        (meta.get("deployment") for meta in metas if meta.get("deployment")), {}
    )
    raw_payload = {
        "source": "truelycollectables.com/native-ebay",
        "artifact_schema": artifact.get("schema"),
        "native_schema": artifact["summary"].get("nativeSchema"),
        "producer_run_id": artifact["summary"].get("runId"),
        "producer_commit_sha": artifact["summary"].get("commitSha"),
        "gateway_scopes": feeds,
        "gateway_host": next(
            (meta.get("host") for meta in metas if meta.get("host")), None
        ),
        "gateway_endpoint": next(
            (meta.get("endpoint") for meta in metas if meta.get("endpoint")), None
        ),
        "token_mode": "client_credentials",
        "deployment": {
            "environment": deployment.get("environment"),
            "commitSha": deployment.get("commitSha"),
            "region": deployment.get("region"),
        },
        "discovery_family_ids": family_ids,
        "source_queries": [family_meta.get(family_id, {}).get("query") for family_id in family_ids],
        "listing_item_id": item_id,
    }

    values = {
        "candidate_id": candidate_id,
        "run_id": RUN_ID,
        "run_sequence": SEQUENCE,
        "observed_at": observed_at,
        "lane": lane,
        "watched_person": listing.get("watchedPerson"),
        "item_type": listing.get("itemType"),
        "marketplace": "eBay",
        "seller_name": listing.get("sellerName"),
        "seller_id": None,
        "listing_item_id": item_id,
        "listing_url": listing.get("listingUrl"),
        "listing_status": "LIVE",
        "title": listing.get("title"),
        "seller_claimed_identity_json": compact(seller_claim),
        "verified_identity_json": "{}",
        "identity_key": None,
        "physical_copy_key": f"ebay|{slug(listing.get('sellerName'))}|{item_id or hashlib.sha256(str(listing.get('listingUrl')).encode()).hexdigest()[:16]}",
        "front_image_url": (listing.get("imageUrls") or [None])[0],
        "back_image_url": None,
        "front_verified": False,
        "back_verified": False,
        "rookie_status_verified": False,
        "true_first_bowman_verified": False
        if primary_feed == "baseball_prospects"
        else None,
        "chronology_evidence_json": "{}",
        "parallel": None,
        "serial_tier": None,
        "serial_number": None,
        "autograph_status": autograph_status,
        "memorabilia_status": memorabilia_status,
        "raw_or_graded": raw_or_graded,
        "grading_company": grading_company or None,
        "grade": grade or None,
        "certification_number": None,
        "condition_summary": f"{listing.get('condition') or 'Unknown'}; seller/API claim only; front/back unverified.",
        "seller_risk": "UNKNOWN",
        "fraud_risks_json": compact(fraud_risks),
        "item_price": listing.get("itemPrice"),
        "inbound_shipping": listing.get("inboundShipping"),
        "buyer_fees": listing.get("buyerFees"),
        "tax": listing.get("tax"),
        "other_acquisition_costs": None,
        "delivered_acquisition_cost": None,
        "exact_sold_count": 0,
        "lookback_days": 180,
        "thin_comps": True,
        "median_delivered_sold": None,
        "average_delivered_sold": None,
        "low_delivered_sold": None,
        "high_delivered_sold": None,
        "most_recent_sold_date": None,
        "latest_three_sales_json": "[]",
        "movement_30d": "INSUFFICIENT",
        "movement_90d": "INSUFFICIENT",
        "liquidity": "UNKNOWN",
        "confidence_grade": "INSUFFICIENT",
        "conservative_resale": None,
        "selling_fee_rate": None,
        "selling_fee_amount": None,
        "order_fee": None,
        "return_reserve": None,
        "outbound_shipping": None,
        "insurance": None,
        "supplies": None,
        "authentication_cost": None,
        "expected_net_proceeds": None,
        "expected_net_profit": None,
        "expected_net_roi": None,
        "max_delivered_cost_20_roi": None,
        "absolute_max_item_price": None,
        "opening_offer": None,
        "target_price": None,
        "deal_label": "MANUAL REVIEW / UNPRICED",
        "actionable": False,
        "owned_copy_exclusion_pass": False,
        "suppression_reasons_json": compact(suppression),
        "raw_payload_json": compact(raw_payload),
    }
    candidate_rows.append([csv_value(values.get(header)) for header in CANDIDATE_HEADERS])

if len(candidate_rows) != 476 or len(set(candidate_ids)) != 476:
    raise SystemExit("Candidate reconciliation failed")
if len({row[17] for row in candidate_rows}) != 476:
    raise SystemExit("Physical-copy key reconciliation failed")

coverage_rows = []
source_keys = []
for feed in artifact["feeds"]:
    payload = feed["payload"]
    for coverage in payload["sourceCoverage"]:
        lane = f"{FEED_LABELS[feed['key']]}/{coverage['familyId']}"
        note = {
            "family_id": coverage["familyId"],
            "gateway_scope": feed["key"],
            "query": coverage.get("query"),
            "raw_results": coverage.get("rawResultCount", 0),
            "accepted_results": coverage.get("acceptedResultCount", 0),
            "rejected_results": coverage.get("rejectedResultCount", 0),
            "rejection_counts": coverage.get("rejectionCounts") or {},
            "warnings": coverage.get("warnings") or [],
            "schema": payload.get("schema"),
            "token_mode": payload.get("tokenMode"),
            "deployment": payload.get("deployment"),
            "host": feed.get("host"),
            "endpoint": feed.get("url"),
            "producer_run_id": artifact["summary"].get("runId"),
        }
        coverage_rows.append(
            [
                RUN_ID,
                SEQUENCE,
                observed_at,
                "eBay Native Browse",
                lane,
                "COMPLETE",
                1,
                int(coverage.get("acceptedResultCount") or 0),
                0,
                compact(note),
            ]
        )
        source_keys.append(f"eBay Native Browse|{lane}|COMPLETE")

collx_note = {
    "queries_executed": 4,
    "result": "One public profile-level result found: Ivan Demidov 2025-26 Allure Color Flow Yellow-Green #CF-22 at $7.86.",
    "eligibility": "Not accepted as an official verified professional rookie target; no direct checkout/back-image/exact sold baseline.",
    "danny_norris": "No independently verified public indexed seller inventory in this coverage pass.",
    "limitations": [
        "public indexed coverage only",
        "no exact physical-copy verification",
        "no identical completed-sale baseline",
    ],
    "source_url": "https://share.collx.app/user4724772",
}
coverage_rows.append(
    [
        RUN_ID,
        SEQUENCE,
        "2026-07-31T12:46:00-06:00",
        "CollX Public Indexed",
        "all card lanes",
        "COMPLETE",
        4,
        1,
        0,
        compact(collx_note),
    ]
)
source_keys.append("CollX Public Indexed|all card lanes|COMPLETE")
if len(coverage_rows) != 52:
    raise SystemExit("Coverage reconciliation failed")

counts = {
    "query_family_count": 51,
    "source_count": 52,
    "discovered_count": 583,
    "deduplicated_count": 476,
    "verified_count": 0,
    "actionable_count": 0,
    "manual_review_count": 476,
    "suppressed_count": 476,
    "error_count": 0,
}
canonical = {
    "schema": "TCOS_HANDOFF_V1",
    "run_id": RUN_ID,
    "sequence": SEQUENCE,
    "counts": counts,
    "candidate_ids": candidate_ids,
    "source_keys": source_keys,
}
checksum = hashlib.sha256(compact(canonical).encode()).hexdigest()

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
with (OUTPUT_DIR / "handoff-candidates.csv").open(
    "w", encoding="utf-8", newline=""
) as handle:
    csv.writer(handle, lineterminator="\n").writerows(candidate_rows)
with (OUTPUT_DIR / "handoff-coverage.csv").open(
    "w", encoding="utf-8", newline=""
) as handle:
    csv.writer(handle, lineterminator="\n").writerows(coverage_rows)
manifest = {
    "schema": "TCOS_HANDOFF_V1",
    "run_id": RUN_ID,
    "sequence": SEQUENCE,
    "observed_at": observed_at,
    "candidate_headers": CANDIDATE_HEADERS,
    "candidate_count": len(candidate_rows),
    "coverage_count": len(coverage_rows),
    "candidate_ids": candidate_ids,
    "source_keys": source_keys,
    "counts": counts,
    "checksum": checksum,
    "producer_summary": artifact["summary"],
    "collx_coverage": collx_note,
}
(OUTPUT_DIR / "handoff-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps({"ok": True, "checksum": checksum, **counts}, indent=2))
