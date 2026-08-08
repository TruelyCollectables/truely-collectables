#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "services" / "instacomp-ai" / "app" / "sentinel_store.py"
ROUTES = ROOT / "services" / "instacomp-ai" / "app" / "sentinel_routes.py"


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected exactly one patch anchor, found {count}: {old[:120]!r}"
        )
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


store_source = STORE.read_text(encoding="utf-8")
if "def requeue_targets(" not in store_source:
    anchor = '''    def due_targets(self, limit: int) -> list[dict[str, Any]]:\n'''
    addition = '''    def requeue_targets(\n        self,\n        target_keys: list[str],\n        *,\n        priority: int = 1,\n    ) -> dict[str, int]:\n        \"\"\"Force unresolved targets due now without touching recovered truth.\n\n        This is intentionally narrow: it preserves attempts, search history,\n        findings, downloads and recovered targets. It only moves unresolved\n        target states back to pending and makes them immediately due.\n        \"\"\"\n        unique_keys = list(dict.fromkeys(\n            str(value).strip() for value in target_keys if str(value).strip()\n        ))\n        if not unique_keys:\n            return {\n                \"requested\": 0,\n                \"matched\": 0,\n                \"requeued\": 0,\n                \"recovered_skipped\": 0,\n                \"other_skipped\": 0,\n            }\n\n        normalized_priority = max(1, min(100, int(priority)))\n        placeholders = \",\".join(\"?\" for _ in unique_keys)\n        now = iso_now()\n        requeueable = {\"pending\", \"no_result\", \"lead_only\", \"failed\"}\n\n        with self.connection() as db:\n            rows = db.execute(\n                f\"SELECT target_key, status FROM checklist_sentinel_targets WHERE target_key IN ({placeholders})\",\n                unique_keys,\n            ).fetchall()\n            matched = len(rows)\n            recovered_skipped = sum(1 for row in rows if row[\"status\"] == \"recovered\")\n            eligible = [row[\"target_key\"] for row in rows if row[\"status\"] in requeueable]\n            other_skipped = matched - recovered_skipped - len(eligible)\n\n            if eligible:\n                eligible_placeholders = \",\".join(\"?\" for _ in eligible)\n                db.execute(\n                    f\"\"\"\n                    UPDATE checklist_sentinel_targets\n                    SET status = 'pending',\n                        next_search_at = ?,\n                        priority = CASE WHEN priority > ? THEN ? ELSE priority END,\n                        updated_at = ?\n                    WHERE target_key IN ({eligible_placeholders})\n                      AND status IN ('pending', 'no_result', 'lead_only', 'failed')\n                    \"\"\",\n                    [now, normalized_priority, normalized_priority, now, *eligible],\n                )\n\n        return {\n            \"requested\": len(unique_keys),\n            \"matched\": matched,\n            \"requeued\": len(eligible),\n            \"recovered_skipped\": recovered_skipped,\n            \"other_skipped\": other_skipped,\n        }\n\n'''
    replace_once(STORE, anchor, addition + anchor)

routes_source = ROUTES.read_text(encoding="utf-8")
if '@protected.post("/requeue-targets")' not in routes_source:
    anchor = '''    @protected.get("/targets")\n'''
    addition = '''    @protected.post("/requeue-targets")\n    async def requeue_targets(payload: Any = Body(...)) -> dict[str, Any]:\n        if not isinstance(payload, dict):\n            raise HTTPException(status_code=400, detail=\"Object payload required.\")\n        raw_keys = payload.get(\"target_keys\") or payload.get(\"targetKeys\") or []\n        if not isinstance(raw_keys, list):\n            raise HTTPException(status_code=400, detail=\"target_keys must be a list.\")\n        target_keys = [str(value).strip() for value in raw_keys if str(value).strip()]\n        if not target_keys or len(target_keys) > 500:\n            raise HTTPException(\n                status_code=400,\n                detail=\"Provide between 1 and 500 target keys.\",\n            )\n        try:\n            priority = int(payload.get(\"priority\") or 1)\n        except (TypeError, ValueError):\n            raise HTTPException(status_code=400, detail=\"priority must be an integer.\")\n\n        result = sentinel.store.requeue_targets(target_keys, priority=priority)\n        launch = None\n        if result.get(\"requeued\"):\n            launch = await sentinel.trigger(trigger=\"priority-requeue\")\n        return {\n            \"ok\": True,\n            \"requeue\": result,\n            \"launch\": launch,\n            \"targets\": sentinel.store.target_counts(),\n        }\n\n'''
    replace_once(ROUTES, anchor, addition + anchor)

print("patched Sentinel unresolved-target today sprint")
