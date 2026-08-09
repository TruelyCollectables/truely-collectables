from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class VerifiedChecklistSource:
    target_key: str
    source_id: str
    title: str
    url: str
    trust_score: int
    provenance: str
    verified_on: str = "2026-08-09"


# These URLs are intentionally allowlisted per exact Registry target instead of
# widening domain trust (for example, cdn.shopify.com). Each entry was manually
# reconciled to a full-release checklist source. Sentinel may try these sources
# before search-engine discovery, but the Registry importer remains fail-closed
# on parsed identity, row quality, and duplicate reconciliation.
_SOURCES = (
    # 2024 Bowman / Topps official checklist files.
    VerifiedChecklistSource("baseball|2024|bowman|bowman", "topps", "2024 Bowman Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2407-2024BowmanBaseballChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|bowman|sapphire", "topps", "2024 Bowman Sapphire Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2407-2024BowmanSapphireChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|bowman|chrome", "topps", "2024 Bowman Chrome Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2408-2024BowmanChromeChecklistV2.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|bowman|chrome-mega-box", "topps", "2024 Bowman Chrome Mega Box Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2435-2024BowmanChromeMegaBoxChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|bowman|chrome-sapphire", "beckett", "2024 Bowman Chrome Sapphire Baseball Checklist", "https://www.beckett.com/news/2024-bowman-chrome-sapphire-baseball-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("baseball|2024|bowman|draft", "topps", "2024 Bowman Draft Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2411-2024BowmanDraftChecklistV2.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|bowman|mega-box", "topps", "2024 Bowman Mega Box Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2493-2024BowmanMegaBoxChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|bowman|sterling", "topps", "2024 Bowman Sterling Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2410-2024BowmanSterlingBaseballChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|206", "topps", "2024 Topps 206 Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2024_20Topps_20206_20Baseball_20-_20Checklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|allen-and-ginter", "topps", "2024 Topps Allen & Ginter Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2412-2024ToppsAllen_GinterChecklistV2.pdf?v=1738851132", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|archives", "topps", "2024 Topps Archives Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2423-2024ToppsArchivesBaseball-CHECKLIST.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|chrome", "topps", "2024 Topps Chrome Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2426-2024ToppsChromeBaseballChecklist-updated.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|chrome-black", "topps", "2024 Topps Chrome Black Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2455-2024ToppsChromeBlaclChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|chrome-logofractor", "topps", "2024 Topps Chrome Logofractor Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2485-2024ToppsChromeLogofractorChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|chrome-sapphire", "topps", "2024 Topps Chrome Sapphire Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2477-2024ToppsChromeSapphireChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|chrome-sapphire-edition", "topps", "2024 Topps Chrome Sapphire Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2477-2024ToppsChromeSapphireChecklist.pdf", 100, "Canonical duplicate slug; official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|cosmic-chrome", "topps", "2024 Topps Cosmic Chrome Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2414-2024ToppsCosmicChromeBaseballChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|definitive", "topps", "2024 Topps Definitive Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2488-2024DefinitiveChecklist-v2.pdf?v=1739302313", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|diamond-icons", "topps", "2024 Topps Diamond Icons Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2475-2024ToppsDiamondIconsChecklist-v2.pdf?v=1738687543", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|dynamic-duals", "beckett", "2024 Topps Dynamic Duals Baseball Checklist", "https://www.beckett.com/news/2024-topps-dynamic-duals-baseball-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("baseball|2024|topps|finest", "topps", "2024 Topps Finest Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2421-2024FinestBaseballChecklistUpdated.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|five-star", "topps", "2024 Topps Five Star Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2430-2024FiveStarChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|gilded-collection", "topps", "2024 Topps Gilded Collection Baseball Checklist", "https://www.topps.com/media/pdf/MLB2464-CheckList_24TGCB_VERSION3.pdf", 100, "Official Topps product page checklist link"),
    VerifiedChecklistSource("baseball|2024|topps|heritage", "beckett", "2024 Topps Heritage Baseball Checklist", "https://www.beckett.com/news/2024-topps-heritage-baseball-cards/", 90, "Full Beckett master checklist with spreadsheet export; official Topps legacy PDF currently unavailable"),
    VerifiedChecklistSource("baseball|2024|topps|heritage-high-number", "topps", "2024 Topps Heritage High Number Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2446-24HBHNChecklistFINAL.pdf?v=1742586685", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|heritage-mini", "beckett", "2024 Topps Heritage Mini Baseball Checklist", "https://www.beckett.com/news/2024-topps-heritage-mini-baseball-cards/", 90, "Full Beckett master checklist with spreadsheet export; official Topps legacy PDF currently unavailable"),
    VerifiedChecklistSource("baseball|2024|topps|holiday", "topps", "2024 Topps Holiday Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2420-2024ToppsHolidayChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|luminaries", "topps", "2024 Topps Luminaries Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2492-2024LuminariesBaseballChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|museum-collection", "topps", "2024 Topps Museum Collection Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2424-2024ToppsMuseumCollectionChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|pristine", "topps", "2024 Topps Pristine Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2458-2024ToppsPristine_20FinalChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|series-1", "topps", "2024 Topps Series 1 Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2401-2024ToppsSeries1BBChecklistV1.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|series-2", "topps", "2024 Topps Series 2 Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2402-2024ToppsBBSeries2ChecklistFinal.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|stadium-club", "topps", "2024 Topps Stadium Club Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2468-2024ToppsStadiumClubBBChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|sterling", "topps", "2024 Topps Sterling Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2422-2024ToppsSterlingBaseballChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|tier-one", "topps", "2024 Topps Tier One Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2444-CheckList_24T1BB6-18.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|transcendent", "topps", "2024 Topps Transcendent Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2024_Transcendent_Checklist_-_Update.pdf?v=1766091138", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|tribute", "topps", "2024 Topps Tribute Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2405-2024ToppsTributeBBChecklistV3.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2024|topps|triple-threads", "topps", "2024 Topps Triple Threads Baseball Checklist", "https://www.topps.com/media/pdf/MLB2413-2024ToppsTripleThreadsBBChecklist.pdf", 100, "Official Topps product page checklist link"),
    VerifiedChecklistSource("baseball|2024|topps|update-series", "topps", "2024 Topps Update Series Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2403-CHECKLIST2024ToppsUpdateSeriesBaseball.pdf", 100, "Official Topps checklist library"),

    # 2024 licensed/unlicensed full checklist pages with master lists + XLSX.
    VerifiedChecklistSource("baseball|2024|donruss|donruss", "beckett", "2024 Donruss Baseball Checklist", "https://www.beckett.com/news/2024-donruss-baseball-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("baseball|2024|panini|crusade", "beckett", "2024 Panini Crusade Baseball Checklist", "https://www.beckett.com/news/2024-panini-crusade-baseball-cards/", 90, "Full Beckett master checklist"),
    VerifiedChecklistSource("football|2024|donruss|donruss", "beckett", "2024 Donruss Football Checklist", "https://www.beckett.com/news/2024-donruss-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|donruss|elite", "beckett", "2024 Donruss Elite Football Checklist", "https://www.beckett.com/news/2024-donruss-elite-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|absolute", "beckett", "2024 Panini Absolute Football Checklist", "https://www.beckett.com/news/2024-panini-absolute-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|black", "beckett", "2024 Panini Black Football Checklist", "https://www.beckett.com/news/2024-panini-black-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|certified", "beckett", "2024 Panini Certified Football Checklist", "https://www.beckett.com/news/2024-panini-certified-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|encore", "beckett", "2024 Panini Encore Football Checklist", "https://www.beckett.com/news/2024-panini-encore-football-cards/", 90, "Full Beckett master checklist"),
    VerifiedChecklistSource("football|2024|panini|gold-standard", "beckett", "2024 Panini Gold Standard Football Checklist", "https://www.beckett.com/news/2024-panini-gold-standard-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|illusions", "beckett", "2024 Panini Illusions Football Checklist", "https://www.beckett.com/news/2024-panini-illusions-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|luminance", "beckett", "2024 Panini Luminance Football Checklist", "https://www.beckett.com/news/2024-panini-luminance-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|mosaic", "beckett", "2024 Panini Mosaic Football Checklist", "https://www.beckett.com/news/2024-panini-mosaic-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|obsidian", "beckett", "2024 Panini Obsidian Football Checklist", "https://www.beckett.com/news/2024-panini-obsidian-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|origins", "beckett", "2024 Panini Origins Football Checklist", "https://www.beckett.com/news/2024-panini-origins-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|phoenix", "beckett", "2024 Panini Phoenix Football Checklist", "https://www.beckett.com/news/2024-panini-phoenix-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|photogenic", "beckett", "2024 Panini Photogenic Football Checklist", "https://www.beckett.com/news/2024-panini-photogenic-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|prestige", "beckett", "2024 Panini Prestige Football Checklist", "https://www.beckett.com/news/2024-panini-prestige-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|prizm", "beckett", "2024 Panini Prizm Football Checklist", "https://www.beckett.com/news/2024-panini-prizm-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|rookies-and-stars", "beckett", "2024 Panini Rookies & Stars Football Checklist", "https://www.beckett.com/news/2024-panini-rookies-stars-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|panini|spectra", "beckett", "2024 Panini Spectra Football Checklist", "https://www.beckett.com/news/2024-panini-spectra-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|score|score", "beckett", "2024 Score Football Checklist", "https://www.beckett.com/news/2024-score-football-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("football|2024|topps|chrome", "topps", "2024 Topps Chrome Football Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/NFL2402-2024ToppsChromeFBChecklist.pdf", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("football|2024|topps|cosmic-chrome", "topps", "2024 Topps Cosmic Chrome Football Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/NFL2405-2024ToppsCosmicChromeChecklist_V2.pdf?v=1744134769", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("football|2024|topps|inception", "topps", "2024 Topps Inception Football Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/NFL2407-2024ToppsInceptionChecklist-V2.pdf?v=1744043557", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("wrestling|2024|panini|select-wwe", "beckett", "2024 Panini Select WWE Checklist", "https://www.beckett.com/news/2024-panin-select-wwe-wrestling-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("wrestling|2024|panini|three-count-wwe", "beckett", "2024 Panini Three Count WWE Checklist", "https://www.beckett.com/news/2024-panini-three-count-wwe/", 90, "Full Beckett master checklist"),

    # 2024-25 season releases.
    VerifiedChecklistSource("basketball|2024-25|donruss|donruss", "beckett", "2024-25 Donruss Basketball Checklist", "https://www.beckett.com/news/2024-25-donruss-basketball-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("basketball|2024-25|panini|nba-hoops", "beckett", "2024-25 Panini NBA Hoops Basketball Checklist", "https://www.beckett.com/news/2024-25-panini-nba-hoops-basketball-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("basketball|2024-25|panini|origins", "beckett", "2024-25 Panini Origins Basketball Checklist", "https://www.beckett.com/news/2024-25-panini-origins-basketball-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("basketball|2024-25|panini|prizm", "beckett", "2024-25 Panini Prizm Basketball Checklist", "https://www.beckett.com/news/2024-25-panini-prizm-basketball-cards/", 90, "Full Beckett master checklist with spreadsheet export"),
    VerifiedChecklistSource("basketball|2024-25|panini|revolution", "beckett", "2024-25 Panini Revolution Basketball Checklist", "https://www.beckett.com/news/2024-25-panini-revolution-basketball-cards/", 90, "Full Beckett master checklist"),
    VerifiedChecklistSource("hockey|2024-25|upper-deck|artifacts", "beckett", "2024-25 Upper Deck Artifacts Hockey Checklist", "https://www.beckett.com/news/2024-25-upper-deck-artifacts-hockey-cards/", 90, "Full Beckett master checklist"),
    VerifiedChecklistSource("soccer|2024-25|topps|uefa-club-competitions", "topps", "2024-25 Topps UEFA Club Competitions Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/CHP2510-25UCL1_Checklist.pdf", 100, "Official Topps checklist library"),

    # 2025 / 2025-26 current gaps.
    VerifiedChecklistSource("baseball|2025|topps|chrome-black", "topps", "2025 Topps Chrome Black Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2555-2025CHROMEBLACKCHECKLIST.pdf?v=1743093147", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2025|topps|heritage", "topps", "2025 Topps Heritage Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2504-2025ToppsHeritageBaseballChecklist.pdf?v=1743430303", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2025|topps|series-1", "topps", "2025 Topps Series 1 Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025_Topps_Series_1_BB_Checklist_-_updated.pdf?v=1784567528", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("baseball|2025|topps|tribute", "topps", "2025 Topps Tribute Baseball Checklist", "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2505-2025ToppsTributeBBChecklist.pdf?v=1742822258", 100, "Official Topps checklist library"),
    VerifiedChecklistSource("hockey|2025-26|upper-deck|star-rookies-box-set", "beckett", "2025-26 Upper Deck Star Rookies Hockey Box Set Checklist", "https://www.beckett.com/news/2025-26-upper-deck-star-rookies-hockey-box-set/", 90, "Full Beckett checklist"),
)


_BY_TARGET: dict[str, tuple[VerifiedChecklistSource, ...]] = {}
for source in _SOURCES:
    _BY_TARGET[source.target_key] = (*_BY_TARGET.get(source.target_key, ()), source)


def verified_checklist_sources_for_target(target_key: object) -> tuple[VerifiedChecklistSource, ...]:
    return _BY_TARGET.get(str(target_key or "").strip(), ())


def verified_checklist_source_count() -> int:
    return len(_SOURCES)


def verified_checklist_target_count() -> int:
    return len(_BY_TARGET)
