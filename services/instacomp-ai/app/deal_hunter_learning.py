from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


POLICY_VERSION = "2026-08-07.1"


@dataclass(frozen=True)
class DealHunterLesson:
    lesson_key: str
    category: str
    rule: str
    rationale: str
    trusted: bool = True
    verification_source: str = "operator_confirmed"


# These are decision lessons, not card-identity labels. They intentionally stay
# out of the MLX-VLM identity dataset so marketplace economics cannot contaminate
# visual card-recognition training.
DEFAULT_DEAL_HUNTER_LESSONS: tuple[DealHunterLesson, ...] = (
    DealHunterLesson(
        "landed_cost_not_sticker",
        "economics",
        "Judge every deal by total acquisition cost: item price + inbound shipping + buyer fees + tax, never by sticker price alone.",
        "A cheap listing with expensive shipping is not a cheap acquisition.",
    ),
    DealHunterLesson(
        "cheap_lot_shipping_gate",
        "economics",
        "Penalize low-dollar lots when shipping is a large share of acquisition cost unless image forensics proves hidden value sufficient to overcome the landed cost.",
        "A $7 lot with roughly $6 shipping should not be recommended merely because the item price is $7.",
    ),
    DealHunterLesson(
        "whole_lot_value",
        "lots",
        "For lots, value the pictured contents as a group and compare conservative total resale value against the full landed cost; do not comp the lot as though it were one card.",
        "Single-card comps can create false-positive lot recommendations.",
    ),
    DealHunterLesson(
        "hidden_card_can_pay_for_lot",
        "lots",
        "Give extra priority when one confidently identified hidden card can conservatively cover the entire landed cost of the lot by itself.",
        "This creates downside protection while leaving the remaining cards as upside.",
    ),
    DealHunterLesson(
        "scan_all_available_images",
        "vision",
        "Inspect every marketplace image that is actually available, not only the first image; classify group shots, individual fronts, individual backs, and close-ups before pricing.",
        "Hidden parallels, serials, autos, relics, and unlisted cards often appear only in later photos.",
    ),
    DealHunterLesson(
        "never_invent_unseen_back",
        "vision",
        "Never claim a back-side stamp, card number, serial, variation, or other physical fact unless that image evidence was actually available and readable.",
        "Unseen or unreadable evidence must lower confidence or force review rather than become fabricated certainty.",
    ),
    DealHunterLesson(
        "front_back_exact_identity",
        "identity",
        "When front and back are available, verify player, year, manufacturer, set/product, card number, rookie designation, parallel/insert, variation, exact serial stamp/print run, autograph, relic, and condition clues from the images.",
        "Exact identity is required before exact comps can be trusted.",
    ),
    DealHunterLesson(
        "seller_description_vs_images",
        "hidden_value",
        "Compare seller title and description against image-derived facts and explicitly flag valuable facts missing from, misspelled in, or contradicted by the listing text.",
        "Seller omissions and misidentifications are a primary hidden-gem signal.",
    ),
    DealHunterLesson(
        "misspelling_hunt",
        "discovery",
        "Search common misspellings, alternate spacing, incomplete names, abbreviated titles, generic rookie wording, and listings that omit the parallel or serial run.",
        "Poor search metadata can suppress competition and create underpriced listings.",
    ),
    DealHunterLesson(
        "mixed_lot_discovery",
        "discovery",
        "Search mixed-player, mixed-rookie, assorted Prizm/Donruss/Select, and generic WNBA or sport lots in addition to player-named listings.",
        "The best hidden gems may not name the target player in the title at all.",
    ),
    DealHunterLesson(
        "plain_base_default_exclusion",
        "selection",
        "Exclude ordinary base singles by default; allow base only when the overall lot price or another exceptional condition makes the acquisition compelling.",
        "Deal Hunter should spend capacity on differentiated cards and asymmetric lots.",
    ),
    DealHunterLesson(
        "sold_comps_over_active_asks",
        "pricing",
        "Use exact sold comps as the primary market evidence and treat active asking prices as secondary context, never as proof of realized value.",
        "Inflated active listings can make mediocre deals look artificially cheap.",
    ),
    DealHunterLesson(
        "conservative_resale",
        "pricing",
        "Use a conservative realizable resale estimate after exact-match filtering; exclude graded comps for raw cards unless the analysis explicitly models grading.",
        "Optimistic comp selection creates false profit.",
    ),
    DealHunterLesson(
        "variant_price_validation",
        "marketplace",
        "For multi-item or variation listings, open and validate the exact selected variant and its actual price before scoring the deal.",
        "Marketplace headline prices can belong to a different card or option.",
    ),
    DealHunterLesson(
        "availability_recheck",
        "marketplace",
        "Recheck that the exact listing and exact variant are still purchasable immediately before recommending a deal and provide a direct working link.",
        "A sold or stale listing is not actionable intelligence.",
    ),
    DealHunterLesson(
        "condition_is_economics",
        "condition",
        "Use visible centering, corners, edges, surface damage, print lines, scratches, creases, and seller condition disclosures to reduce expected resale or require review.",
        "A theoretically valuable parallel can still be a bad buy in poor condition.",
    ),
    DealHunterLesson(
        "confidence_fail_closed",
        "confidence",
        "Lower confidence when images are missing, tiny, duplicated, obstructed, or ambiguous; do not promote a MUST BUY from uncertain identity or uncertain economics.",
        "Deal Hunter should fail closed instead of manufacturing precision.",
    ),
    DealHunterLesson(
        "profit_after_exit_costs",
        "economics",
        "Calculate expected profit after acquisition cost, resale marketplace fees, order fees, outbound shipping, supplies, and a return reserve.",
        "Gross spread is not profit.",
    ),
    DealHunterLesson(
        "shipping_can_be_diluted",
        "economics",
        "Prefer free or combined shipping when otherwise equal, but let total lot economics decide; shipping becomes less harmful when enough real value is bundled into one shipment.",
        "Shipping should be modeled, not ignored or used as a simplistic absolute ban.",
    ),
    DealHunterLesson(
        "feedback_is_training_signal",
        "learning",
        "Persist operator BUY, PASS, TOO MUCH, WRONG IDENTITY, WRONG PARALLEL, and shipping/value feedback as decision-learning events without converting unverified guesses into card-identity truth.",
        "Marketplace preference feedback and visual identity labels have different trust semantics and must remain separated.",
    ),
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def total_acquisition_cost(
    *,
    item_price: float | int | None,
    inbound_shipping: float | int | None = None,
    buyer_fees: float | int | None = None,
    tax: float | int | None = None,
) -> float:
    values = (item_price, inbound_shipping, buyer_fees, tax)
    return round(sum(float(value or 0) for value in values), 2)


def shipping_share(
    *,
    item_price: float | int | None,
    inbound_shipping: float | int | None,
    buyer_fees: float | int | None = None,
    tax: float | int | None = None,
) -> float:
    total = total_acquisition_cost(
        item_price=item_price,
        inbound_shipping=inbound_shipping,
        buyer_fees=buyer_fees,
        tax=tax,
    )
    if total <= 0:
        return 0.0
    return round(float(inbound_shipping or 0) / total, 4)


def is_probable_lot(title: str | None) -> bool:
    normalized = f" {str(title or '').lower()} "
    tokens = (
        " lot ",
        " bundle ",
        " collection ",
        " assorted ",
        " cards ",
        " card lot ",
        " rookie lot ",
        " rc lot ",
    )
    return any(token in normalized for token in tokens)


def candidate_policy_receipt(listing: dict[str, Any]) -> dict[str, Any]:
    item_price = listing.get("itemPrice", listing.get("item_price"))
    inbound_shipping = listing.get("inboundShipping", listing.get("inbound_shipping"))
    buyer_fees = listing.get("buyerFees", listing.get("buyer_fees"))
    tax = listing.get("tax")
    title = str(listing.get("title") or "")
    image_urls = listing.get("imageUrls", listing.get("image_urls")) or []
    probable_lot = is_probable_lot(title)
    landed = total_acquisition_cost(
        item_price=item_price,
        inbound_shipping=inbound_shipping,
        buyer_fees=buyer_fees,
        tax=tax,
    )
    ship_share = shipping_share(
        item_price=item_price,
        inbound_shipping=inbound_shipping,
        buyer_fees=buyer_fees,
        tax=tax,
    )
    review_reasons: list[str] = []
    if probable_lot:
        review_reasons.append("lot_requires_multi_card_image_forensics")
    if len(list(dict.fromkeys(str(url) for url in image_urls if url))) < 2:
        review_reasons.append("insufficient_distinct_listing_images")
    if float(item_price or 0) <= 10 and float(inbound_shipping or 0) >= 5:
        review_reasons.append("low_price_high_shipping_requires_hidden_value")
    return {
        "schema_version": "tcos.instacomp-ai.deal-hunter-policy-receipt.v1",
        "policy_version": POLICY_VERSION,
        "total_acquisition_cost_before_estimated_tax": landed,
        "shipping_share_of_known_acquisition_cost": ship_share,
        "probable_lot": probable_lot,
        "image_count": len(list(dict.fromkeys(str(url) for url in image_urls if url))),
        "manual_review_signals": review_reasons,
        "lesson_keys": [lesson.lesson_key for lesson in DEFAULT_DEAL_HUNTER_LESSONS],
    }


def decision_learning_manifest() -> dict[str, Any]:
    return {
        "schema_version": "tcos.instacomp-ai.deal-hunter-decision-learning.v1",
        "policy_version": POLICY_VERSION,
        "lesson_count": len(DEFAULT_DEAL_HUNTER_LESSONS),
        "trusted_lessons": [asdict(lesson) for lesson in DEFAULT_DEAL_HUNTER_LESSONS],
        "separation": {
            "identity_model_training": "card-image/checklist/operator-confirmed identity truth only",
            "deal_hunter_decision_learning": "marketplace discovery, economics, lot forensics, and operator buy/pass feedback",
            "unverified_marketplace_guess_may_become_identity_truth": False,
        },
    }


def initialize_decision_learning(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path, timeout=30) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS deal_hunter_learning_lessons (
                lesson_key TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                rule_text TEXT NOT NULL,
                rationale TEXT NOT NULL,
                trusted INTEGER NOT NULL,
                verification_source TEXT NOT NULL,
                policy_version TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS deal_hunter_learning_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                candidate_key TEXT,
                event_type TEXT NOT NULL,
                trusted INTEGER NOT NULL DEFAULT 1,
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS deal_hunter_learning_events_candidate_idx
                ON deal_hunter_learning_events(candidate_key, created_at DESC);
            """
        )
        now = utc_now_iso()
        for lesson in DEFAULT_DEAL_HUNTER_LESSONS:
            db.execute(
                """
                INSERT INTO deal_hunter_learning_lessons (
                    lesson_key, category, rule_text, rationale, trusted,
                    verification_source, policy_version, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(lesson_key) DO UPDATE SET
                    category = excluded.category,
                    rule_text = excluded.rule_text,
                    rationale = excluded.rationale,
                    trusted = excluded.trusted,
                    verification_source = excluded.verification_source,
                    policy_version = excluded.policy_version,
                    updated_at = excluded.updated_at
                """,
                (
                    lesson.lesson_key,
                    lesson.category,
                    lesson.rule,
                    lesson.rationale,
                    int(lesson.trusted),
                    lesson.verification_source,
                    POLICY_VERSION,
                    now,
                ),
            )


def record_decision_learning_event(
    path: Path,
    *,
    event_type: str,
    candidate_key: str | None = None,
    payload: dict[str, Any] | None = None,
    trusted: bool = True,
) -> None:
    initialize_decision_learning(path)
    with sqlite3.connect(path, timeout=30) as db:
        db.execute(
            """
            INSERT INTO deal_hunter_learning_events (
                candidate_key, event_type, trusted, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                candidate_key,
                str(event_type).strip().upper(),
                int(bool(trusted)),
                json.dumps(payload or {}, sort_keys=True),
                utc_now_iso(),
            ),
        )


def load_decision_lessons(path: Path) -> list[dict[str, Any]]:
    initialize_decision_learning(path)
    with sqlite3.connect(path, timeout=30) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            """
            SELECT lesson_key, category, rule_text, rationale, trusted,
                   verification_source, policy_version, updated_at
            FROM deal_hunter_learning_lessons
            WHERE trusted = 1
            ORDER BY lesson_key
            """
        ).fetchall()
    return [dict(row) for row in rows]


def iter_default_lessons() -> Iterable[DealHunterLesson]:
    return iter(DEFAULT_DEAL_HUNTER_LESSONS)
