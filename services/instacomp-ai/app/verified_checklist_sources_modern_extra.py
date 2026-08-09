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


# Recovery-only complete-page fallbacks. These exact URLs were selected after
# the earlier Beckett/Topps validation pass exposed either bot-view teaser rows,
# parser conflicts, or a clearly incomplete PDF parse. Checklist Insider pages
# expose the complete checklist in rendered HTML and commonly link an XLSX copy.
# The score is intentionally above the earlier recovery sources so the direct
# recovery runner validates the complete page first; Registry truth still has to
# pass the normal parser/plan/import gates before promotion.
_COMPLETE_PAGE_SOURCES = (
    ("baseball|2023|topps|topps", "https://www.checklistinsider.com/2023-topps-baseball-complete"),
    ("baseball|2024|bowman|bowman", "https://www.checklistinsider.com/2024-bowman-baseball"),
    ("baseball|2024|bowman|chrome", "https://www.checklistinsider.com/2024-bowman-chrome-baseball"),
    ("baseball|2024|bowman|chrome-sapphire", "https://www.checklistinsider.com/2024-bowman-chrome-sapphire-baseball"),
    ("baseball|2024|bowman|draft", "https://www.checklistinsider.com/2024-bowman-draft-baseball"),
    ("baseball|2024|donruss|donruss", "https://www.checklistinsider.com/2024-donruss-baseball"),
    ("baseball|2024|panini|crusade", "https://www.checklistinsider.com/2024-panini-crusade-baseball"),
    ("baseball|2024|topps|206", "https://www.checklistinsider.com/2024-topps-206-baseball"),
    ("baseball|2024|topps|allen-and-ginter", "https://www.checklistinsider.com/2024-topps-allen-and-ginter-baseball"),
    ("baseball|2024|topps|chrome-cosmic-x-cactus-jack-news-and", "https://www.checklistinsider.com/2024-topps-cosmic-chrome-x-cactus-jack-baseball"),
    ("baseball|2024|topps|chrome-sapphire", "https://www.checklistinsider.com/2024-topps-chrome-sapphire-baseball"),
    ("baseball|2024|topps|chrome-sapphire-edition", "https://www.checklistinsider.com/2024-topps-chrome-sapphire-baseball"),
    ("baseball|2024|topps|definitive", "https://www.checklistinsider.com/2024-topps-definitive-baseball"),
    ("baseball|2024|topps|diamond-icons", "https://www.checklistinsider.com/2024-topps-diamond-icons-baseball"),
    ("baseball|2024|topps|dynamic-duals", "https://www.checklistinsider.com/2024-topps-dynamic-duals-baseball"),
    ("baseball|2024|topps|five-star", "https://www.checklistinsider.com/2024-topps-five-star-baseball"),
    ("baseball|2024|topps|gilded-collection", "https://www.checklistinsider.com/2024-topps-gilded-collection-baseball"),
    ("baseball|2024|topps|heritage", "https://www.checklistinsider.com/2024-topps-heritage-baseball"),
    ("baseball|2024|topps|heritage-high-number", "https://www.checklistinsider.com/2024-topps-heritage-high-number-baseball"),
    ("baseball|2024|topps|heritage-mini", "https://www.checklistinsider.com/2024-topps-heritage-mini-baseball"),
    ("baseball|2024|topps|series-1", "https://www.checklistinsider.com/2024-topps-series-1-baseball"),
    ("baseball|2024|topps|spotlight", "https://www.checklistinsider.com/2024-topps-spotlight-baseball"),
    ("baseball|2024|topps|sterling", "https://www.checklistinsider.com/2024-topps-sterling-baseball"),
    ("baseball|2024|topps|triple-threads", "https://www.checklistinsider.com/2024-topps-triple-threads-baseball"),
    ("baseball|2024|topps|update-series", "https://www.checklistinsider.com/2024-topps-update-series-baseball"),
    ("baseball|2025|topps|heritage", "https://www.checklistinsider.com/2025-topps-heritage-baseball"),
    ("baseball|2025|topps|series-1", "https://www.checklistinsider.com/2025-topps-series-1-baseball"),
    ("baseball|2025|topps|tribute", "https://www.checklistinsider.com/2025-topps-tribute-baseball"),
    ("baseball|2026|topps|topps", "https://www.checklistinsider.com/2026-topps-baseball-complete"),
    ("basketball|2023-24|panini|donruss-optic-nba-trading-box-fast-break", "https://www.checklistinsider.com/2023-24-donruss-optic-basketball"),
    ("basketball|2024-25|donruss|donruss", "https://www.checklistinsider.com/2024-25-donruss-basketball"),
    ("basketball|2024-25|panini|nba-hoops", "https://www.checklistinsider.com/2024-25-panini-nba-hoops-basketball"),
    ("basketball|2024-25|panini|origins", "https://www.checklistinsider.com/2024-25-panini-origins-basketball"),
    ("basketball|2024-25|panini|prizm", "https://www.checklistinsider.com/2024-25-panini-prizm-basketball"),
    ("basketball|2024-25|panini|revolution", "https://www.checklistinsider.com/2024-25-panini-revolution-basketball"),
    ("football|2024|donruss|donruss", "https://www.checklistinsider.com/2024-donruss-football"),
    ("football|2024|donruss|elite", "https://www.checklistinsider.com/2024-donruss-elite-football"),
    ("football|2024|panini|absolute", "https://www.checklistinsider.com/2024-panini-absolute-football"),
    ("football|2024|panini|black", "https://www.checklistinsider.com/2024-panini-black-football"),
    ("football|2024|panini|certified", "https://www.checklistinsider.com/2024-panini-certified-football"),
    ("football|2024|panini|encore", "https://www.checklistinsider.com/2024-panini-encore-football"),
    ("football|2024|panini|gold-standard", "https://www.checklistinsider.com/2024-panini-gold-standard-football"),
    ("football|2024|panini|illusions", "https://www.checklistinsider.com/2024-panini-illusions-football"),
    ("football|2024|panini|luminance", "https://www.checklistinsider.com/2024-panini-luminance-football"),
    ("football|2024|panini|mosaic", "https://www.checklistinsider.com/2024-panini-mosaic-football"),
    ("football|2024|panini|obsidian", "https://www.checklistinsider.com/2024-panini-obsidian-football"),
    ("football|2024|panini|origins", "https://www.checklistinsider.com/2024-panini-origins-football"),
    ("football|2024|panini|phoenix", "https://www.checklistinsider.com/2024-panini-phoenix-football"),
    ("football|2024|panini|photogenic", "https://www.checklistinsider.com/2024-panini-photogenic-football"),
    ("football|2024|panini|prestige", "https://www.checklistinsider.com/2024-panini-prestige-football"),
    ("football|2024|panini|prizm", "https://www.checklistinsider.com/2024-panini-prizm-football"),
    ("football|2024|panini|rookies-and-stars", "https://www.checklistinsider.com/2024-panini-rookies-and-stars-football"),
    ("football|2024|panini|spectra", "https://www.checklistinsider.com/2024-panini-spectra-football"),
    ("football|2024|score|score", "https://www.checklistinsider.com/2024-score-football"),
    ("football|2024|topps|cosmic-chrome", "https://www.checklistinsider.com/2024-topps-cosmic-chrome-football"),
    ("football|2024|topps|inception", "https://www.checklistinsider.com/2024-topps-inception-football"),
    ("hockey|2024-25|upper-deck|artifacts", "https://www.checklistinsider.com/2024-25-upper-deck-artifacts-hockey"),
    ("hockey|2025-26|upper-deck|star-rookies-box-set", "https://www.checklistinsider.com/2025-26-upper-deck-star-rookies-hockey-box-set"),
    ("soccer|2024-25|topps|uefa-club-competitions", "https://www.checklistinsider.com/2024-25-topps-uefa-club-competitions-soccer"),
    ("wrestling|2024|panini|select-wwe", "https://www.checklistinsider.com/2024-panini-select-wwe-wrestling"),
    ("wrestling|2024|panini|three-count-wwe", "https://www.checklistinsider.com/2024-panini-three-count-wwe-wrestling"),
)

for target_key, url in _COMPLETE_PAGE_SOURCES:
    source = VerifiedChecklistSource(
        target_key,
        "checklistinsider",
        f"{target_key} complete checklist page",
        url,
        110,
        "Complete Checklist Insider master-list page selected to replace an incomplete or conflicting recovery source; page may expose a linked XLSX export",
    )
    registry._SOURCES = (*registry._SOURCES, source)
    registry._BY_TARGET[target_key] = (*registry._BY_TARGET.get(target_key, ()), source)

for source in _EXTRA_SOURCES:
    registry._SOURCES = (*registry._SOURCES, source)
    registry._BY_TARGET[source.target_key] = (
        *registry._BY_TARGET.get(source.target_key, ()),
        source,
    )
