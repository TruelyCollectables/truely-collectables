#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text(encoding="utf-8")
    if new in source:
        print(f"already patched {label}: {path}")
        return
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block in {path}, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}: {path}")


routes = ROOT / "services/instacomp-ai/app/training_routes.py"
importer = ROOT / "services/instacomp-ai/scripts/import_supervised_203_trusted.py"

replace_once(
    routes,
    'async def examples(trusted_only: bool = Query(default=True), limit: int = Query(default=100, ge=1, le=2000)):',
    'async def examples(trusted_only: bool = Query(default=True), limit: int = Query(default=100, ge=1, le=100_000)):',
    "training examples limit aligned with storage",
)

replace_once(
    importer,
    '''    except Exception:\n        return False\n''',
    '''    except httpx.HTTPStatusError as exc:\n        status = exc.response.status_code if exc.response is not None else "unknown"\n        body = exc.response.text[:600] if exc.response is not None else str(exc)\n        print(\n            f"VERIFY HTTP ERROR scan={scan_id} card={card_uuid} status={status}: {body}",\n            file=sys.stderr,\n            flush=True,\n        )\n        return False\n    except Exception as exc:\n        print(\n            f"VERIFY ERROR scan={scan_id} card={card_uuid}: {type(exc).__name__}: {exc}",\n            file=sys.stderr,\n            flush=True,\n        )\n        return False\n''',
    "trusted readback diagnostics",
)

print("Supervised 203 trusted readback contract patch complete.")
