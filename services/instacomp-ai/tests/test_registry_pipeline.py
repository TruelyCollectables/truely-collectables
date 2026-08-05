from pathlib import Path

import pytest

from app.checklist import RegistryChecklistGateway
from app.models import CardIdentity, ChecklistOutcome, LearningState, LessonCreate
from app.storage import MemoryStore


class FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.content = b"{}"
        self.is_success = 200 <= status_code < 300

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, response: FakeResponse):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, *_args, **_kwargs):
        return self.response


@pytest.mark.asyncio
async def test_registry_exact_match_requires_id_and_fingerprint(monkeypatch):
    monkeypatch.setenv("INSTACOMP_AI_REGISTRY_URL", "https://example.test")
    response = FakeResponse(200, {
        "ok": True,
        "status": "exact_match",
        "registryIdentityId": "registry-1",
        "registryFingerprintSha256": "abc123",
        "candidateCount": 1,
        "lockedFields": {
            "year": "2025",
            "manufacturer": "Upper Deck",
            "player": "Ivan Demidov",
            "cardNumber": "201",
            "parallel": "Young Guns",
        },
    })
    monkeypatch.setattr("app.checklist.httpx.AsyncClient", lambda **_kwargs: FakeClient(response))
    result = await RegistryChecklistGateway().match(CardIdentity(
        year="2025", manufacturer="Upper Deck", player="Ivan Demidov", card_number="201"
    ))
    assert result.outcome == ChecklistOutcome.EXACT_MATCH
    assert result.identity_id == "registry-1"
    assert "registry_fingerprint:abc123" in result.source_receipts


@pytest.mark.asyncio
async def test_registry_match_without_fingerprint_stays_blocked(monkeypatch):
    monkeypatch.setenv("INSTACOMP_AI_REGISTRY_URL", "https://example.test")
    response = FakeResponse(200, {
        "ok": True,
        "status": "exact_match",
        "registryIdentityId": "registry-1",
        "lockedFields": {},
    })
    monkeypatch.setattr("app.checklist.httpx.AsyncClient", lambda **_kwargs: FakeClient(response))
    result = await RegistryChecklistGateway().match(CardIdentity(
        year="2025", manufacturer="Upper Deck", player="Ivan Demidov", card_number="201"
    ))
    assert result.outcome != ChecklistOutcome.EXACT_MATCH


def test_only_verified_lessons_enter_trusted_memory(tmp_path: Path):
    store = MemoryStore(tmp_path / "memory.sqlite3")
    store.initialize()
    store.save_scan(scan_id="scan-1", created_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
                    front_sha256="a", back_sha256=None, image_pair_sha256="b",
                    local_suggestion=None, checklist={}, status="needs_review")
    identity = CardIdentity(year="2025", player="Ivan Demidov", set_name="Upper Deck", card_number="201")
    untrusted = store.create_lesson(LessonCreate(scan_id="scan-1", state=LearningState.TEACHER_SUGGESTED,
        identity=identity, verification_source="model"))
    assert untrusted.trusted is False
    assert store.search(identity) == []
    trusted = store.create_lesson(LessonCreate(scan_id="scan-1", state=LearningState.OPERATOR_CONFIRMED,
        identity=identity, verification_source="operator", operator_id="owner"))
    assert trusted.trusted is True
    assert store.search(identity)[0].lesson_id == trusted.lesson_id
