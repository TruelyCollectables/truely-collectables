#!/usr/bin/env python3
from pathlib import Path

path = Path("scripts/patch-instacomp-local-learning-stack.py")
source = path.read_text(encoding="utf-8")

old = '''replace_count(
    main,
    ''' + "'''" + '''            suggestion=None,\\n            checklist_result=''' + "'''" + ''',
    ''' + "'''" + '''            suggestion=None,\\n            local_vision=None,\\n            checklist_result=''' + "'''" + ''',
    1,
)
'''
new = '''replace_once(
    main,
    ''' + "'''" + '''            suggestion=None,\\n            checklist_result=checklist_result,\\n            status=status,\\n''' + "'''" + ''',
    ''' + "'''" + '''            suggestion=None,\\n            local_vision=None,\\n            checklist_result=checklist_result,\\n            status=status,\\n''' + "'''" + ''',
)
'''

if old in source:
    source = source.replace(old, new, 1)
elif new not in source:
    raise SystemExit("The local-learning patcher targeting block changed unexpectedly.")

anchor = 'requirements = service / "requirements.txt"\n\n'
guard = '''requirements = service / "requirements.txt"\n\n# Idempotence guard: workflow reruns operate on the branch after the first run has\n# committed the generated runtime. Do not try to apply source replacements twice.\n_runtime_markers = [\n    (models, "class LocalVisionEvidence"),\n    (storage, "CREATE TABLE IF NOT EXISTS training_examples"),\n    (main, "analyze_local_vision"),\n    (ollama, "deterministic_local_evidence"),\n    (config, "training_export_path"),\n    (requirements, "opencv-python-headless"),\n]\nif all(\n    marker in runtime_path.read_text(encoding="utf-8")\n    for runtime_path, marker in _runtime_markers\n):\n    print("local learning runtime already patched")\n    raise SystemExit(0)\n\n'''

if guard not in source:
    if source.count(anchor) != 1:
        raise SystemExit("The local-learning patcher path declaration block changed unexpectedly.")
    source = source.replace(anchor, guard, 1)

path.write_text(source, encoding="utf-8")
print(f"fixed {path}")
