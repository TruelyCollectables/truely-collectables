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

old_set_match = '''return (
        readerTokens.length > 0 &&
        readerTokens.every((token) => catalogTokens.has(token)) &&
        logicalSetTokens.every((token) => readerTokens.includes(token))
      );'''
new_set_match = '''return (
        readerTokens.length > 0 &&
        readerTokens.every((token) => catalogTokens.has(token))
      );'''
if script.count(old_set_match) != 1:
    raise SystemExit(
        f"V2 semantic set-match boundary changed; refusing to run ({script.count(old_set_match)} matches)."
    )
script = script.replace(old_set_match, new_set_match, 1)

guardrail_start = 'guardrails = Path("scripts/check-production-guardrails.mjs")\n'
if script.count(guardrail_start) != 1:
    raise SystemExit(
        f"V2 production guardrail stanza changed; refusing to run ({script.count(guardrail_start)} starts)."
    )
guardrail_offset = script.index(guardrail_start)
old_guardrail_tail = script[guardrail_offset:]
old_marker = 'catalog parallel lacks agreement from two independent scanner families'
if old_guardrail_tail.count(old_marker) != 1:
    raise SystemExit(
        f"V2 terminal guardrail marker changed; refusing to run ({old_guardrail_tail.count(old_marker)} matches)."
    )
if not old_guardrail_tail.rstrip().endswith(")"):
    raise SystemExit("V2 terminal guardrail stanza no longer ends the patch script.")

new_guardrail_tail = '''guardrails = Path("scripts/check-production-guardrails.mjs")
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
script = script[:guardrail_offset] + new_guardrail_tail

patch_script = Path(".codex-run/registry-semantic-referee-v4.py")
patch_script.parent.mkdir(parents=True, exist_ok=True)
patch_script.write_text(script)
subprocess.run(["python", str(patch_script)], check=True)
