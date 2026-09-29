from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.registry_routes import build_registry_router


MATCH = {
    "identityId": "identity-1",
    "fingerprintSha256": "a" * 64,
    "year": "2026",
    "manufacturer": "Topps",
    "brand": "Topps",
    "setName": "ROOKIES",
    "cardNumber": "301",
    "player": "Fernando Mendoza",
    "parallel": "Base",
}


class FakeStore:
    def __init__(self, *, accept_receipt: bool) -> None:
        self.accept_receipt = accept_receipt
        self.revalidate_calls = 0
        self.resolve_calls = 0

    def revalidate_receipt(self, probe, identity_id, fingerprint):
        self.revalidate_calls += 1
        if not self.accept_receipt:
            return None
        return {
            "status": "internal_exact_match",
            "match": MATCH,
            "candidateCount": 1,
            "reasons": ["receipt_revalidated"],
        }

    def resolve(self, probe):
        self.resolve_calls += 1
        return {
            "status": "internal_exact_match",
            "match": MATCH,
            "candidateCount": 1,
            "reasons": ["fallback_exact"],
        }

    def stats(self):
        return {}


def client_for(store: FakeStore) -> TestClient:
    app = FastAPI()
    app.include_router(build_registry_router(lambda: None, store))
    return TestClient(app)


def payload():
    return {
        "year": "2026",
        "manufacturer": "Topps",
        "brand": "Topps",
        "setName": "ROOKIES",
        "cardNumber": "301",
        "player": "Fernando Mendoza",
        "parallel": "Base",
        "registryIdentityId": MATCH["identityId"],
        "registryFingerprintSha256": MATCH["fingerprintSha256"],
    }


def test_registry_lock_marks_successful_receipt_revalidation_accepted():
    store = FakeStore(accept_receipt=True)
    response = client_for(store).post("/api/instacomp/registry-lock", json=payload())
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "exact_match"
    assert body["receiptRevalidationAttempted"] is True
    assert body["receiptRevalidationAccepted"] is True
    assert store.revalidate_calls == 1
    assert store.resolve_calls == 0


def test_registry_lock_marks_fallback_exact_as_not_receipt_accepted():
    store = FakeStore(accept_receipt=False)
    response = client_for(store).post("/api/instacomp/registry-lock", json=payload())
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "exact_match"
    assert body["receiptRevalidationAttempted"] is True
    assert body["receiptRevalidationAccepted"] is False
    assert store.revalidate_calls == 1
    assert store.resolve_calls == 1
