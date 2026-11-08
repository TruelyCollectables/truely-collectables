#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text("utf-8")
    if new in source:
        print(f"already patched {label}: {path}")
        return
    if source.count(old) != 1:
        raise SystemExit(f"{label}: expected one source block in {path}, found {source.count(old)}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}: {path}")


instacomp = Path("src/lib/instacomp.ts")
market_history = Path("src/lib/instacomp-market-history.ts")
price_insights = Path("src/lib/instacomp-ebay-price-insights.ts")

replace_once(
    instacomp,
    '''  soldAt?: string | null;\n  listedAt?: string | null;\n  observedAt?: string | null;\n};\n''',
    '''  soldAt?: string | null;\n  listedAt?: string | null;\n  observedAt?: string | null;\n  conditionText?: string | null;\n  buyingOption?: string | null;\n};\n''',
    "optional market evidence fields",
)

replace_once(
    market_history,
    '''    condition_text: null,\n    match_score: Number.isFinite(Number(comp.matchScore)) ? Number(comp.matchScore) : null,\n''',
    '''    condition_text: String(comp.conditionText || "").trim() || null,\n    match_score: Number.isFinite(Number(comp.matchScore)) ? Number(comp.matchScore) : null,\n''',
    "persist comp condition evidence",
)

replace_once(
    price_insights,
    '''    soldAt,\n    listedAt: null,\n    observedAt: capturedAt,\n  };\n''',
    '''    soldAt,\n    listedAt: null,\n    observedAt: capturedAt,\n    conditionText: condition,\n    buyingOption,\n  };\n''',
    "attach Price Insights evidence to normalized comp",
)

print("Price Insights market evidence preservation ready.")
