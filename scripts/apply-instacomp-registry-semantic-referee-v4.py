from pathlib import Path
import re
import subprocess

workflow = Path(
    ".github/workflows/apply-instacomp-registry-semantic-referee-v2.yml"
).read_text()
marker = "          python - <<'PY'\n"
if workflow.count(marker) != 1:
    raise SystemExit(
        f"V2 Python patch marker changed; refusing to run ({workflow.count(marker)} matches)."
    )
start = workflow.index(marker) + len(marker)
end_marker = "\n          PY\n"
end = workflow.index(end_marker, start)
lines = workflow[start:end].splitlines()
script = "\n".join(
    line[10:] if line.startswith("          ") else line for line in lines
) + "\n"

pattern = re.compile(
    r"parallel_start = '''.*?'''\nparallel_end = ",
    re.DOTALL,
)
replacement = (
    'parallel_start = "    const parallelProfile = targetParallelProfile("\n'
    "parallel_end = "
)
script, count = pattern.subn(replacement, script, count=1)
if count != 1:
    raise SystemExit(
        f"V2 Registry parallel marker definition changed; refusing to run ({count} replacements)."
    )

patch_script = Path(".codex-run/registry-semantic-referee-v4.py")
patch_script.parent.mkdir(parents=True, exist_ok=True)
patch_script.write_text(script)
subprocess.run(["python", str(patch_script)], check=True)
