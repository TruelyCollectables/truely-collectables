from __future__ import annotations

import re
from pathlib import Path


def function_spans(text: str, name: str) -> list[tuple[int, int]]:
    pattern = re.compile(
        rf"(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+{re.escape(name)}\s*\(",
    )
    spans: list[tuple[int, int]] = []
    for match in pattern.finditer(text):
        start = match.start() + (1 if text[match.start():].startswith("\n") else 0)
        opening_paren = text.find("(", match.start(), match.end())
        if opening_paren < 0:
            raise SystemExit(f"Could not find opening parenthesis for {name}")

        paren_depth = 0
        params_end = -1
        index = opening_paren
        while index < len(text):
            character = text[index]
            if character == "(":
                paren_depth += 1
            elif character == ")":
                paren_depth -= 1
                if paren_depth == 0:
                    params_end = index + 1
                    break
            index += 1
        if params_end < 0:
            raise SystemExit(f"Could not find closing parenthesis for {name}")

        opening = text.find("{", params_end)
        if opening < 0:
            raise SystemExit(f"Could not find opening brace for {name}")
        depth = 0
        index = opening
        while index < len(text):
            character = text[index]
            if character == "{":
                depth += 1
            elif character == "}":
                depth -= 1
                if depth == 0:
                    end = index + 1
                    while end < len(text) and text[end] in " \t":
                        end += 1
                    if end < len(text) and text[end] == "\n":
                        end += 1
                    spans.append((start, end))
                    break
            index += 1
        else:
            raise SystemExit(f"Could not find closing brace for {name}")
    return spans


def keep_first_function(path: Path, name: str) -> None:
    text = path.read_text()
    spans = function_spans(text, name)
    if len(spans) <= 1:
        return
    for start, end in reversed(spans[1:]):
        text = text[:start] + text[end:]
    path.write_text(text)


def main() -> None:
    benchmark_path = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")
    keep_first_function(benchmark_path, "titleHasExactCardNumber")

    live_path = Path("src/app/api/instacomp/live-scan/route.ts")
    keep_first_function(live_path, "forceVisualProof")
    keep_first_function(live_path, "providerAfterVisualReview")

    catalog_path = Path("src/lib/instacomp-curated-checklist.ts")
    keep_first_function(catalog_path, "catalogTokens")
    keep_first_function(catalog_path, "normalizedPlayerKey")
    keep_first_function(catalog_path, "catalogYearStart")

    regression_path = Path("scripts/run-instacomp-exact-market-proof-regressions.ts")
    regression = regression_path.read_text().replace(
        'benchmarkSource.includes("titleHasExpectedSerialRun")',
        'benchmarkSource.includes("benchmarkTitleHasExpectedSerialRun")',
    )
    regression_path.write_text(regression)


if __name__ == "__main__":
    main()
