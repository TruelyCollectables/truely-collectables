from __future__ import annotations

from pathlib import Path


REPAIR = Path("scripts/apply-instacomp-500-repair.py")
if not REPAIR.exists():
    raise SystemExit("InstaComp 500 repair script is missing")

exec(compile(REPAIR.read_text(), str(REPAIR), "exec"), {"__name__": "__main__"})

MAIN = Path("services/instacomp-ai/app/main.py")
main = MAIN.read_text()

# Keep a human-readable receipt that explicitly records the no-external-reader
# boundary. Support both the legacy wording and the current stricter Registry
# identity + fingerprint wording so this helper is safe to rerun.
legacy_review = (
    '                "InstaComp preserved the front/back scan and checklist receipt, but one exact identity was not proven. Review or correct the card privately."\n'
)
legacy_review_with_proof = (
    '                "InstaComp preserved the front/back scan and checklist receipt, but one exact identity was not proven. No external identity provider was called. Review or correct the card privately."\n'
)
current_review = (
    '                "InstaComp preserved the front/back scan and checklist receipt, but one exact Registry identity with fingerprint proof was not established. Review or correct the card privately."\n'
)
current_review_with_proof = (
    '                "InstaComp preserved the front/back scan and checklist receipt, but one exact Registry identity with fingerprint proof was not established. No external identity provider was called. Review or correct the card privately."\n'
)
if current_review in main:
    main = main.replace(current_review, current_review_with_proof, 1)
elif legacy_review in main:
    main = main.replace(legacy_review, legacy_review_with_proof, 1)
elif "No external identity provider was called" not in main:
    raise SystemExit("Checklist-only review receipt is missing its no-external-provider proof")

analyze = main.split("async def analyze_scan", 1)[1].split(
    '@app.post(\n    "/v1/lessons"', 1
)[0]
if "await reader.analyze(" in analyze:
    raise SystemExit("Ollama identity execution still exists in analyze_scan")
if 'match_source = "ollama_backup"' in analyze:
    raise SystemExit("Ollama identity provenance still exists in analyze_scan")
if "trusted_text_registry_verified = bool(" not in analyze:
    raise SystemExit("Checklist-only review path is missing exact Registry verification")
if "trusted_text_registry.identity_id" not in analyze:
    raise SystemExit("Checklist-only review path is missing Registry identity proof")
if 'receipt.startswith("registry_fingerprint:")' not in analyze:
    raise SystemExit("Checklist-only review path is missing Registry fingerprint proof")

MAIN.write_text(main)

READINESS = Path("src/app/api/instacomp/internal-readiness/route.ts")
readiness = READINESS.read_text()
old_ready = '''    const internalMemoryReady = health.database === "ready";
    const checklistReady = health.checklist === "ready";
    const localModelReady = health.ollama === "ready";
    const ok = internalMemoryReady && checklistReady && localModelReady;'''
new_ready = '''    const internalMemoryReady = health.database === "ready";
    const checklistReady = health.checklist === "ready";
    // InstaComp identity scans are checklist-only. Ollama is not part of readiness.
    const localModelReady = internalMemoryReady && checklistReady;
    const ok = localModelReady;'''
if old_ready in readiness:
    readiness = readiness.replace(old_ready, new_ready, 1)
elif new_ready not in readiness:
    raise SystemExit("Production readiness contract anchor was not found")
READINESS.write_text(readiness)

# Do not overwrite the current regression file with an older generated copy.
# Validate that it already checks the current checklist-only contract and uses
# a path anchored to the service test directory.
STATIC_TEST = Path("services/instacomp-ai/tests/test_checklist_only_scan_contract.py")
if not STATIC_TEST.exists():
    raise SystemExit("Checklist-only static regression is missing")
static_test = STATIC_TEST.read_text()
for marker in [
    'Path(__file__).resolve().parents[1]',
    'assert "await reader.analyze(" not in analyze',
    'assert "trusted_text_registry_verified = bool(" in analyze',
    'assert "trusted_text_registry.identity_id" in analyze',
    'assert \'receipt.startswith("registry_fingerprint:")\' in analyze',
    'assert \'ollama="unchecked"\' in source',
]:
    if marker not in static_test:
        raise SystemExit(f"Checklist-only static regression is missing current marker: {marker}")

print("Applied checklist-only unresolved-scan contract and verified no external identity handoff")
