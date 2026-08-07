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

if old not in source:
    if new in source:
        print(f"already fixed {path}")
        raise SystemExit(0)
    raise SystemExit("The local-learning patcher targeting block changed unexpectedly.")

path.write_text(source.replace(old, new, 1), encoding="utf-8")
print(f"fixed {path}")
