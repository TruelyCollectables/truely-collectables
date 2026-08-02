#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "fix/instacomp-learning-trust-gate"


def run(args: list[str], *, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(args), flush=True)
    result = subprocess.run(
        args,
        cwd=ROOT,
        text=True,
        check=False,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    if capture and result.stdout:
        print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
    if check and result.returncode != 0:
        raise SystemExit(result.returncode)
    return result


def patch_payload_type() -> None:
    path = ROOT / "src/lib/instacomp-learning-server.ts"
    text = path.read_text()
    fixed = "  const payload: Record<string, any> = registryMatch\n    ? {"
    if fixed in text:
        return
    old = "  const payload = registryMatch\n    ? {"
    count = text.count(old)
    if count != 1:
        raise RuntimeError(
            f"Expected one learning payload declaration to annotate, found {count}"
        )
    path.write_text(text.replace(old, fixed, 1))


current = run(["git", "branch", "--show-current"], capture=True).stdout.strip().splitlines()[-1]
if current != BRANCH:
    raise RuntimeError(f"Run this on {BRANCH}; current branch is {current}")

patch_payload_type()

# Keep one-shot helper scripts out of the final PR diff.
for helper in [
    ROOT / "scripts/apply-instacomp-learning-trust-gate.py",
    ROOT / "scripts/resume-instacomp-learning-trust-gate.py",
]:
    if helper.exists():
        helper.unlink()

run(["git", "diff", "--check"])
run(["npx", "tsx", "scripts/run-instacomp-consensus-simulations.ts"])
run(["npx", "tsx", "scripts/run-instacomp-exact-market-proof-regressions.ts"])
run(["npx", "tsx", "scripts/run-instacomp-learning-trust-gate-regressions.ts"])
run([
    "npx",
    "eslint",
    "src/app/api/instacomp/scan/route.ts",
    "src/app/api/instacomp/scan-fast/route.ts",
    "src/app/api/instacomp/knowledge/confirm/route.ts",
    "src/lib/instacomp-learning-server.ts",
    "scripts/run-instacomp-learning-trust-gate-regressions.ts",
])
run(["npm", "run", "build"])
run(["git", "diff", "--check"])
run(["git", "status", "--short"])

run(["git", "add", "-A"])
run(["git", "commit", "-m", "Gate InstaComp learning on trusted identity"])
run(["git", "push", "-u", "origin", BRANCH])

existing = run(
    [
        "gh", "pr", "list", "--head", BRANCH, "--state", "open",
        "--json", "number", "--jq", ".[0].number",
    ],
    capture=True,
    check=False,
).stdout.strip().splitlines()
pr_number = existing[-1].strip() if existing and existing[-1].strip().isdigit() else ""

if not pr_number:
    created = run(
        [
            "gh", "pr", "create",
            "--base", "main",
            "--head", BRANCH,
            "--title", "Gate InstaComp learning on trusted exact identity",
            "--body",
            "## What changed\n- automatic catalog learning now requires trusted consensus, an allowed comp-search decision, and matching checklist identity IDs\n- unresolved catalog evidence is quarantined as candidate evidence and cannot authorize exact comps, pricing, listings, or cache replay\n- owner confirmation of an untrusted scan requires a complete explicit identity, including serial number when present\n- database triggers demote unsafe catalog and operator confirmations in observations and replayable cache rows\n- existing unsafe confirmation rows are demoted and affected knowledge entries are recalculated\n\n## Validation\n- consensus simulations\n- exact-market proof regressions\n- learning trust-gate TypeScript regressions\n- targeted ESLint\n- full Next.js production build\n- dedicated Postgres trust-gate regression in CI",
        ],
        capture=True,
    )
    for line in reversed(created.stdout.strip().splitlines()):
        if "/pull/" in line:
            pr_number = line.rsplit("/", 1)[-1]
            break

if not pr_number:
    raise RuntimeError("Could not determine pull request number")

print(f"Watching PR #{pr_number} checks...", flush=True)
run(["gh", "pr", "checks", pr_number, "--watch", "--interval", "10"])
run(["gh", "pr", "merge", pr_number, "--squash", "--delete-branch"])
run(["git", "switch", "main"])
run(["git", "pull", "--ff-only"])
run(["git", "status", "--short"])
run(["git", "log", "-1", "--oneline"])
print(f"DONE: PR #{pr_number} merged and local main synchronized.")
