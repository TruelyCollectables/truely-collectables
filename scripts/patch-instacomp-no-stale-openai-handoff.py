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

print("Applied checklist-only unresolved-scan contract and removed the manufactured HTTP 500")
