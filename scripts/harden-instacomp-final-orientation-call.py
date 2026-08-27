from pathlib import Path


path = Path("src/app/api/instacomp/scan/route.ts")
text = path.read_text()

required = [
    'import { normalizeInstaCompSideImages }',
    'import { readValidatedInstaCompImage }',
    'const normalizedSides = await normalizeInstaCompSideImages({',
    'imageOrientation?: unknown;',
    'imageOrientation: input.imageOrientation || null,',
]
missing = [value for value in required if value not in text]
if missing:
    raise SystemExit(f"Core scan orientation materialization is incomplete: {missing}")

start = text.find("    const scanId = ephemeralBenchmark")
if start < 0:
    start = text.find("    const scanId = await saveScanToSupabase({")
if start < 0:
    raise SystemExit("Could not locate the InstaComp scan persistence call")
end = text.find("    const reviewReasons =", start)
if end < 0:
    raise SystemExit("Could not locate the end of the InstaComp scan persistence call")
segment = text[start:end]
if "imageOrientation" not in segment:
    anchor = "          catalogEvidence,\n"
    if anchor not in segment:
        anchor = "      catalogEvidence,\n"
    if anchor not in segment:
        raise SystemExit("Could not locate catalog evidence in the scan persistence call")
    segment = segment.replace(
        anchor,
        anchor + anchor.split("catalogEvidence")[0] + "imageOrientation,\n",
        1,
    )
    text = text[:start] + segment + text[end:]

if "      imageOrientation,\n      benchmarkDiagnostics:" not in text:
    anchor = "      catalogEvidence,\n      benchmarkDiagnostics:"
    if anchor not in text:
        raise SystemExit("Could not locate the scan response catalog diagnostics anchor")
    text = text.replace(
        anchor,
        "      catalogEvidence,\n      imageOrientation,\n      benchmarkDiagnostics:",
        1,
    )

if "      ocrDiagnostics: {\n        imageOrientation," not in text:
    anchor = "      ocrDiagnostics: {\n"
    if anchor not in text:
        raise SystemExit("Could not locate OCR diagnostics in the scan response")
    text = text.replace(
        anchor,
        "      ocrDiagnostics: {\n        imageOrientation,\n",
        1,
    )

path.write_text(text)
