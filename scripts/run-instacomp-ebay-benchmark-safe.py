from pathlib import Path


source_path = Path("scripts/harden-instacomp-ebay-benchmark.py")
source = source_path.read_text().replace(
    'runpy.run_path("scripts/harden-instacomp-catalog-registry.py", run_name="__main__")',
    'runpy.run_path("scripts/run-instacomp-catalog-registry-safe.py", run_name="__main__")',
)
exec(compile(source, str(source_path), "exec"), {"__name__": "__main__"})
