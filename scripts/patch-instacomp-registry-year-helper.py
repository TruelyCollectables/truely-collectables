#!/usr/bin/env python3
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "src" / "lib" / "instacomp-checklist-first-server.ts"
source = path.read_text(encoding="utf-8")

helper = '''function registryYearStart(value: unknown) {\n  return normalizedText(value).match(/\\b((?:18|19|20)\\d{2})\\b/)?.[1] || \"\";\n}\n\n'''
marker = '''function boundedOcr(value: unknown) {\n'''
if "function registryYearStart" not in source:
    if marker not in source:
        raise SystemExit("boundedOcr marker missing")
    source = source.replace(marker, helper + marker, 1)

source = source.replace("const requestedYear = yearStart(input.year);", "const requestedYear = registryYearStart(input.year);")
source = source.replace("yearStart(release.release_year || release.season) !== requestedYear", "registryYearStart(release.release_year || release.season) !== requestedYear")
path.write_text(source, encoding="utf-8")
print("patched Registry-local year helper")
