from __future__ import annotations

from pathlib import Path


REPAIR = Path("scripts/apply-instacomp-500-repair.py")
if not REPAIR.exists():
    raise SystemExit("InstaComp 500 repair script is missing")

exec(compile(REPAIR.read_text(), str(REPAIR), "exec"), {"__name__": "__main__"})

MAIN = Path("services/instacomp-ai/app/main.py")
main = MAIN.read_text()
old_review = (
    '                "InstaComp preserved the front/back scan and checklist receipt, but one exact identity was not proven. Review or correct the card privately."\n'
)
new_review = (
    '                "InstaComp preserved the front/back scan and checklist receipt, but one exact identity was not proven. No external identity provider was called. Review or correct the card privately."\n'
)
if old_review in main:
    main = main.replace(old_review, new_review, 1)
elif "No external identity provider was called" not in main:
    raise SystemExit("Checklist-only review receipt is missing its no-external-provider proof")

if "await reader.analyze(" in main.split("async def analyze_scan", 1)[1].split(
    '@app.post(\n    "/v1/lessons"', 1
)[0]:
    raise SystemExit("Ollama identity execution still exists in analyze_scan")

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

# The underlying repair script historically emitted an invalid Python string in
# this static regression. Rewrite it here so repeated repairs remain safe.
STATIC_TEST = Path(
    "services/instacomp-ai/tests/test_checklist_only_scan_contract.py"
)
STATIC_TEST.write_text('''from pathlib import Path


def analyze_source() -> str:
    source = Path("services/instacomp-ai/app/main.py").read_text()
    lesson_marker = '\\n@app.post(\\n    "/v1/lessons"'
    return source.split("async def analyze_scan", 1)[1].split(
        lesson_marker, 1
    )[0]


def test_analyze_scan_has_no_ollama_identity_call():
    analyze = analyze_source()
    assert "await reader.analyze(" not in analyze
    assert "CHECKLIST-ONLY REVIEW PATH" in analyze
    assert 'status = "needs_review"' in analyze


def test_unresolved_scan_still_builds_and_saves_response():
    analyze = analyze_source()
    assert "result = AnalyzeResponse(" in analyze
    assert "_save_scan(" in analyze
    assert "return result" in analyze


def test_health_marks_ollama_unchecked():
    source = Path("services/instacomp-ai/app/main.py").read_text()
    assert 'ollama="unchecked"' in source
    assert 'ollama_model="disabled_for_identity_scans"' in source
''')

print("Applied checklist-only unresolved-scan contract and removed the manufactured HTTP 500")
