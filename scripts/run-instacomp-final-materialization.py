from pathlib import Path
import runpy


stages = [
    "scripts/harden-instacomp-final-audit.py",
    "scripts/harden-instacomp-final-audit-2.py",
    "scripts/harden-instacomp-final-deduplicate.py",
]

for stage in stages:
    path = Path(stage)
    if not path.is_file():
        raise SystemExit(f"Missing final InstaComp materialization stage: {stage}")
    print(f"Running final InstaComp materialization stage: {stage}")
    runpy.run_path(stage, run_name="__main__")

print("Final InstaComp materialization stages completed.")
