from app.models import CardIdentity
from app.scan_self_repair import _recover_set


def test_bounded_fuzzy_set_title_repairs_one_character_ocr():
    identity = CardIdentity(year="2025", brand="Prizm", player="Kiki Iriafen", card_number="8")
    rows = [
        {"set_name": "Fearless", "parallel": "Base"},
        {"set_name": "Fearless", "parallel": "Green"},
        {"set_name": "Fearless Prizms Blue", "parallel": "Pulsar"},
    ]
    repaired, scoped = _recover_set(identity, "FGARLESS\nKIKI IRIAFEN", rows)
    assert repaired.set_name == "Fearless"
    assert repaired.subset == "Fearless"
    assert {row["set_name"] for row in scoped} == {"Fearless"}


def test_generic_base_is_not_fuzzily_promoted():
    identity = CardIdentity(year="2025", brand="Prizm", player="Kiki Iriafen", card_number="149")
    rows = [{"set_name": "Base", "parallel": "Base"}, {"set_name": "Base", "parallel": "Silver"}]
    repaired, scoped = _recover_set(identity, "BASKETBALL", rows)
    assert repaired.set_name == "Base"
    assert len(scoped) == 2


def test_color_only_parallel_uses_strong_perimeter_color():
    from app.scan_self_repair import _color_only_parallel_choice
    assert _color_only_parallel_choice({"green": 0.36}, ["Base", "Green"]) == "Green"


def test_color_only_parallel_can_reject_absent_color_against_base():
    from app.scan_self_repair import _color_only_parallel_choice
    assert _color_only_parallel_choice({"green": 0.0}, ["Base", "Green"]) == "Base"


def test_color_only_parallel_never_defaults_compound_finish():
    from app.scan_self_repair import _color_only_parallel_choice
    assert _color_only_parallel_choice({"orange": 0.0}, ["Base", "Orange Ice"]) is None


def test_physical_prizm_product_outranks_bad_score_brand():
    from app.models import CardIdentity
    from app.scan_self_repair import _brand_token
    identity = CardIdentity(year="2024", brand="Score", card_number="59")
    text = "2024 PANINI - PRIZM DRAFT PICKS\nKAMILLA CARDOSO\nNo. 59"
    assert _brand_token(identity, text) == "prizm"


def test_select_logo_outranks_generic_prizm_trademark():
    from app.models import CardIdentity
    from app.scan_self_repair import _brand_token
    identity = CardIdentity(year="2025", brand="Prizm", card_number="40")
    text = "SELECT WNBA\nPRIZM\nLUCY OLSEN\nNo. 40"
    assert _brand_token(identity, text) == "select"


def test_visible_canonical_number_can_beat_jersey_number():
    from app.scan_self_repair import _visible_card_number_line
    text = "BO HORVAT\n11\n#14\nMATTE PINK\n2023-24 O-PEE-CHEE PLATINUM HOCKEY"
    assert _visible_card_number_line(text, "11")
    assert _visible_card_number_line(text, "14")


class _FakeRegistryConnection:
    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, *_args, **_kwargs):
        return self

    def fetchall(self):
        return self.rows


class _FakeRegistryStore:
    def __init__(self, rows):
        self.rows = rows

    def connection(self):
        return _FakeRegistryConnection(self.rows)


def test_missing_card_number_recovers_only_unique_visible_registry_number():
    from app.scan_self_repair import _recover_card_number_from_player
    rows = [
        {"brand": "SPx", "product": "SPx", "card_number": "82"},
        {"brand": "SPx", "product": "SPx", "card_number": "HHC-BA"},
    ]
    identity = CardIdentity(year="2025", brand="SPx", player="Mathew Barzal")
    repaired = _recover_card_number_from_player(
        _FakeRegistryStore(rows), identity, "MATHEW BARZAL\n13\n82\n2025-26 SPx HOCKEY"
    )
    assert repaired.card_number == "82"


def test_missing_card_number_refuses_two_visible_registry_numbers():
    from app.scan_self_repair import _recover_card_number_from_player
    rows = [
        {"brand": "SPx", "product": "SPx", "card_number": "82"},
        {"brand": "SPx", "product": "SPx", "card_number": "HHC-BA"},
    ]
    identity = CardIdentity(year="2025", brand="SPx", player="Mathew Barzal")
    repaired = _recover_card_number_from_player(
        _FakeRegistryStore(rows), identity, "MATHEW BARZAL\n82\nHHC-BA\n2025-26 SPx HOCKEY"
    )
    assert repaired.card_number is None


