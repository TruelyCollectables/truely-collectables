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

parallel_pattern = re.compile(
    r"parallel_start = '''.*?'''\nparallel_end = ",
    re.DOTALL,
)
parallel_replacement = (
    'parallel_start = "    const parallelProfile = targetParallelProfile("\n'
    "parallel_end = "
)
script, count = parallel_pattern.subn(parallel_replacement, script, count=1)
if count != 1:
    raise SystemExit(
        f"V2 Registry parallel marker definition changed; refusing to run ({count} replacements)."
    )

old_guardrail_block = '''guardrails = Path("scripts/check-production-guardrails.mjs")
replace_once(
    guardrails,
    "production consensus guardrail",
    '  "catalog parallel lacks agreement from two independent scanner families",\\n',
    ''' + '"""' + '''  "catalog Base parallel conflicts with unresolved visible surface/finish evidence",
  "catalog non-Base parallel lacks visible scanner support",
  "parallelGroupMatchesCatalog",
''' + '"""' + ''',
)
'''
new_guardrail_block = '''guardrails = Path("scripts/check-production-guardrails.mjs")
guardrails_text = guardrails.read_text()
old_guardrail_marker = '  "catalog parallel lacks agreement from two independent scanner families",\\n'
if guardrails_text.count(old_guardrail_marker) != 2:
    raise SystemExit(
        f"Production consensus guardrail markers changed; refusing to patch ({guardrails_text.count(old_guardrail_marker)} matches)."
    )
guardrails_text = guardrails_text.replace(
    old_guardrail_marker,
    ''' + '"""' + '''  "catalog Base parallel conflicts with unresolved visible surface/finish evidence",
  "catalog non-Base parallel lacks visible scanner support",
  "parallelGroupMatchesCatalog",
''' + '"""' + ''',
    1,
)
guardrails_text = guardrails_text.replace(
    old_guardrail_marker,
    '  "parallelGroupMatchesCatalog",\\n',
    1,
)
guardrails.write_text(guardrails_text)
'''
if script.count(old_guardrail_block) != 1:
    raise SystemExit(
        f"V2 production guardrail patch block changed; refusing to run ({script.count(old_guardrail_block)} matches)."
    )
script = script.replace(old_guardrail_block, new_guardrail_block, 1)

patch_script = Path(".codex-run/registry-semantic-referee-v4.py")
patch_script.parent.mkdir(parents=True, exist_ok=True)
patch_script.write_text(script)
subprocess.run(["python", str(patch_script)], check=True)
