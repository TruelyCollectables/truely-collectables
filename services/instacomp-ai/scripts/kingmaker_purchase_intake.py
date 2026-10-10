#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.config import Settings  # noqa: E402
from app.kingmaker_accounting import KingmakerAccounting, RECEIVING_CUTOVER_DATE  # noqa: E402



def _parse_purchase_time(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _format_cutoff(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat(timespec="seconds")


def _latest_source_cutoff(
    accounting_db: Path,
    source: str,
    base_cutoff: str,
    *,
    overlap_hours: float,
) -> tuple[str, str | None]:
    """Start from the last recorded buy, with a small overlap for late-arriving rows."""
    try:
        db = sqlite3.connect(accounting_db, timeout=10)
        row = db.execute(
            "SELECT MAX(purchased_at) FROM acquisition_items WHERE source=? AND purchased_at IS NOT NULL",
            (source,),
        ).fetchone()
        db.close()
    except sqlite3.Error:
        return base_cutoff, None

    latest_raw = str((row or [None])[0] or "").strip()
    latest = _parse_purchase_time(latest_raw)
    base = _parse_purchase_time(base_cutoff)
    if latest is None:
        return base_cutoff, None
    candidate = latest - timedelta(hours=max(0.0, float(overlap_hours)))
    if base is not None:
        try:
            comparable_base = base.astimezone(candidate.tzinfo) if candidate.tzinfo else base.replace(tzinfo=None)
            if candidate < comparable_base:
                return base_cutoff, latest_raw
        except (ValueError, TypeError):
            pass
    return _format_cutoff(candidate), latest_raw

def _run_json(command: list[str], *, cwd: Path, env: dict[str, str] | None = None, timeout: int = 240) -> dict[str, Any]:
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    raw = str(completed.stdout or "").strip()
    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        payload = {
            "ok": False,
            "error": f"Purchase intake returned invalid JSON (exit {completed.returncode}): "
            + str(completed.stderr or raw)[-1200:],
        }
    if completed.returncode != 0 and payload.get("ok") is not False:
        payload["ok"] = False
        payload["error"] = str(completed.stderr or f"exit {completed.returncode}")[-1200:]
    return payload


def _ebay(cutoff: str) -> dict[str, Any]:
    runner = SERVICE_ROOT / "scripts" / "kingmaker_ebay_purchase_intake.ts"
    local_env = Path.home() / "Library/Application Support/TCOS-Current-Review/.env.local"
    node = shutil.which("node") or "/opt/homebrew/bin/node"
    if not runner.exists():
        return {"ok": False, "source": "eBay", "error": "eBay purchase-intake runner is missing"}
    if not local_env.exists():
        return {"ok": False, "source": "eBay", "error": "TCOS production environment file is unavailable"}
    env = os.environ.copy()
    shared_node_modules = Path("/Users/davidbakanas/TruelyCollectables/truely-collectables/node_modules")
    node_paths = [str(SERVICE_ROOT / "node-shims"), str(REPO_ROOT / "node_modules")]
    if shared_node_modules.exists():
        node_paths.append(str(shared_node_modules))
    if env.get("NODE_PATH"):
        node_paths.append(env["NODE_PATH"])
    env["NODE_PATH"] = os.pathsep.join(node_paths)
    return _run_json(
        [
            node,
            "--conditions=react-server",
            f"--env-file={local_env}",
            "--import",
            "tsx",
            str(runner),
            cutoff,
        ],
        cwd=REPO_ROOT,
        env=env,
        timeout=180,
    )


def _mercari(cutoff: str) -> dict[str, Any]:
    runner = SERVICE_ROOT / "scripts" / "kingmaker_mercari_purchase_intake.py"
    return _run_json(
        [sys.executable, str(runner), cutoff],
        cwd=REPO_ROOT,
        timeout=300,
    )


def _record_source(accounting: KingmakerAccounting, payload: dict[str, Any]) -> dict[str, Any]:
    source = str(payload.get("source") or "Unknown")
    created = 0
    updated = 0
    errors: list[dict[str, str]] = []
    records = payload.get("records") if isinstance(payload.get("records"), list) else []
    for record in records:
        if not isinstance(record, dict):
            continue
        try:
            result = accounting.record_acquisition_item(record)
            if result.get("created"):
                created += 1
            else:
                updated += 1
        except Exception as exc:
            errors.append({"sourceKey": str(record.get("source_key") or ""), "error": str(exc)[:600]})
    return {
        "source": source,
        "feedOk": payload.get("ok") is True,
        "observed": len(records),
        "created": created,
        "updated": updated,
        "feedErrors": payload.get("errors") or [],
        "recordErrors": errors,
        "error": payload.get("error"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Sep-16+ eBay/Mercari purchases into KINGMAKER Pending Receiving.")
    parser.add_argument("--cutoff", default=f"{RECEIVING_CUTOVER_DATE}T00:00:00-06:00")
    parser.add_argument("--scan-db", default=None)
    parser.add_argument("--accounting-db", default=None)
    parser.add_argument("--skip-ebay", action="store_true")
    parser.add_argument("--skip-mercari", action="store_true")
    args = parser.parse_args()

    settings = Settings()
    scan_db = Path(args.scan_db).expanduser().resolve() if args.scan_db else settings.resolve_local_path(settings.database_path)
    accounting_db = (
        Path(args.accounting_db).expanduser().resolve()
        if args.accounting_db
        else scan_db.parent / "database" / "kingmaker_accounting.sqlite3"
    )
    accounting = KingmakerAccounting(accounting_db, scan_db)
    accounting.initialize()

    # Incremental marketplace intake: each source starts from the newest purchase
    # already preserved in the Mac ledger instead of replaying everything since
    # the receiving cutover. Small overlaps are intentional for late-arriving rows.
    source_cutoffs: dict[str, dict[str, str | None]] = {}
    feeds: list[dict[str, Any]] = []
    if not args.skip_ebay:
        ebay_cutoff, ebay_latest = _latest_source_cutoff(
            accounting_db, "eBay", args.cutoff, overlap_hours=2.0
        )
        source_cutoffs["eBay"] = {
            "cutoff": ebay_cutoff,
            "latestRecordedPurchase": ebay_latest,
        }
        feeds.append(_ebay(ebay_cutoff))
    if not args.skip_mercari:
        # Mercari purchase history can be day-granular, so keep a 36-hour overlap
        # to catch another purchase that appears later with the same calendar date.
        mercari_cutoff, mercari_latest = _latest_source_cutoff(
            accounting_db, "Mercari", args.cutoff, overlap_hours=36.0
        )
        source_cutoffs["Mercari"] = {
            "cutoff": mercari_cutoff,
            "latestRecordedPurchase": mercari_latest,
        }
        feeds.append(_mercari(mercari_cutoff))

    results = [_record_source(accounting, payload) for payload in feeds]
    pending = accounting.pending_purchases(RECEIVING_CUTOVER_DATE)
    feed_failures = [row for row in results if not row["feedOk"]]
    record_failures = sum(len(row["recordErrors"]) for row in results)
    print(
        json.dumps(
            {
                "ok": not feed_failures and record_failures == 0,
                "code": "KINGMAKER_PURCHASE_INTAKE_COMPLETE" if not feed_failures and record_failures == 0 else "KINGMAKER_PURCHASE_INTAKE_PARTIAL",
                "cutoff": args.cutoff,
                "sourceCutoffs": source_cutoffs,
                "scanDatabase": str(scan_db),
                "accountingDatabase": str(accounting_db),
                "sources": results,
                "pendingCount": sum(1 for row in pending if row.get("awaitingOwnScan")),
                "matchedPendingCount": sum(1 for row in pending if row.get("receiptStatus") == "pending_purchase"),
                "totalTrackedSinceCutoff": len(pending),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