def test_wrong_ocr_card_number_repairs_to_unique_visible_registry_code():
    from app.scan_self_repair import _recover_card_number_from_player
    rows = [
        {"brand": "Metal Universe", "product": "Metal Universe", "card_number": "150"},
        {"brand": "Metal Universe", "product": "Metal Universe", "card_number": "DM-20"},
        {"brand": "Metal Universe", "product": "Metal Universe", "card_number": "OL-84"},
    ]
    identity = CardIdentity(year="2025", brand="Metal Universe", player="Ivan Demidov", card_number="0L84")
    repaired = _recover_card_number_from_player(
        _FakeRegistryStore(rows), identity,
        "IVAN DEMIDOV\n93\nOUTER LIMITS\nOL-84\n0L84\n2025-26 METAL UNIVERSE HOCKEY",
    )
    assert repaired.card_number == "OL-84"


def test_standalone_base_moves_from_subset_to_parallel_when_registry_proves_role():
    from app.scan_self_repair import _repair_base_subset_role
    identity = CardIdentity(year="2024", brand="SP Game Used", player="Joshua Roy", card_number="NG-12", subset="Base")
    rows = [
        {"set_name": "New Grooves", "parallel": "Base"},
        {"set_name": "New Grooves", "parallel": "Gold"},
    ]
    repaired = _repair_base_subset_role(identity, "JOSHUA ROY\nNG-12\nBASE", rows)
    assert repaired.subset is None
    assert repaired.parallel == "Base"


def test_fuzzy_new_groouen_prefers_new_grooves_over_jersey_family():
    identity = CardIdentity(year="2024", brand="SP Game Used", player="Joshua Roy", card_number="NG-12")
    rows = [
        {"set_name": "New Grooves", "parallel": "Base"},
        {"set_name": "New Grooves Jersey", "parallel": "Base"},
    ]
    repaired, scoped = _recover_set(identity, "NEW GROOUEN\nJOSHUA ROY\nNG-12", rows)
    assert repaired.set_name == "New Grooves"
    assert {row["set_name"] for row in scoped} == {"New Grooves"}


def test_exact_set_family_beats_prefix_sibling_family():
    from app.local_registry_store import _prefer_exact_set_family
    rows = [
        {"set_name": "New Grooves", "parallel": "Base"},
        {"set_name": "New Grooves Jersey", "parallel": "Base"},
    ]
    scoped = _prefer_exact_set_family(rows, "New Grooves")
    assert [row["set_name"] for row in scoped] == ["New Grooves"]


def test_composite_set_hint_keeps_fallback_when_no_exact_family_exists():
    from app.local_registry_store import _prefer_exact_set_family
    rows = [
        {"set_name": "Base Set", "parallel": "Base"},
        {"set_name": "Fearless", "parallel": "Base"},
    ]
    scoped = _prefer_exact_set_family(rows, "Panini Prizm WNBA")
    assert scoped == rows


def test_dropped_character_card_code_repairs_inside_exact_player_family():
    from app.scan_self_repair import _recover_card_number_from_player
    rows = [
        {"brand": "SP Authentic", "product": "SP Authentic", "card_number": "TL-13"},
        {"brand": "SP Authentic", "product": "SP Authentic", "card_number": "97"},
    ]
    identity = CardIdentity(year="2021-22", brand="SP Authentic Hockey", player="Jamie Benn", card_number="TL-3")
    repaired = _recover_card_number_from_player(
        _FakeRegistryStore(rows), identity,
        "TRUE LEADERS\nJAMIE BENN\nTL-3\n2021-22 SP AUTHENTIC HOCKEY",
    )
    assert repaired.card_number == "TL-13"


def test_dropped_character_card_code_refuses_ambiguous_legal_codes():
    from app.scan_self_repair import _recover_card_number_from_player
    rows = [
        {"brand": "SP Authentic", "product": "SP Authentic", "card_number": "TL-13"},
        {"brand": "SP Authentic", "product": "SP Authentic", "card_number": "TL-30"},
    ]
    identity = CardIdentity(year="2021-22", brand="SP Authentic Hockey", player="Jamie Benn", card_number="TL-3")
    repaired = _recover_card_number_from_player(
        _FakeRegistryStore(rows), identity,
        "TRUE LEADERS\nJAMIE BENN\nTL-3\n2021-22 SP AUTHENTIC HOCKEY",
    )
    assert repaired.card_number == "TL-3"


