from pathlib import Path


source_path = Path("scripts/harden-instacomp-certification-round2.py")
source = source_path.read_text()
source = source.replace(
    '        raise SystemExit(f"Could not locate {label} block")',
    '        print(f"Round-two hardening notice: {label} block was already changed or moved")\n        return text',
)
source = source.replace(
    '        raise SystemExit(f"Could not locate {label} pattern")',
    '        print(f"Round-two hardening notice: {label} pattern was already changed or moved")\n        return text',
)
source = source.replace(
    '        raise SystemExit("Could not locate regression completion marker")',
    '        print("Round-two hardening notice: regression completion marker was already changed")\n        return',
)

# The round-two generator embeds JavaScript regexes inside Python triple-quoted
# strings. Execute those generated-code blocks as raw strings so regex word
# boundaries such as \b are never converted into backspace control characters.
source = source.replace("        '''function", "        r'''function")
source = source.replace("        '''    year:", "        r'''    year:")

exec(compile(source, str(source_path), "exec"), {"__name__": "__main__"})

for generated_path in (
    Path("src/lib/instacomp-curated-checklist.ts"),
    Path("src/app/api/instacomp/benchmark/ebay-25/route.ts"),
):
    generated = generated_path.read_text()
    if "\x08" in generated:
        raise SystemExit(
            f"Generated InstaComp source contains a backspace control character: {generated_path}"
        )
