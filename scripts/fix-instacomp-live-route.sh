#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash local changes first."
  git status --short
  exit 1
fi

git pull --ff-only origin main

python3 - <<'PY'
from pathlib import Path
import re

path = Path('src/app/api/instacomp/scan/route.ts')
text = path.read_text()
original = text

if 'instacomp-ai-council-runtime' not in text:
    pattern = re.compile(
        r'(import\s*\{\s*formatUntrustedOcrEvidence,\s*normalizeOpenAiCompatibleBaseUrl,\s*openAiCompatibleProviderFamily,\s*resolveInstaCompCouncilPolicy,?\s*\}\s*from\s*"\.\./\.\./\.\./\.\./lib/instacomp-ai-council-security";)'
    )
    replacement = r'''\1
import {
  prioritizeIndependentCouncilProviders,
  shouldContinueCouncilRuntime,
} from "../../../../lib/instacomp-ai-council-runtime";'''
    text, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit('FAILED: could not insert runtime import exactly once')

if 'const configuredPlan = prioritizeIndependentCouncilProviders(' not in text:
    pattern = re.compile(
        r'const providerPlan = buildAiCouncilProviderPlan\(\);\s*'
        r'const configuredPlan = providerPlan\.filter\(\(provider\) => provider\.configured\);\s*'
        r'const configuredFamilies = Array\.from\(\s*new Set\(configuredPlan\.map\(\(provider\) => provider\.family\)\),?\s*\);'
    )
    replacement = '''const providerPlan = buildAiCouncilProviderPlan();
  const configuredPlan = prioritizeIndependentCouncilProviders(
    providerPlan.filter((provider) => provider.configured),
    "openai",
  );
  const configuredFamilies = Array.from(
    new Set(configuredPlan.map((provider) => provider.family)),
  );'''
    text, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit('FAILED: could not prioritize configured provider plan exactly once')

if 'let completedFamilies: string[] = [];' not in text:
    pattern = re.compile(
        r'let cursor = 0;\s*let completedReaders = 0;\s*'
        r'while\s*\(\s*completedReaders < desiredReaders\s*&&\s*cursor < configuredPlan\.length\s*\)\s*\{'
    )
    replacement = '''let cursor = 0;
  let completedReaders = 0;
  let completedFamilies: string[] = [];

  while (
    shouldContinueCouncilRuntime({
      completedReaders,
      desiredReaders,
      completedFamilies,
      configuredFamilies,
      cursor,
      configuredReaderCount: configuredPlan.length,
      primaryFamily: "openai",
    })
  ) {'''
    text, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit('FAILED: could not replace council loop exactly once')

if 'completedFamilies = Array.from(' not in text:
    pattern = re.compile(
        r'allAttempts\.push\(\.\.\.batchAttempts\);\s*'
        r'completedReaders = allAttempts\.filter\(\(attempt\) => attempt\.reader\)\.length;'
    )
    replacement = '''allAttempts.push(...batchAttempts);
    const completed = allAttempts.flatMap((attempt) =>
      attempt.reader ? [attempt.reader] : [],
    );
    completedReaders = completed.length;
    completedFamilies = Array.from(
      new Set(completed.map((reader) => reader.family)),
    );'''
    text, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit('FAILED: could not add completed-family accounting exactly once')

required = [
    'instacomp-ai-council-runtime',
    'prioritizeIndependentCouncilProviders(',
    'shouldContinueCouncilRuntime({',
    'let completedFamilies: string[] = [];',
    'completedFamilies = Array.from(',
]
missing = [needle for needle in required if needle not in text]
if missing:
    raise SystemExit(f'FAILED: live route proof missing {missing}')

if text != original:
    path.write_text(text)
    print('Patched live InstaComp route.')
else:
    print('Live InstaComp route already contains the full patch.')
PY

grep -q 'instacomp-ai-council-runtime' src/app/api/instacomp/scan/route.ts
grep -q 'prioritizeIndependentCouncilProviders' src/app/api/instacomp/scan/route.ts
grep -q 'shouldContinueCouncilRuntime' src/app/api/instacomp/scan/route.ts
grep -q 'completedFamilies' src/app/api/instacomp/scan/route.ts

npx tsx scripts/run-instacomp-ai-council-runtime-regressions.ts
npx tsx scripts/run-instacomp-registry-consensus-bridge-regression.ts
npx tsx scripts/run-instacomp-live-shedeur-107-regression.ts
npx tsx scripts/run-instacomp-identity-firewall-regressions.ts
npx tsx scripts/run-instacomp-serial-color-gate-regressions.ts
npm run simulate:instacomp-consensus
npm run simulate:instacomp-scan-review
npm run simulate:instacomp-identity-guard
npx eslint src/app/api/instacomp/scan/route.ts src/lib/instacomp-ai-council-runtime.ts scripts/run-instacomp-ai-council-runtime-regressions.ts
npx tsc --noEmit

if git diff --quiet -- src/app/api/instacomp/scan/route.ts; then
  echo "Route was already patched; no route commit needed."
  exit 0
fi

git diff --exit-code -- . ':(exclude)src/app/api/instacomp/scan/route.ts'
git add src/app/api/instacomp/scan/route.ts
git commit -m "Wire independent AI families into live InstaComp route"
git push origin HEAD:main

echo "SUCCESS: live InstaComp route patched, validated, committed, and pushed."
