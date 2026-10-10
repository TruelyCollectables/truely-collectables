from __future__ import annotations

import importlib
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient


def test_kingmaker_control_truth_gate_and_purchase_link(tmp_path, monkeypatch):
    control_db = tmp_path / "control.sqlite3"
    accounting_db = tmp_path / "accounting.sqlite3"
    monkeypatch.setenv("KINGMAKER_CONTROL_DB", str(control_db))

    import app.kingmaker_control as control
    control = importlib.reload(control)
    control.ACCOUNTING_DB = accounting_db
    control.sync_deal_hunter = lambda limit=500: 0

    with sqlite3.connect(accounting_db) as db:
        db.execute("CREATE TABLE acquisition_items (id INTEGER PRIMARY KEY, purchase_id TEXT)")
        db.execute("INSERT INTO acquisition_items(id,purchase_id) VALUES(1,'SMOKE-PURCHASE-1')")
        db.commit()

    client = TestClient(control.app)
    headers = {"X-InstaComp-AI-Key": control.settings.api_key} if control.settings.api_key else {}
    blocked = client.post(
        "/v1/kingmaker/opportunities/upsert-listing",
        headers=headers,
        json={"listing": {
            "sourceType": "manual",
            "sourceKey": "smoke-unverified",
            "title": "Smoke unverified",
            "identityStatus": "review_required",
            "marketStatus": "unverified",
        }},
    )
    assert blocked.status_code == 200
    blocked_id = blocked.json()["opportunity"]["id"]
    buy_blocked = client.post(
        f"/v1/kingmaker/opportunities/{blocked_id}/decision",
        headers=headers,
        json={"decision": "buy", "reason": "truth gate regression"},
    )
    assert buy_blocked.status_code == 409

    watched = client.post(
        f"/v1/kingmaker/opportunities/{blocked_id}/decision",
        headers=headers,
        json={"decision": "watch", "reason": "watch regression"},
    )
    assert watched.status_code == 200
    assert watched.json()["opportunity"]["lifecycleStatus"] == "watching"

    verified = client.post(
        "/v1/kingmaker/opportunities/upsert-listing",
        headers=headers,
        json={"listing": {
            "sourceType": "manual",
            "sourceKey": "smoke-verified",
            "title": "Smoke verified",
            "identityStatus": "verified_exact",
            "marketStatus": "verified_completed_sales",
        }},
    )
    assert verified.status_code == 200
    verified_id = verified.json()["opportunity"]["id"]
    buy = client.post(
        f"/v1/kingmaker/opportunities/{verified_id}/decision",
        headers=headers,
        json={"decision": "buy", "reason": "verified regression"},
    )
    assert buy.status_code == 200
    assert buy.json()["opportunity"]["ownerDecision"] == "buy"

    linked = client.post(
        f"/v1/kingmaker/opportunities/{verified_id}/purchase-link",
        headers=headers,
        json={"purchaseReference": "SMOKE-PURCHASE-1"},
    )
    assert linked.status_code == 200
    opportunity = linked.json()["opportunity"]
    assert opportunity["lifecycleStatus"] == "bought"
    assert opportunity["purchaseReference"] == "SMOKE-PURCHASE-1"
    assert opportunity["truthConsistent"] is True
