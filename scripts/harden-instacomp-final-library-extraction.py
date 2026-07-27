from pathlib import Path


ROUTE_IMPORT = '''import {
  benchmarkTitleEligible,
  benchmarkTitleHasExpectedYear,
} from "../../../../../lib/instacomp-benchmark-title";
'''


def patch_benchmark_route() -> None:
    path = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")
    text = path.read_text()

    if ROUTE_IMPORT not in text:
        anchor = '''} from "../../../../../lib/instacomp-ebay-benchmark-cases";
'''
        if anchor not in text:
            raise SystemExit("Could not locate benchmark-case import anchor")
        text = text.replace(anchor, anchor + ROUTE_IMPORT, 1)

    start = text.find("const BENCHMARK_VARIATION_CUES")
    end = text.find("function titleScore", start if start >= 0 else 0)
    if start >= 0:
        if end < 0:
            raise SystemExit("Could not locate benchmark helper block end")
        text = text[:start] + text[end:]

    old_filter = '''        !rejectedTitle(title) &&
        !titleConflictsWithExpectedParallel(title, testCase) &&
        titleHasExpectedParallel(title, testCase) &&
        titleHasExpectedSerialRun(title, testCase) &&
        score >= 65,
'''
    legacy_filter = '''        !rejectedTitle(title) &&
        !titleConflictsWithExpectedParallel(title, testCase) &&
        score >= 65,
'''
    final_filter = '''        benchmarkTitleEligible(title, testCase) &&
        score >= 65,
'''
    if final_filter not in text:
        if old_filter in text:
            text = text.replace(old_filter, final_filter, 1)
        elif legacy_filter in text:
            text = text.replace(legacy_filter, final_filter, 1)
        else:
            raise SystemExit("Could not locate benchmark source eligibility filter")

    path.write_text(text)


def patch_regression_import() -> None:
    path = Path("scripts/run-instacomp-final-audit-regressions.ts")
    text = path.read_text()
    text = text.replace(
        'from "../src/app/api/instacomp/benchmark/ebay-25/route";',
        'from "../src/lib/instacomp-benchmark-title";',
    )
    if 'from "../src/lib/instacomp-benchmark-title";' not in text:
        raise SystemExit("Final audit regression did not import the benchmark title library")
    path.write_text(text)


def patch_grade_descriptors() -> None:
    path = Path("src/lib/instacomp.ts")
    text = path.read_text()
    text = text.replace(
        "gem|near|nm|mint|pristine)",
        "gem|near|nm|mint|pristine|mt|ex)",
    )
    if "gem|near|nm|mint|pristine|mt|ex" not in text:
        raise SystemExit("Could not enforce GEM MT grade descriptor support")
    path.write_text(text)


def main() -> None:
    patch_benchmark_route()
    patch_regression_import()
    patch_grade_descriptors()


if __name__ == "__main__":
    main()
