from pathlib import Path


bad: list[tuple[str, list[int]]] = []
for root in (Path("src"), Path("scripts")):
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in {
            ".ts",
            ".tsx",
            ".js",
            ".mjs",
            ".py",
            ".json",
        }:
            continue
        data = path.read_bytes()
        controls = sorted({byte for byte in data if byte < 32 and byte not in {9, 10, 13}})
        if controls:
            bad.append((str(path), controls))

if bad:
    raise SystemExit(f"Control characters found: {bad}")

print("No hidden control characters found in InstaComp source or audit scripts.")