def test_bounded_fuzzy_player_repairs_one_character_name_damage():
    from app.scan_self_repair import _recover_player
    rows = [{"player": "Kiki Iriafen", "team": "Washington Mystics"}]
    identity = CardIdentity(year="2025", brand="Prizm", player="WASHINGTON MYSTIOS", card_number="72")
    repaired, scoped = _recover_player(identity, "KIKLRIAFEN\nWASHINGTON MYSTICS\n72", rows)
    assert repaired.player == "Kiki Iriafen"
    assert len(scoped) == 1


def test_bounded_fuzzy_player_refuses_close_ambiguous_players():
    from app.scan_self_repair import _recover_player
    rows = [
        {"player": "Kiki Iriafen", "team": "Washington Mystics"},
        {"player": "Kiki Iriafer", "team": "Washington Mystics"},
    ]
    identity = CardIdentity(year="2025", brand="Prizm", player="WASHINGTON MYSTICS", card_number="72")
    repaired, scoped = _recover_player(identity, "KIKIRIAFE\nWASHINGTON MYSTICS\n72", rows)
    assert repaired.player is None
    assert len(scoped) == 2


def test_missing_number_with_noisy_player_uses_visible_registry_pair_not_jersey():
    from app.scan_self_repair import _recover_card_number_from_player
    rows = [
        {"brand": "Synergy", "product": "Synergy", "player": "Kyle MacLean", "team": "New York Islanders", "card_number": "81"},
        {"brand": "Synergy", "product": "Synergy", "player": "Other Player", "team": "Other Team", "card_number": "32"},
    ]
    class _NoisyPlayerStore(_FakeRegistryStore):
        def connection(self):
            rows = self.rows
            class _Conn(_FakeRegistryConnection):
                def execute(self, sql, params=()):
                    self.rows = [] if "lower(player)=lower(?)" in sql else rows
                    return self
            return _Conn(rows)
    identity = CardIdentity(year="2024", brand="Synergy", player="KYLEMACLEAN C", rookie=True)
    repaired = _recover_card_number_from_player(
        _NoisyPlayerStore(rows), identity,
        "32\nKYLE MACLEAN/C\n81\n2024-25 SYNERGY HOCKEY",
    )
    assert repaired.player == "Kyle MacLean"
    assert repaired.card_number == "81"


def test_insert_title_player_misseed_recovers_exact_visible_player_then_dropped_code():
    from app.scan_self_repair import _recover_card_number_from_player

    rows = [
        {"brand": "SP Authentic", "product": "SP Authentic", "player": "Jamie Benn", "card_number": "TL-13"},
        {"brand": "SP Authentic", "product": "SP Authentic", "player": "Jamie Benn", "card_number": "97"},
    ]
    class _PlayerAwareStore:
        def connection(self):
            class _Conn:
                def __enter__(self): return self
                def __exit__(self, *args): return False
                def execute(self, sql, params=()):
                    wanted = str(params[1] if len(params) > 1 else "").casefold()
                    self._rows = [r for r in rows if str(r.get("player") or "").casefold() == wanted]
                    return self
                def fetchall(self): return self._rows
            return _Conn()

    identity = CardIdentity(year="2021", brand="SP Authentic", player="TRUE LEADERS", card_number="TL3")
    repaired = _recover_card_number_from_player(
        _PlayerAwareStore(), identity,
        "TRUE LEADERS\nJAMIE BENN\nTL-3\n2021-22 SP AUTHENTIC HOCKEY",
    )
    assert repaired.player == "Jamie Benn"
    assert repaired.card_number == "TL-13"


def test_select_score_logo_recovers_unique_score_select_family_inside_bounded_rows():
    identity = CardIdentity(year="2025", brand="Select", player="Kiki Iriafen", card_number="3")
    rows = [
        {"set_name": "Color Wheel", "parallel": "Base"},
        {"set_name": "Score Select Throwback", "parallel": "Base"},
        {"set_name": "Score Select Throwback", "parallel": "Silver"},
        {"set_name": "Selective Swatches", "parallel": "Base"},
    ]
    repaired, scoped = _recover_set(identity, "SCORE\nSELECT\nKIKI IRIAFEN\nNo. 3", rows)
    assert repaired.set_name == "Score Select Throwback"
    assert repaired.subset == "Score Select Throwback"
    assert {row["set_name"] for row in scoped} == {"Score Select Throwback"}


def test_color_only_parallel_can_choose_base_when_all_specials_are_weak_plain_colors():
    from app.scan_self_repair import _color_only_parallel_choice
    proportions = {"blue": 0.1045, "green": 0.0, "black": 0.0871}
    assert _color_only_parallel_choice(proportions, ["Base", "Blue -", "Green -", "Black"]) == "Base"


