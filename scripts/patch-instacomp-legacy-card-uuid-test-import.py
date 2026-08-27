#!/usr/bin/env python3
from pathlib import Path

path = Path("services/instacomp-ai/tests/test_card_uuid_tracking.py")
source = path.read_text(encoding="utf-8")
old = "from datetime import datetime, timedelta, timezone\n\nimport pytest\n"
new = "from datetime import datetime, timedelta, timezone\nfrom uuid import UUID\n\nimport pytest\n"
if new not in source:
    if source.count(old) != 1:
        raise SystemExit("test import anchor changed unexpectedly")
    source = source.replace(old, new, 1)
    path.write_text(source, encoding="utf-8")
print("legacy UUID test import ready")
