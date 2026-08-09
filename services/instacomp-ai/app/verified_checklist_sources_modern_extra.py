from __future__ import annotations

from . import verified_checklist_sources as registry
from .verified_checklist_sources import VerifiedChecklistSource


# Follow-up exact reconciliations for modern targets whose source-crawl slugs
# are generic or article-shaped. Keep them separate during the recovery sprint
# so each reconciliation remains reviewable; the module mutates the same
# target-scoped index before runtime_compat snapshots the verified URL set.
_EXTRA_SOURCES = (
    VerifiedChecklistSource(
        "baseball|2023|topps|topps",
        "beckett",
        "2023 Topps Baseball Factory Set Checklist",
        "https://www.beckett.com/news/2023-topps-baseball-factory-sets/",
        90,
        "Full 660-card 2023 Topps flagship checklist from Beckett factory-set master list",
    ),
    VerifiedChecklistSource(
        "basketball|2023-24|panini|donruss-optic-nba-trading-box-fast-break",
        "beckett",
        "2023-24 Donruss Optic Basketball Checklist",
        "https://www.beckett.com/news/2023-24-donruss-optic-basketball-cards/",
        90,
        "Full Beckett master checklist; Fast Break is a configuration of the same Donruss Optic release",
    ),
    VerifiedChecklistSource(
        "baseball|2024|topps|chrome-cosmic-x-cactus-jack-news-and",
        "beckett",
        "2024 Topps Cosmic Chrome x Cactus Jack Baseball Checklist",
        "https://www.beckett.com/news/2024-topps-cosmic-chrome-cactus-jack-baseball-cards/",
        90,
        "Full 50-card Beckett checklist; target slug is a crawl artifact for this real release",
    ),
    VerifiedChecklistSource(
        "baseball|2024|topps|spotlight",
        "beckett",
        "2024 Topps Spotlight Baseball Checklist",
        "https://www.beckett.com/news/2024-topps-spotlight-baseball-cards/",
        90,
        "Full Beckett master checklist for the 100-card Topps Spotlight release",
    ),
    VerifiedChecklistSource(
        "baseball|2024|topps|topps",
        "beckett",
        "2024 Topps Baseball Factory Set Checklist",
        "https://www.beckett.com/news/2024-topps-baseball-factory-set-details/",
        90,
        "Full 700-card 2024 Topps flagship checklist from Beckett factory-set master list",
    ),
    VerifiedChecklistSource(
        "baseball|2025|topps|topps",
        "beckett",
        "2025 Topps Baseball Factory Set Checklist",
        "https://www.beckett.com/news/2025-topps-baseball-factory-set-details/",
        90,
        "Full 700-card 2025 Topps flagship checklist from Beckett factory-set master list",
    ),
    VerifiedChecklistSource(
        "baseball|2026|topps|topps",
        "beckett",
        "2026 Topps Baseball Factory Set Checklist",
        "https://www.beckett.com/news/2026-topps-baseball-factory-set/",
        90,
        "Full 700-card 2026 Topps flagship checklist from Beckett factory-set master list",
    ),
)


for source in _EXTRA_SOURCES:
    registry._SOURCES = (*registry._SOURCES, source)
    registry._BY_TARGET[source.target_key] = (
        *registry._BY_TARGET.get(source.target_key, ()),
        source,
    )
