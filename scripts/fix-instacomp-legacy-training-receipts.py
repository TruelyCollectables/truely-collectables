#!/usr/bin/env python3
from pathlib import Path

path = Path("services/instacomp-ai/app/training.py")
source = path.read_text(encoding="utf-8")

import_old = '''    ChecklistResult,\n'''
import_new = '''    ChecklistOutcome,\n    ChecklistResult,\n'''
if import_new not in source:
    if source.count(import_old) != 1:
        raise SystemExit("training.py ChecklistResult import changed unexpectedly")
    source = source.replace(import_old, import_new, 1)

old = '''    checklist = ChecklistResult.model_validate(scan["checklist"])\n'''
new = '''    checklist_payload = scan.get("checklist")\n    if isinstance(checklist_payload, dict) and checklist_payload.get("outcome"):\n        checklist = ChecklistResult.model_validate(checklist_payload)\n    else:\n        checklist_confirmed = lesson.state == LearningState.CHECKLIST_CONFIRMED\n        checklist = ChecklistResult(\n            outcome=(\n                ChecklistOutcome.EXACT_MATCH\n                if checklist_confirmed\n                else ChecklistOutcome.INPUT_INCOMPLETE\n            ),\n            identity_id=None,\n            identity=lesson.identity if checklist_confirmed else None,\n            candidate_count=1 if checklist_confirmed else 0,\n            reasons=[\n                "Legacy scan did not preserve a Checklist Registry receipt."\n            ],\n            source_receipts=["legacy_scan_checklist_receipt_missing"],\n        )\n'''
if new not in source:
    if source.count(old) != 1:
        raise SystemExit("training.py checklist validation block changed unexpectedly")
    source = source.replace(old, new, 1)

path.write_text(source, encoding="utf-8")
print(f"fixed {path}")
