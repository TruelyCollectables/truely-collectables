from __future__ import annotations

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if new in text:
        print(f"Already patched {path}")
        return
    if text.count(old) != 1:
        raise SystemExit(f"Refusing to patch {path}: expected exactly one target, found {text.count(old)}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"Patched {path}")


replace_once(
    "services/instacomp-ai/app/models.py",
    '    checklist: Literal["not_configured", "ready"]\n',
    '    checklist: Literal["not_configured", "ready"]\n    runtime_source_fingerprint: str\n',
)

replace_once(
    "services/instacomp-ai/app/main.py",
    'from .printed_evidence import (\n    identity_from_printed_evidence,\n    parse_printed_evidence,\n)\nfrom .settings_routes import build_settings_router\n',
    'from .printed_evidence import (\n    identity_from_printed_evidence,\n    parse_printed_evidence,\n)\nfrom .runtime_identity import runtime_source_fingerprint\nfrom .settings_routes import build_settings_router\n',
)
replace_once(
    "services/instacomp-ai/app/main.py",
    '        checklist="ready" if checklist_ready else "not_configured",\n    )\n',
    '        checklist="ready" if checklist_ready else "not_configured",\n        runtime_source_fingerprint=runtime_source_fingerprint(),\n    )\n',
)

replace_once(
    "src/app/api/instacomp/internal-readiness/route.ts",
    '        version: typeof health.version === "string" ? health.version : null,\n        architecture: ["instacomp_ai"],\n',
    '        version: typeof health.version === "string" ? health.version : null,\n        runtimeSourceFingerprint:\n          typeof health.runtime_source_fingerprint === "string"\n            ? health.runtime_source_fingerprint\n            : null,\n        architecture: ["instacomp_ai"],\n',
)
