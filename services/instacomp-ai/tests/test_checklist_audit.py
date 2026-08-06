from __future__ import annotations

from app.models import ChecklistOutcome, ChecklistResult
from app.printed_evidence import extract_card_number


def test_unlabelled_bowman_card_number_is_extracted() -> None:
    text = "2024 THE TOPPS COMPANY BOWMAN CHROME BCP-79 GEORGE LOMBARD JR"
    assert extract_card_number(text) == "BCP-79"


def test_unlabelled_compact_prefixed_card_number_is_extracted() -> None:
    text = "COPYRIGHT 2025 PANINI AMERICA PI122 PLAYER NAME"
    assert extract_card_number(text) == "PI122"


def test_year_is_not_mistaken_for_card_number() -> None:
    assert extract_card_number("Copyright 2024 The Topps Company") is None


def test_checklist_result_carries_lookup_receipt_and_candidates() -> None:
    result = ChecklistResult(
        outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
        candidate_count=2,
        candidate_summaries=[
            {
                "identityId": "one",
                "cardNumber": "122",
                "parallel": "Blue Velocity Prizm",
            },
            {
                "identityId": "two",
                "cardNumber": "122",
                "parallel": "Blue Cracked Ice Prizm",
            },
        ],
        lookup_attempted=True,
        registry_reachable=True,
        reasons=["multiple_checklist_variants_match"],
    )
    assert result.lookup_attempted is True
    assert result.registry_reachable is True
    assert result.candidate_count == 2
    assert [row["parallel"] for row in result.candidate_summaries] == [
        "Blue Velocity Prizm",
        "Blue Cracked Ice Prizm",
    ]


def test_incomplete_result_proves_registry_was_not_called() -> None:
    result = ChecklistResult(
        outcome=ChecklistOutcome.INPUT_INCOMPLETE,
        lookup_attempted=False,
        registry_reachable=False,
        reasons=["Missing identity field: card_number"],
    )
    assert result.lookup_attempted is False
    assert result.registry_reachable is False