def test_color_only_parallel_does_not_default_base_when_pattern_finish_is_legal():
    from app.scan_self_repair import _color_only_parallel_choice
    assert _color_only_parallel_choice({"blue": 0.10}, ["Base", "Blue", "Ice"]) is None


def test_select_score_logo_accepts_bounded_scanner_prefix_noise():
    identity = CardIdentity(year="2025", brand="Select", player="Kiki Iriafen", card_number="3")
    rows = [
        {"set_name": "Color Wheel", "parallel": "Base"},
        {"set_name": "Score Select Throwback", "parallel": "Base"},
        {"set_name": "Score Select Throwback", "parallel": "Silver"},
        {"set_name": "Selective Swatches", "parallel": "Base"},
    ]
    repaired, scoped = _recover_set(identity, "-SCORE\n3SCORE\nSELECT\nKIKI IRIAFEN\nNo.\n3", rows)
    assert repaired.set_name == "Score Select Throwback"
    assert {row["set_name"] for row in scoped} == {"Score Select Throwback"}


def test_physical_release_year_beats_ncaa_stat_season_before_registry_bound():
    from app.scan_self_repair import _physical_release_year
    identity = CardIdentity(year="2024", brand="Prizm", player="NCAA TOTALS", card_number="72")
    text = (
        "KIKTIRIAFEN\nWASHINGTON MYSTICS\nNo. 72\n"
        "2024-25 NCAA TOTALS\n"
        "2025 PANINI - WNBA PRIZM BASKETBALL\n"
        "Officially Licensed Product of the WNBPA © 2025"
    )
    assert _physical_release_year(identity, text) == "2025"


def test_prebound_physical_repair_prevents_wrong_year_wrong_player_registry_family():
    from app.scan_self_repair import _repair_prebound_physical_identity

    rows = [
        {"year": "2024", "brand": "Prizm", "product": "Prizm WNBA", "player": "Dana Evans", "team": "Chicago Sky", "card_number": "72", "normalized_card_number": "72", "league": "WNBA", "sport": "Basketball"},
        {"year": "2025", "brand": "Prizm", "product": "Prizm WNBA", "player": "Kiki Iriafen", "team": "Washington Mystics", "card_number": "72", "normalized_card_number": "72", "league": "WNBA", "sport": "Basketball"},
    ]

    class _YearNumberStore:
        def connection(self):
            class _Conn:
                def __enter__(self): return self
                def __exit__(self, *args): return False
                def execute(self, _sql, params=()):
                    year, number = str(params[0]), str(params[1])
                    self._rows = [r for r in rows if r["year"] == year and r["normalized_card_number"] == number]
                    return self
                def fetchall(self): return self._rows
            return _Conn()

    identity = CardIdentity(year="2024", brand="Prizm", player="NCAA TOTALS", card_number="72")
    text = (
        "WASHINGTON MYSTICS\nKIKTIRIAFEN\nKIKFRIAFEN\nNo. 72\n"
        "2024-25 NCAA TOTALS\n2025 PANINI - WNBA PRIZM BASKETBALL\nWNBPA"
    )
    repaired = _repair_prebound_physical_identity(_YearNumberStore(), identity, text)
    assert repaired.year == "2025"
    assert repaired.player == "Kiki Iriafen"


def test_prebound_player_repair_fails_closed_when_visible_name_is_ambiguous():
    from app.scan_self_repair import _repair_prebound_physical_identity

    rows = [
        {"year": "2025", "brand": "Prizm", "product": "Prizm WNBA", "player": "Kiki Iriafen", "team": "Washington Mystics", "card_number": "72", "normalized_card_number": "72", "league": "WNBA", "sport": "Basketball"},
        {"year": "2025", "brand": "Prizm", "product": "Prizm WNBA", "player": "Kiki Iriafer", "team": "Washington Mystics", "card_number": "72", "normalized_card_number": "72", "league": "WNBA", "sport": "Basketball"},
    ]

    class _AmbiguousStore:
        def connection(self):
            class _Conn:
                def __enter__(self): return self
                def __exit__(self, *args): return False
                def execute(self, _sql, _params=()): self._rows = rows; return self
                def fetchall(self): return self._rows
            return _Conn()

    identity = CardIdentity(year="2024", brand="Prizm", player="NCAA TOTALS", card_number="72")
    text = "KIKIRIAFE\nNo. 72\n2025 PANINI - WNBA PRIZM BASKETBALL"
    repaired = _repair_prebound_physical_identity(_AmbiguousStore(), identity, text)
    assert repaired.year == "2025"
    assert repaired.player == "NCAA TOTALS"


