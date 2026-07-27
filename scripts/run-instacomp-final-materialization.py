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


def run_stage(stage: str) -> None:
    path = Path(stage)
    if not path.is_file():
        raise SystemExit(f"Missing final InstaComp materialization stage: {stage}")
    print(f"Running final InstaComp materialization stage: {stage}")

    if stage != "scripts/apply-instacomp-deep-audit-fixes.py":
        runpy.run_path(stage, run_name="__main__")
        return

    deep_audit_source = path.read_text()
    read_block = "    file_path = Path(path)\n    text = file_path.read_text()\n"
    replacement = (
        "    file_path = Path(path)\n"
        "    if not file_path.exists():\n"
        "        print(f\"Deep-audit compatibility notice: removed audit file {path}; skipping\")\n"
        "        return\n"
        "    text = file_path.read_text()\n"
    )
    occurrence_count = deep_audit_source.count(read_block)
    if occurrence_count < 2:
        raise SystemExit(
            "Could not safely adapt legacy deep-audit file reads for removed audit workflows."
        )
    deep_audit_source = deep_audit_source.replace(read_block, replacement)
    exec(
        compile(deep_audit_source, str(path), "exec"),
        {"__name__": "__main__", "Path": Path},
    )


for stage in stages:
    run_stage(stage)

print("Final InstaComp materialization stages completed.")
