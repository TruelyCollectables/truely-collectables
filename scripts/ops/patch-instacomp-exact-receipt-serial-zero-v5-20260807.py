from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / "src/lib/instacomp-learning-server.ts"
text = path.read_text(encoding="utf-8")
old = """      serialRun === null;\n"""
new = """      !serialRun;\n"""
if text.count(old) != 1:
    raise SystemExit(f"expected one serial-zero recovery anchor, got {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("PASS Registry serialRun 0/null both mean unnumbered for exact receipt recovery")
