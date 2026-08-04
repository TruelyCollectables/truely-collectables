#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

from pydantic import ValidationError

from app.checklist_schema import CHECKLIST_COLUMNS, ChecklistRow


def parse_bool(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y"}


def parse_int(value: str | None) -> int | None:
    text = str(value or "").strip()
    return int(text) if text else None


def load_rows(path: Path) -> tuple[list[ChecklistRow], list[dict]]:
    accepted: list[ChecklistRow] = []
    errors: list[dict] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        missing = [column for column in CHECKLIST_COLUMNS if column not in headers]
        if missing:
            raise ValueError(f"Missing columns: {', '.join(missing)}")
        for line_number, raw in enumerate(reader, start=2):
            try:
                payload = dict(raw)
                payload["serial_run"] = parse_int(payload.get("serial_run"))
                for field in ("rookie", "autograph", "memorabilia"):
                    payload[field] = parse_bool(payload.get(field))
                accepted.append(ChecklistRow.model_validate(payload))
            except (ValidationError, ValueError) as exc:
                errors.append({"line": line_number, "error": str(exc)})
    return accepted, errors


def audit(rows: list[ChecklistRow]) -> dict:
    by_identity: dict[str, list[ChecklistRow]] = defaultdict(list)
    by_source_row: dict[tuple[str, str, str], list[ChecklistRow]] = defaultdict(list)
    for row in rows:
        by_identity[row.identity_fingerprint()].append(row)
        by_source_row[(row.source_release_id, row.source_version, row.row_receipt())].append(row)

    exact_duplicates = []
    conflicts = []
    for fingerprint, group in by_identity.items():
        if len(group) <= 1:
            continue
        receipts = {row.row_receipt() for row in group}
        summary = {
            "identity_fingerprint": fingerprint,
            "count": len(group),
            "players": sorted({row.player for row in group}),
            "sets": sorted({row.set_name for row in group}),
            "sources": sorted({row.source_name for row in group}),
        }
        if len(receipts) == 1:
            exact_duplicates.append(summary)
        else:
            conflicts.append(summary)

    return {
        "schema": "tcos.instacomp-ai.checklist-audit.v1",
        "rows_valid": len(rows),
        "unique_identities": len(by_identity),
        "exact_duplicate_groups": exact_duplicates,
        "conflicting_identity_groups": conflicts,
        "ready_to_import": not conflicts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an InstaComp AI checklist CSV")
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    try:
        rows, errors = load_rows(args.csv_path)
    except (OSError, ValueError) as exc:
        print(json.dumps({"ready_to_import": False, "fatal_error": str(exc)}, indent=2))
        return 2

    report = audit(rows)
    report["file"] = str(args.csv_path)
    report["validation_errors"] = errors
    report["ready_to_import"] = report["ready_to_import"] and not errors
    output = json.dumps(report, indent=2)
    print(output)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output + "\n", encoding="utf-8")
    return 0 if report["ready_to_import"] else 1


if __name__ == "__main__":
    sys.exit(main())
