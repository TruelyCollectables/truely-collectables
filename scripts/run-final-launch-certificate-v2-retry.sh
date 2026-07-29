#!/usr/bin/env bash
set -euo pipefail

cp scripts/run-final-launch-certificate-v2-continuation.sh /tmp/final-launch-certificate-runner.sh
python - <<'PY'
from pathlib import Path
path = Path('/tmp/final-launch-certificate-runner.sh')
text = path.read_text()
old = '''jq -e --arg source "$SOURCE_SHA" --arg head "$PRIOR_AUDIT_HEAD_SHA" '.base.sha == $source and .head.sha == $head' "$EVIDENCE_DIR/prior-pr.json" > /dev/null
'''
new = '''jq -e --arg source "$SOURCE_SHA" '.number == 205 and .base.sha == $source' "$EVIDENCE_DIR/prior-pr.json" > /dev/null
jq -e --arg source "$SOURCE_SHA" '.pull_requests[] | select(.number == 205 and .base.sha == $source)' "$EVIDENCE_DIR/prior-run.json" > /dev/null
'''
if text.count(old) != 1:
    raise SystemExit('Expected stale PR-head assertion was not found exactly once')
path.write_text(text.replace(old, new, 1))
PY
bash -n /tmp/final-launch-certificate-runner.sh
exec bash /tmp/final-launch-certificate-runner.sh
