from __future__ import annotations

from typing import Any, Mapping

QUARANTINE_COUNT_KEYS = (
    "skipped_incomplete_structured_identity",
    "skipped_no_usable_image",
    "skipped_image_error",
    "skipped_current_inventory_pair_identity_conflict",
    "skipped_missing_inventory_key",
)

FATAL_COUNT_KEYS = (
    "skipped_lesson_create_error",
)


def _count(mapping: Mapping[str, Any], key: str) -> int:
    try:
        return max(0, int(mapping.get(key) or 0))
    except (TypeError, ValueError):
        return 0


def apply_learning_completion_policy(receipt: dict[str, Any]) -> dict[str, Any]:
    """Separate strict inventory census coverage from LoRA eligibility.

    Strict coverage remains all detected card inventory rows. Rows that cannot
    become visual training examples are never hidden: they are quarantined with
    explicit reasons. LoRA eligibility reaches 100% only when every
    non-quarantined row is represented and no fatal importer errors remain.
    """
    counts = receipt.setdefault("counts", {})
    strict = receipt.setdefault("strict_inventory_coverage", {})
    training = receipt.setdefault("training", {})
    safety = receipt.setdefault("safety", {})

    total = _count(strict, "inventory_card_total")
    represented = _count(strict, "inventory_card_rows_represented")
    if total <= 0:
        total = _count(training, "inventory_card_rows_total")
    if represented <= 0:
        represented = _count(training, "inventory_card_rows_represented")

    quarantine_by_reason = {
        key: _count(counts, key)
        for key in QUARANTINE_COUNT_KEYS
        if _count(counts, key)
    }
    quarantined = sum(quarantine_by_reason.values())
    fatal_by_reason = {
        key: _count(counts, key)
        for key in FATAL_COUNT_KEYS
        if _count(counts, key)
    }
    fatal = sum(fatal_by_reason.values())

    # Every inventory card must be accounted for exactly once as represented,
    # quarantined, or unresolved. Never turn an accounting gap into "coverage".
    accounted = represented + quarantined
    unresolved = max(0, total - accounted)
    over_accounted = max(0, accounted - total)

    learned_unique = _count(training, "inventory_eligible_learned")
    eligible_outstanding = unresolved + fatal + over_accounted
    eligible_total = learned_unique + eligible_outstanding
    eligible_coverage = (
        100.0
        if learned_unique > 0 and eligible_outstanding == 0
        else (
            0.0
            if eligible_total <= 0
            else round((learned_unique / eligible_total) * 100.0, 2)
        )
    )

    training["inventory_eligible_total"] = eligible_total
    training["inventory_training_coverage_percent"] = eligible_coverage
    training["inventory_training_outstanding"] = eligible_outstanding
    training["inventory_card_rows_quarantined"] = quarantined
    training["inventory_card_rows_unresolved"] = unresolved
    training["inventory_card_rows_accounting_overage"] = over_accounted
    training["eligibility_denominator"] = "image_backed_unambiguous_training_examples"
    training["strict_inventory_training_coverage_percent"] = float(
        strict.get("inventory_training_coverage_percent") or 0.0
    )

    receipt["training_quarantine"] = {
        "quarantined_inventory_rows": quarantined,
        "quarantine_reasons": quarantine_by_reason,
        "fatal_importer_rows": fatal,
        "fatal_reasons": fatal_by_reason,
        "unresolved_inventory_rows": unresolved,
        "accounting_overage_rows": over_accounted,
        "policy": (
            "Rows without sufficient structured identity, without a usable image, "
            "with an exhausted image fetch, or with conflicting identities for the "
            "same exact image bytes are excluded from LoRA eligibility but remain "
            "visible in the strict all-card inventory audit."
        ),
    }

    safety["strict_all_card_inventory_audit_preserved"] = True
    safety["nontrainable_rows_quarantined_not_counted_as_learned"] = True
    safety["lora_eligibility_requires_zero_unresolved_nonquarantined_rows"] = True

    return receipt