def test_ivan_allure_zero_memory_recovers_player_and_card_number_from_full_ocr_family():
    from app.scan_self_repair import _recover_card_number_from_player

    rows = [
        {"year": "2025", "brand": "Upper Deck", "product": "Upper Deck Allure Hockey", "set_name": "Color Flow: Red-Orange", "player": "Ivan Demidov", "card_number": "CF-22", "parallel": "Orange-Yellow"},
        {"year": "2025", "brand": "Upper Deck", "product": "Upper Deck Allure Hockey", "set_name": "Color Flow: Red-Orange", "player": "Ivan Demidov", "card_number": "CF-22", "parallel": "Base"},
        {"year": "2025", "brand": "Upper Deck", "product": "Upper Deck Allure Hockey", "set_name": "Base Set", "player": "Ivan Demidov", "card_number": "91", "parallel": "Base"},
    ]

    class _IvanStore:
        def connection(self):
            class _Conn:
                def __enter__(self): return self
                def __exit__(self, *args): return False
                def execute(self, sql, params=()):
                    wanted = str(params[1] if len(params) > 1 else "").casefold() if "lower(player)=lower(?)" in sql else None
                    self._rows = rows if wanted is None else [r for r in rows if str(r["player"]).casefold() == wanted]
                    return self
                def fetchall(self): return self._rows
            return _Conn()

    identity = CardIdentity(
        year="2025", manufacturer="Upper Deck", brand="Upper Deck",
        player="COLOR FLO", card_number="ORANGE-YELLOW",
    )
    text = "IVAN DEMIDOV\n2025-26 ALLURE HOCKEY\nORANGE-YELLOW\nCOLOR FLO"
    repaired = _recover_card_number_from_player(_IvanStore(), identity, text)
    assert repaired.player == "Ivan Demidov"
    assert repaired.card_number == "CF-22"


def test_visible_set_family_card_number_refuses_ambiguous_numbers():
    from app.scan_self_repair import _recover_card_number_from_visible_set_family

    rows = [
        {"set_name": "Color Flow: Red-Orange", "card_number": "CF-22", "parallel": "Orange-Yellow"},
        {"set_name": "Color Flow: Red-Orange", "card_number": "CF-23", "parallel": "Orange-Yellow"},
    ]
    assert _recover_card_number_from_visible_set_family(rows, "COLOR FLOW\nORANGE-YELLOW") is None


def test_visible_compound_parallel_can_recover_number_when_set_ocr_is_truncated():
    from app.scan_self_repair import _recover_card_number_from_visible_set_family

    rows = [
        {"set_name": "Color Flow", "card_number": "CF-22", "parallel": "Orange-Yellow"},
        {"set_name": "16-Bit", "card_number": "B-1", "parallel": "Base"},
    ]
    assert _recover_card_number_from_visible_set_family(rows, "COLOR FLO\nORANGE-YELLOW") == "CF-22"


def test_visible_single_color_parallel_does_not_recover_without_set_family():
    from app.scan_self_repair import _recover_card_number_from_visible_set_family

    rows = [
        {"set_name": "Base Set", "card_number": "110", "parallel": "Green"},
        {"set_name": "Hues Next?", "card_number": "HN-1", "parallel": "Base"},
    ]
    assert _recover_card_number_from_visible_set_family(rows, "GREEN") is None

def test_preliminary_base_does_not_collapse_multi_finish_family(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    import app.scan_self_repair as repair
    from app.models import CardIdentity

    rows = [
        {"parallel": "Base"},
        {"parallel": "Set - Concourse - Silver"},
        {"parallel": "Set - Concourse - Pink Flash"},
    ]

    local_vision = SimpleNamespace(
        identity_hints=CardIdentity(parallel="Base"),
        front=SimpleNamespace(
            pattern=SimpleNamespace(
                scores={},
                label=None,
            )
        ),
    )

    monkeypatch.setattr(
        repair,
        "analyze_treatment_colors",
        lambda *_: SimpleNamespace(proportions={}),
    )

    identity, remaining = asyncio.run(
        repair._choose_parallel(
            CardIdentity(
                year="2025",
                brand="Select",
                player="Sonia Citron",
                card_number="83",
                parallel="Base",
            ),
            local_vision,
            b"not-an-image",
            rows,
            allow_model_disambiguation=False,
        )
    )

    assert identity.parallel is None
    assert len(remaining) == 3
