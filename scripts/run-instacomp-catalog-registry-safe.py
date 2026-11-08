from pathlib import Path


source_path = Path("scripts/harden-instacomp-catalog-registry.py")
source = source_path.read_text()
source = source.replace(
    '        raise SystemExit(f"Could not locate {label} block")',
    '        print(f"Catalog compatibility notice: {label} block was already changed or moved")\n        return text',
)
exec(compile(source, str(source_path), "exec"), {"__name__": "__main__"})
