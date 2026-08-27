from __future__ import annotations

from pathlib import Path


LIVE_PIPELINE = Path("src/lib/instacomp-live-pipeline.ts")
SELLER_ROUTE = Path("src/app/api/account/seller/inventory/instacomp/route.ts")

STALE_PRICING_FILTER = ".filter(hasTrustedDeliveredPrice)"
CANONICAL_PRICING_FILTER = ".filter(isInstaCompPricingEligibleComp)"

LEGACY_SELLER_HELPER = '''function isPricingEligibleEvidence(row: Evidence, lane: "sold" | "active") {
  if (!row.priceIncludesShipping) return false;
  if (!Number.isFinite(row.itemPrice) || Number(row.itemPrice) <= 0) return false;
  if (!Number.isFinite(row.shippingPrice) || Number(row.shippingPrice) < 0) return false;
  if (lane === "sold" && !row.soldAt) return false;
  return true;
}

'''

CANONICAL_SELLER_MARKER = 'row.source.toLowerCase().startsWith("openai_web_")'
SELLER_FUNCTION_MARKER = 'function isPricingEligibleEvidence(row: Evidence, lane: "sold" | "active")'


def repair_live_pipeline() -> None:
    text = LIVE_PIPELINE.read_text()
    if STALE_PRICING_FILTER in text:
        text = text.replace(STALE_PRICING_FILTER, CANONICAL_PRICING_FILTER)
        LIVE_PIPELINE.write_text(text)
        print("Repaired stale InstaComp delivered-price helper reference.")

    updated = LIVE_PIPELINE.read_text()
    if STALE_PRICING_FILTER in updated:
        raise SystemExit("Stale InstaComp delivered-price helper reference remains.")
    if CANONICAL_PRICING_FILTER not in updated:
        raise SystemExit("Canonical InstaComp pricing-eligibility filter is missing.")


def repair_seller_route() -> None:
    text = SELLER_ROUTE.read_text()
    function_count = text.count(SELLER_FUNCTION_MARKER)

    if function_count > 1:
        if CANONICAL_SELLER_MARKER not in text:
            raise SystemExit(
                "Duplicate seller pricing helpers were found without the canonical discovery-source guard."
            )
        legacy_count = text.count(LEGACY_SELLER_HELPER)
        if legacy_count < 1:
            raise SystemExit(
                "Duplicate seller pricing helpers were found, but the legacy helper could not be identified safely."
            )
        text = text.replace(LEGACY_SELLER_HELPER, "")
        SELLER_ROUTE.write_text(text)
        print(f"Removed {legacy_count} legacy duplicate seller pricing helper(s).")

    updated = SELLER_ROUTE.read_text()
    if updated.count(SELLER_FUNCTION_MARKER) != 1:
        raise SystemExit("Seller pricing helper must exist exactly once after materialization repair.")
    if CANONICAL_SELLER_MARKER not in updated:
        raise SystemExit("Canonical seller discovery-source pricing guard is missing.")


def main() -> None:
    repair_live_pipeline()
    repair_seller_route()
    print("InstaComp materialization idempotency repair passed.")


if __name__ == "__main__":
    main()
