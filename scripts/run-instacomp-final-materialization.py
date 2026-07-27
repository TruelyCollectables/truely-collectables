from pathlib import Path
import runpy


final_audit_path = Path("scripts/harden-instacomp-final-audit.py")
if not final_audit_path.is_file():
    raise SystemExit(f"Missing final InstaComp materialization stage: {final_audit_path}")

print(f"Running final InstaComp materialization stage: {final_audit_path}")
source = final_audit_path.read_text()
source = source.replace(
    '        raise SystemExit(f"Could not locate {label} block")',
    '        print(f"Final hardening notice: {label} block was already changed or moved")\n        return text',
)
source = source.replace(
    '        raise SystemExit(f"Could not locate {label} pattern")',
    '        print(f"Final hardening notice: {label} pattern was already changed or moved")\n        return text',
)
source = source.replace(
    "    patch_benchmark_source()\n",
    '''    benchmark_source = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts").read_text()
    if 'from "../../../../../lib/instacomp-benchmark-title";' in benchmark_source:
        print("Final hardening notice: benchmark title library already extracted; skipping route helper insertion")
    else:
        patch_benchmark_source()
''',
)
exec(compile(source, str(final_audit_path), "exec"), {"__name__": "__main__", "Path": Path})

stages = [
    "scripts/harden-instacomp-final-orientation-call.py",
    "scripts/harden-instacomp-final-audit-2.py",
    "scripts/harden-instacomp-final-deduplicate.py",
    "scripts/harden-instacomp-final-async-regressions.py",
    "scripts/harden-instacomp-final-library-extraction.py",
    "scripts/apply-instacomp-deep-audit-fixes.py",
    "scripts/apply-instacomp-serpapi-schema-fix.py",
    "scripts/apply-instacomp-provider-status-fix.py",
    "scripts/repair-instacomp-materialization-idempotency.py",
    "scripts/assert-instacomp-final-source.py",
]

for stage in stages:
    path = Path(stage)
    if not path.is_file():
        raise SystemExit(f"Missing final InstaComp materialization stage: {stage}")
    print(f"Running final InstaComp materialization stage: {stage}")
    runpy.run_path(stage, run_name="__main__")

print("Final InstaComp materialization stages completed.")
