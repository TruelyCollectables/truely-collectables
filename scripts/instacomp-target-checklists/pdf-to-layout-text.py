#!/usr/bin/env python3

from pathlib import Path
import sys

from pypdf import PdfReader


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: pdf-to-layout-text.py <input.pdf> <output.txt>")

    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    if not source.is_file():
        raise FileNotFoundError(source)

    reader = PdfReader(str(source))
    parts: list[str] = []
    for page in reader.pages:
        text = page.extract_text(extraction_mode="layout") or ""
        parts.append(text.rstrip())

    output = "\n\f\n".join(parts).rstrip() + "\n"
    if not output.strip():
        raise RuntimeError(f"no text extracted from {source}")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(output, encoding="utf-8")


if __name__ == "__main__":
    main()
