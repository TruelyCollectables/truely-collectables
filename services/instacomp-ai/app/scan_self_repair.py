from __future__ import annotations

import asyncio

import os
import re
import sqlite3
import time
from contextlib import contextmanager
from difflib import SequenceMatcher
from typing import Any, Awaitable, Callable

from .config import settings
from .finish_classifier import classify_registry_finish
from .autograph_classifier import classify_registry_autograph
from .scan_surface_classifier import classify_registry_surface
from .identity_role_guard import is_registry_team_label, visible_registry_player
from .local_registry_store import normalized_card_number, normalized_text
from .local_vision import analyze_treatment_colors, _decode_image
from .models import CardIdentity, ChecklistOutcome, ChecklistResult
from .registry_gap_recovery import recover_exact_registry_gap
from .serial_evidence_guard import reconcile_visible_denominator
from .visible_identity_hint_guard import registry_product_line_hint_from_text


RegistryMatch = Callable[[CardIdentity, str | None], Awaitable[ChecklistResult]]
ChecklistRecovery = Callable[[CardIdentity, str | None], Awaitable[bool]]

class _EmptyReadCursor:
    def fetchall(self):
        return []

    def fetchone(self):
        return None


class _LockResilientReader:
    def __init__(self, db: Any):
        self._db = db

    def execute(self, *args: Any, **kwargs: Any):
        delay = 0.15
        for attempt in range(4):
            try:
                return self._db.execute(*args, **kwargs)
            except sqlite3.OperationalError as exc:
                if "locked" not in str(exc).lower():
                    raise
                if attempt >= 3:
                    _debug("registry_read_locked_fail_closed", str(exc))
                    return _EmptyReadCursor()
                time.sleep(delay)
                delay = min(1.0, delay * 2)

    def __getattr__(self, name: str):
        return getattr(self._db, name)


@contextmanager
def _read_connection(registry_store: Any):
    factory = getattr(registry_store, "read_connection", None)
    manager = (factory or registry_store.connection)()
    with manager as db:
        yield _LockResilientReader(db)

def _debug(*parts: object) -> None:
    if os.environ.get("INSTACOMP_AI_DEBUG_SELF_REPAIR") == "1":
        print("SELF_REPAIR", *parts, flush=True)



def _brand_token(identity: CardIdentity, text: str) -> str:
    # A concrete product logo physically printed on the card outranks an earlier
    # weak parser brand guess. This repairs cases like PRIZM DRAFT PICKS being
    # mis-seeded as Score. SELECT wins over the generic PRIZM trademark often
    # printed on Select parallels.
    physical_norm = normalized_text(text)
    physical_words = set(physical_norm.split())
    # Multi-word product marks printed together outrank incidental prose tokens.
    # Example: a biography may contain the common noun "score", but a footer
    # reading PANINI PRIZM DRAFT PICKS is direct product evidence.
    direct_phrases = (
        ("prizm draft picks", "prizm"),
        ("panini prizm", "prizm"),
        ("select wnba", "select"),
        ("panini select", "select"),
        ("donruss wnba", "donruss"),
        ("panini donruss", "donruss"),
        ("topps chrome", "topps chrome"),
        ("o pee chee platinum", "o pee chee platinum"),
        ("sp authentic", "sp authentic"),
        ("sp game used", "sp game used"),
        ("metal universe", "metal universe"),
        ("upper deck allure", "allure"),
        ("allure hockey", "allure"),
    )
    for phrase, token in direct_phrases:
        if phrase in physical_norm:
            return token
    product = normalized_text(registry_product_line_hint_from_text(text))
    if "select" in physical_words:
        return "select"
    for token in ("prizm", "select", "donruss", "mosaic", "origins", "impeccable", "optic"):
        if token in product:
            return token
    brand = normalized_text(identity.brand)
    if brand and brand not in {"panini", "topps", "upper deck", "leaf"}:
        return brand
    return product


def _physical_release_year(identity: CardIdentity, text: str) -> str | None:
    """Return a release year only from a strongly product-scoped physical line.

    Biography/stat lines such as `2024-25 NCAA TOTALS` are not release evidence.
    A year must share a line with a publisher/product/license cue before it may
    override the parser's year. This runs before Registry bounding so a season
    statistic cannot send self-repair into the wrong year's card family.
    """
    publisher_terms = (
        "panini", "upper deck", "topps", "bowman", "donruss", "prizm",
        "select", "allure", "sp authentic", "metal universe", "synergy",
    )
    release_terms = ("wnba", "nba", "nhl", "mlb", "nfl", "hockey", "basketball", "baseball", "football")
    candidates: list[tuple[int, str]] = []
    for raw in str(text or "").splitlines():
        line = normalized_text(raw)
        years = re.findall(r"(?<!\d)(20\d{2})(?!\d)", line)
        if not years:
            continue
        score = 0
        if any(term in line for term in publisher_terms):
            score += 5
        if any(term in line for term in release_terms):
            score += 2
        if "copyright" in line or "©" in raw or "printed" in line:
            score += 1
        if any(term in line for term in ("ncaa totals", "season", "born", "drafted", "hometown", "career", "yr ")):
            score -= 6
        for year in years:
            candidates.append((score, year))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score = candidates[0][0]
    if best_score < 5:
        return None
    winners = list(dict.fromkeys(year for score, year in candidates if score == best_score))
    return winners[0] if len(winners) == 1 else None


def _prebound_visible_player(registry_store: Any, identity: CardIdentity, text: str) -> CardIdentity:
    """Repair a contaminated player before Registry family bounding.

    The candidate pool is already constrained by a physically supported release
    year, card number and product family. A Registry player may replace the parsed
    value only when that player is independently visible (exact or bounded fuzzy)
    on this card. This prevents labels such as NCAA TOTALS / TRACKING SYSTEMS /
    team names from becoming people, without guessing a player from Registry alone.
    """
    if not identity.year or not identity.card_number:
        return identity
    year = str(identity.year)[:4]
    number = normalized_card_number(identity.card_number)
    if not year or not number:
        return identity
    try:
        with _read_connection(registry_store) as db:
            rows = db.execute(
                "SELECT * FROM checklist_registry_entries INDEXED BY checklist_registry_active_card_year_idx WHERE active=1 AND year=? AND normalized_card_number=?",
                (year, number),
            ).fetchall()
    except Exception:
        return identity
    brand = _brand_token(identity, text)
    if brand:
        scoped = [
            row for row in rows
            if normalized_text(row["brand"]) == brand or brand in normalized_text(row["product"])
        ]
        if scoped:
            rows = scoped
    words = set(normalized_text(text).split())
    for league in ("wnba", "nba", "nhl", "mlb", "nfl"):
        if league in words:
            scoped = [
                row for row in rows
                if league in normalized_text(row["league"])
                or league in normalized_text(row["product"])
                or league in normalized_text(row["sport"])
            ]
            if scoped:
                rows = scoped
            break
    if not rows:
        return identity
    player = visible_registry_player(text, rows) or _bounded_fuzzy_visible_player(text, rows)
    if not player:
        return identity
    return identity.model_copy(update={"player": player})


def _repair_prebound_physical_identity(registry_store: Any, identity: CardIdentity, text: str) -> CardIdentity:
    release_year = _physical_release_year(identity, text)
    if release_year and str(identity.year or "")[:4] != release_year:
        identity = identity.model_copy(update={"year": release_year})
    return _prebound_visible_player(registry_store, identity, text)


def _visible_card_number_line(text: str, card_number: object) -> bool:
    target = re.sub(r"[^a-z0-9]+", "", str(card_number or "").casefold())
    if not target:
        return False
    for raw in str(text or "").splitlines():
        line = re.sub(r"[^a-z0-9]+", "", raw.casefold())
        if line == target:
            return True
    return False


def _single_edit_card_number_witness(text: str, legal_numbers: set[str]) -> str | None:
    """Return one legal alphanumeric code supported by a one-character OCR edit.

    This is deliberately narrower than fuzzy text matching. It is only used after
    year + player + product family are already exact, and only for card codes that
    contain both letters and digits. A canonical code may differ from one standalone
    OCR line by exactly one inserted/deleted character (TL-13 -> TL-3). Pure numeric
    values are excluded so a jersey number can never create this repair.
    """
    observed = {
        re.sub(r"[^a-z0-9]+", "", raw.casefold())
        for raw in str(text or "").splitlines()
        if str(raw or "").strip()
    }
    candidates: list[str] = []
    for legal in legal_numbers:
        canonical = re.sub(r"[^a-z0-9]+", "", str(legal or "").casefold())
        if not canonical or not (re.search(r"[a-z]", canonical) and re.search(r"\d", canonical)):
            continue
        for witness in observed:
            if not witness or abs(len(canonical) - len(witness)) != 1:
                continue
            longer, shorter = (canonical, witness) if len(canonical) > len(witness) else (witness, canonical)
            if any(longer[:i] + longer[i + 1:] == shorter for i in range(len(longer))):
                candidates.append(legal)
                break
    unique = list(dict.fromkeys(candidates))
    return unique[0] if len(unique) == 1 else None


def _recover_visible_number_with_noisy_player(
    registry_store: Any, identity: CardIdentity, text: str, *, year: str, brand: str
) -> CardIdentity:
    """Recover card number + player together from indexed physical witnesses.

    This is the reciprocal of player-first number repair. When OCR damages the
    player line and misses the compact card-number parser, probe only standalone
    number/code OCR lines against the exact year/product Registry index. A token
    is accepted only when the rows for that token have one Registry player who is
    independently visible on the physical card. Jersey/stat numbers therefore do
    not win merely because they occur in Registry.
    """
    raw_tokens: list[str] = []
    for raw in str(text or "").splitlines():
        value = str(raw or "").strip()
        if not value:
            continue
        if not re.fullmatch(r"#?(?:[A-Za-z]{1,6}[- ]?[A-Za-z0-9]{1,8}|\d{1,3})", value):
            continue
        token = normalized_card_number(value.lstrip("#"))
        if token and token not in raw_tokens:
            raw_tokens.append(token)
    if not raw_tokens:
        return identity
    matches: list[tuple[str, str]] = []
    with _read_connection(registry_store) as db:
        # Probe the parser's current card number first when present. Remaining
        # standalone OCR numbers are bounded fallbacks, never reasons to scan a
        # whole release/product family.
        current_token = normalized_card_number(identity.card_number) if identity.card_number else ""
        ordered_tokens = list(dict.fromkeys(
            ([current_token] if current_token else []) + raw_tokens
        ))
        for token in ordered_tokens[:24]:
            rows = db.execute(
                """SELECT * FROM checklist_registry_entries
                INDEXED BY checklist_registry_active_card_year_idx
                WHERE active=1 AND normalized_card_number=? AND year=?
                LIMIT 4096""",
                (token, year),
            ).fetchall()
            # Product/brand matching belongs in memory AFTER the indexed physical
            # card/year bound. lower()/LIKE() in SQLite disables the useful index
            # and previously turned one noisy card into repeated 17GB walks.
            rows = [
                row for row in rows
                if normalized_card_number(
                    row.get("card_number") if isinstance(row, dict) else row["card_number"]
                ) == token
                and (
                    normalized_text(
                        row.get("brand") if isinstance(row, dict) else row["brand"]
                    ) == brand
                    or brand in normalized_text(
                        row.get("product") if isinstance(row, dict) else row["product"]
                    )
                )
            ]
            if not rows:
                continue
            player = visible_registry_player(text, rows)
            if not player:
                continue
            player_rows = [row for row in rows if normalized_text(row.get("player") if isinstance(row, dict) else row["player"]) == normalized_text(player)]
            canonical_numbers = {
                str(row.get("card_number") if isinstance(row, dict) else row["card_number"]).strip()
                for row in player_rows
                if (row.get("card_number") if isinstance(row, dict) else row["card_number"])
            }
            if len(canonical_numbers) == 1:
                matches.append((next(iter(canonical_numbers)), player))
    unique = list(dict.fromkeys(matches))
    if len(unique) != 1:
        return identity
    number, player = unique[0]
    return identity.model_copy(update={"card_number": number, "player": player})


def _recover_card_number_from_visible_set_family(rows: list[Any], text: str) -> str | None:
    """Recover one card number from exact physical set/parallel labels inside a player family.

    The caller has already bounded rows by release year, exact Registry player, and
    product family. This helper never chooses from Registry uniqueness alone: at
    least one non-generic set/insert label must appear as its own OCR line. When a
    colon-qualified family is used (for example ``Color Flow: Red-Orange``), the
    printed root label ``COLOR FLOW`` is accepted. A visible legal parallel may
    further narrow the family. Only one remaining canonical card number may win.
    """
    if not rows:
        return None

    lines = {normalized_text(raw) for raw in str(text or "").splitlines() if str(raw or "").strip()}
    if not lines:
        return None

    def value(row: Any, key: str) -> Any:
        if isinstance(row, dict):
            return row.get(key)
        try:
            return row[key]
        except Exception:
            return None

    generic = {"base", "base set", "insert", "inserts", "rookies", "rookie"}

    # A compound parallel printed as its own OCR line is strong physical
    # evidence after year + exact player + product family are already bounded.
    # Let it recover the card number even when the set-family OCR is one letter
    # short (COLOR FLO vs COLOR FLOW). Single-token finishes such as GREEN are
    # intentionally excluded from this shortcut because they are too generic.
    compound_parallel_rows = []
    for row in rows:
        parallel = normalized_text(value(row, "parallel"))
        if parallel in {"", "base"} or len(re.findall(r"[a-z0-9]+", parallel)) < 2:
            continue
        if parallel in lines:
            compound_parallel_rows.append(row)
    if compound_parallel_rows:
        compound_numbers = {
            str(value(row, "card_number") or "").strip()
            for row in compound_parallel_rows
            if str(value(row, "card_number") or "").strip()
        }
        if len(compound_numbers) == 1:
            return next(iter(compound_numbers))
        return None

    supported: list[Any] = []
    for row in rows:
        raw_set = str(value(row, "set_name") or "").strip()
        set_name = normalized_text(raw_set)
        if not set_name or set_name in generic:
            continue
        labels = {set_name}
        if ":" in raw_set:
            root = normalized_text(raw_set.split(":", 1)[0])
            if root and root not in generic and len(root) >= 4:
                labels.add(root)
        if labels & lines:
            supported.append(row)

    if not supported:
        return None

    parallel_scoped = [
        row for row in supported
        if normalized_text(value(row, "parallel"))
        and normalized_text(value(row, "parallel")) not in {"base"}
        and normalized_text(value(row, "parallel")) in lines
    ]
    if parallel_scoped:
        supported = parallel_scoped

    numbers = {
        str(value(row, "card_number") or "").strip()
        for row in supported
        if str(value(row, "card_number") or "").strip()
    }
    return next(iter(numbers)) if len(numbers) == 1 else None


def _player_lookup_variants(value: object) -> tuple[str, ...]:
    """Small exact-casing set that keeps SQLite on the player B-tree.

    The Registry player index uses binary collation. Applying lower(player) in
    SQL disables that index and can scan an entire release year in the 15+ GB
    Registry. Generate a few conservative exact variants in Python instead.
    """
    raw = " ".join(str(value or "").split())
    if not raw:
        return ()
    variants = [raw, raw.title(), raw.upper(), raw.lower()]
    title_tokens = raw.title().split()
    mc_tokens = [
        ("Mc" + token[2].upper() + token[3:]) if token.startswith("Mc") and len(token) > 2 else token
        for token in title_tokens
    ]
    variants.append(" ".join(mc_tokens))
    return tuple(dict.fromkeys(item for item in variants if item))


def _registry_row_value(row: Any, key: str) -> Any:
    if isinstance(row, dict):
        return row.get(key)
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return None


def _registry_rows_for_player(registry_store: Any, year: object, player: object) -> list[Any]:
    variants = _player_lookup_variants(player)
    year_text = str(year or "")[:4]
    if not year_text or not variants:
        return []
    marks = ",".join("?" for _ in variants)
    with _read_connection(registry_store) as db:
        rows = db.execute(
            f"SELECT * FROM checklist_registry_entries "
            f"INDEXED BY checklist_registry_player_idx "
            f"WHERE active=1 AND year=? AND player IN ({marks}) LIMIT 2048",
            (year_text, *variants),
        ).fetchall()
    return list(rows)


def _recover_card_number_from_player(registry_store: Any, identity: CardIdentity, text: str) -> CardIdentity:
    """Recover a Registry card number without confusing it with a jersey number.

    When a number is already present, replacement stays conservative: the exact
    year/player/product family must have one canonical card number and that number
    must be independently visible as its own OCR line. When the parser missed the
    card number entirely, allow recovery only when exactly one Registry card number
    from that same family is independently visible. A one-character OCR omission is
    accepted only for a unique alphanumeric legal code inside that same bounded
    player/product family.
    """
    if not identity.year:
        return identity
    year = str(identity.year)[:4]
    player = str(identity.player or "").strip()
    brand = _brand_token(identity, text)
    if not brand:
        return identity
    family: list[Any] = []
    if player:
        rows = _registry_rows_for_player(registry_store, year, player)
        # The indexed SQL query should already enforce the player, but preserve
        # that invariant defensively before treating rows as an exact family.
        # This also protects custom/test Registry adapters with broader query semantics.
        requested_player = normalized_text(player)
        family = [
            row for row in rows
            if (
                _registry_row_value(row, "player") is None
                or normalized_text(_registry_row_value(row, "player")) == requested_player
            )
            and (
                normalized_text(_registry_row_value(row, "brand")) == brand
                or brand in normalized_text(_registry_row_value(row, "product"))
            )
        ]

    # A set/insert title can be the largest alphabetic OCR line and therefore be
    # mis-seeded as `player` (for example TRUE LEADERS on Jamie Benn TL-13).
    # When that observed player has *no* exact Registry family, recover a player
    # only from an independently visible, standalone full-name OCR line that is
    # itself an exact Registry player in this same year/product family. This is
    # physical evidence, not a Registry-only uniqueness guess.
    if not family:
        visible_players: list[tuple[str, list[Any]]] = []
        seen_lines: set[str] = set()
        with _read_connection(registry_store) as db:
            for raw in str(text or "").splitlines():
                line = re.sub(r"^[^A-Za-z]+|[^A-Za-z .'-]+$", "", str(raw or "").strip()).strip()
                norm = normalized_text(line)
                if not norm or norm in seen_lines:
                    continue
                seen_lines.add(norm)
                words = [word for word in norm.split() if word]
                if not (2 <= len(words) <= 4) or any(not re.search(r"[a-z]", word) for word in words):
                    continue
                variants = _player_lookup_variants(line)
                if not variants:
                    continue
                marks = ",".join("?" for _ in variants)
                visible_number = normalized_card_number(identity.card_number)
                candidate_rows = []
                if visible_number:
                    # Most live scans already have the printed card number from
                    # the back. Use it as the first Registry key so a noisy
                    # player line never fans out across every card for that
                    # player/year on the 17 GB external Registry.
                    candidate_rows = db.execute(
                        f"SELECT * FROM checklist_registry_entries "
                        f"INDEXED BY checklist_registry_resolve_idx "
                        f"WHERE active=1 AND normalized_card_number=? "
                        f"AND year=? AND player IN ({marks}) LIMIT 512",
                        (visible_number, year, *variants),
                    ).fetchall()
                if not candidate_rows:
                    # A noisy/truncated number may itself be what this repair is
                    # trying to fix, so a zero-row keyed probe may fall back to
                    # a bounded player/year slice. Never make that fallback
                    # unbounded.
                    candidate_rows = db.execute(
                        f"SELECT * FROM checklist_registry_entries "
                        f"INDEXED BY checklist_registry_player_idx "
                        f"WHERE active=1 AND year=? AND player IN ({marks}) "
                        f"LIMIT 512",
                        (year, *variants),
                    ).fetchall()
                variant_players = {normalized_text(value) for value in variants}
                candidate_rows = [
                    row for row in candidate_rows
                    if (
                        _registry_row_value(row, "player") is None
                        or normalized_text(_registry_row_value(row, "player")) in variant_players
                    )
                    and (
                        normalized_text(_registry_row_value(row, "brand")) == brand
                        or brand in normalized_text(_registry_row_value(row, "product"))
                    )
                ]
                if candidate_rows:
                    canonical = str(candidate_rows[0]["player"] or "").strip()
                    if canonical:
                        visible_players.append((canonical, candidate_rows))
        distinct = list(dict.fromkeys(name for name, _ in visible_players))
        if len(distinct) == 1:
            player = distinct[0]
            family = next(rows for name, rows in visible_players if name == player)
            identity = identity.model_copy(update={"player": player})

    numbers = {str(row["card_number"] or "").strip() for row in family if row["card_number"]}
    if not numbers:
        return _recover_visible_number_with_noisy_player(
            registry_store, identity, text, year=year, brand=brand
        )
    current = normalized_card_number(identity.card_number) if identity.card_number else ""
    if current and any(normalized_card_number(number) == current for number in numbers):
        return identity
    family_number = _recover_card_number_from_visible_set_family(family, text)
    if family_number:
        return identity.model_copy(update={"card_number": family_number})
    visible = [number for number in numbers if _visible_card_number_line(text, number)]
    if len(visible) == 1:
        # The replacement is not inferred from Registry uniqueness alone: the exact
        # canonical number must also appear as its own OCR line on this physical card.
        return identity.model_copy(update={"card_number": visible[0]})
    if len(visible) > 1:
        return identity
    single_edit = _single_edit_card_number_witness(text, numbers)
    if single_edit:
        return identity.model_copy(update={"card_number": single_edit})
    return _recover_visible_number_with_noisy_player(
        registry_store, identity, text, year=year, brand=brand
    )


def _bounded_rows(registry_store: Any, identity: CardIdentity, text: str) -> list[Any]:
    if not identity.year or not identity.card_number:
        return []
    year = str(identity.year)[:4]
    number = normalized_card_number(identity.card_number)
    with _read_connection(registry_store) as db:
        rows = db.execute(
            "SELECT * FROM checklist_registry_entries INDEXED BY checklist_registry_active_card_year_idx WHERE active=1 AND year=? AND normalized_card_number=?",
            (year, number),
        ).fetchall()
    brand = _brand_token(identity, text)
    if brand:
        branded = [
            row for row in rows
            if normalized_text(row["brand"]) == brand or brand in normalized_text(row["product"])
        ]
        if branded:
            rows = branded
    words = set(normalized_text(text).split())
    for league in ("wnba", "nba", "nhl", "mlb", "nfl"):
        if league in words:
            scoped = [
                row for row in rows
                if league in normalized_text(row["league"])
                or league in normalized_text(row["product"])
                or league in normalized_text(row["sport"])
            ]
            if scoped:
                rows = scoped
            break
    return list(rows)


def _bounded_fuzzy_visible_player(text: str, rows: list[Any]) -> str | None:
    """Repair one-character name OCR only inside an already bounded Registry family."""
    players = list(dict.fromkeys(
        str(row["player"] or "").strip() for row in rows if row["player"]
    ))
    if not players:
        return None
    lines = []
    for raw in str(text or "").splitlines():
        compact = re.sub(r"[^a-z0-9]+", "", normalized_text(raw))
        if 5 <= len(compact) <= 32:
            lines.append(compact)
    if not lines:
        return None
    scored: list[tuple[float, str]] = []
    for player in players:
        compact = re.sub(r"[^a-z0-9]+", "", normalized_text(player))
        if not compact:
            continue
        best = max((
            SequenceMatcher(None, compact, line).ratio()
            for line in lines if abs(len(line) - len(compact)) <= 2
        ), default=0.0)
        scored.append((best, player))
    scored.sort(reverse=True)
    if not scored or scored[0][0] < 0.84:
        return None
    if len(scored) > 1 and scored[0][0] - scored[1][0] < 0.08:
        return None
    return scored[0][1]


def _recover_player(identity: CardIdentity, text: str, rows: list[Any]) -> tuple[CardIdentity, list[Any]]:
    if not rows:
        return identity, rows
    visible = visible_registry_player(text, rows)
    observed = str(identity.player or "").strip()
    team_contamination = is_registry_team_label(observed, rows)
    player = visible
    if player is None:
        player = _bounded_fuzzy_visible_player(text, rows)
    if player is None and observed and not team_contamination:
        exact = [row for row in rows if normalized_text(row["player"]) == normalized_text(observed)]
        if exact:
            return identity, exact
        observed_norm = normalized_text(observed)
        observed_tokens = set(observed_norm.split())
        plausible = {
            str(row["player"] or "") for row in rows
            if row["player"] and (
                normalized_text(row["player"]) in observed_norm
                or normalized_text(row["player"]).split()[-1] in observed_tokens
            )
        }
        if len(plausible) == 1:
            player = next(iter(plausible))
    if player:
        identity = identity.model_copy(update={"player": player})
        rows = [row for row in rows if normalized_text(row["player"]) == normalized_text(player)]
    elif team_contamination:
        updates = {"player": None}
        if observed and not identity.team:
            updates["team"] = observed
        identity = identity.model_copy(update=updates)
    return identity, rows


def _clear_product_line_subset(identity: CardIdentity, text: str) -> CardIdentity:
    """Do not let a physically printed product name masquerade as a subset constraint."""
    subset = normalized_text(identity.subset)
    if not subset:
        return identity
    physical = normalized_text(text)
    # Prefer concrete multi-word product marks over generic prose matches such as
    # the word "score" in a biography sentence. Only clear when the subset tokens
    # are literally contained in a product phrase visible on the card.
    product_phrases = (
        "prizm draft picks", "panini prizm", "panini select", "select wnba",
        "panini donruss", "donruss wnba", "topps chrome",
        "mcdonald s all american", "mcdonald's all american", "chrome mcdonald s all american",
        "o pee chee platinum", "sp authentic", "sp game used",
        "metal universe", "upper deck synergy",
    )
    subset_tokens = set(subset.split())
    for phrase in product_phrases:
        if phrase in physical and subset_tokens and subset_tokens.issubset(set(phrase.split())):
            return identity.model_copy(update={"subset": None})
    product = normalized_text(registry_product_line_hint_from_text(text))
    if product and subset_tokens and subset_tokens.issubset(set(product.split())):
        return identity.model_copy(update={"subset": None})
    return identity


def _repair_base_subset_role(identity: CardIdentity, text: str, rows: list[Any]) -> CardIdentity:
    """Move a physically printed BASE token from subset to parallel when Registry proves that role.

    Some OCR paths seed the standalone back label BASE as a subset. Reclassify it
    only inside an already year/product/card-bounded Registry family where no set
    family is actually named Base/Base Set, Base is a legal parallel, and BASE is
    independently visible as its own physical OCR line.
    """
    subset = normalized_text(identity.subset)
    if subset not in {"base", "base set"} or not rows:
        return identity
    set_names = {normalized_text(row["set_name"]) for row in rows if row["set_name"]}
    if subset in set_names or "base" in set_names or "base set" in set_names:
        return identity
    base_rows = [row for row in rows if normalized_text(row["parallel"]) == "base"]
    if not base_rows:
        return identity
    visible_base = any(normalized_text(line) == "base" for line in str(text or "").splitlines())
    if not visible_base:
        return identity
    return identity.model_copy(update={"subset": None, "parallel": "Base"})


def _physical_variation_guard(identity: CardIdentity, text: str, local_vision: Any, rows: list[Any]) -> list[Any]:
    """Use release-published physical variation markers only inside that release family."""
    if not rows:
        return rows
    physical = normalized_text(text)
    if str(identity.year or "")[:4] != "2024" or "prizm draft picks" not in physical:
        return rows
    names = {normalized_text(row["set_name"]) for row in rows}
    if not {"base set", "base variations"}.issubset(names):
        return rows
    back_text = ""
    if getattr(local_vision, "back", None) is not None:
        back_text = normalized_text("\n".join(str(o.text or "") for o in (local_vision.back.ocr or [])))
    if re.search(r"\bvariation\b", back_text):
        scoped = [row for row in rows if normalized_text(row["set_name"]) == "base variations"]
        return scoped or rows
    # TCDB's 2024 Prizm Draft Picks variation checklist specifies horizontal cards
    # with "Variation" printed on the back. A strongly read portrait card whose
    # back includes the Prizm Draft Picks footer but no Variation marker is Base Set.
    front = getattr(local_vision, "front", None)
    portrait = bool(front and float(front.height) > float(front.width) * 1.12)
    back_complete = "prizm draft picks" in back_text and bool(re.search(r"\bno\s*\.?\s*\d+\b", back_text))
    if portrait and back_complete:
        scoped = [row for row in rows if normalized_text(row["set_name"]) == "base set"]
        return scoped or rows
    return rows


def _recover_set(identity: CardIdentity, text: str, rows: list[Any]) -> tuple[CardIdentity, list[Any]]:
    if not rows:
        return identity, rows
    set_names = {str(row["set_name"] or "").strip() for row in rows if row["set_name"]}
    hint = normalized_text(identity.subset or identity.set_name)
    if hint and hint not in {"prizm", "select", "donruss", "mosaic", "optic"}:
        exact = [row for row in rows if normalized_text(row["set_name"]) == hint]
        if exact:
            family = str(exact[0]["set_name"])
            return identity.model_copy(update={"set_name": family, "subset": family}), exact
    physical = normalized_text(text)

    # Some hybrid releases print a short legacy sub-brand logo rather than the
    # full Registry set family (for example SCORE on a Select Score Throwback).
    # Promote it only when this already year/product/player/card-number-bounded
    # family contains exactly one set whose legal name carries that visible logo.
    physical_words = set(physical.split())
    # Scanner OCR may retain one leading punctuation mark or fuse one stray
    # digit to the compact SCORE logo (`-SCORE`, `3SCORE`). Accept only that
    # bounded logo-shaped corruption, never a fuzzy occurrence inside prose.
    score_logo_visible = any(
        re.fullmatch(r"[-_.]?\d?score", normalized_text(raw).strip())
        for raw in str(text or "").splitlines()
        if str(raw or "").strip()
    )
    if ("score" in physical_words or score_logo_visible) and normalized_text(identity.brand) == "select":
        score_families = [
            name for name in set_names
            if "score" in normalized_text(name).split() and "select" in normalized_text(name).split()
        ]
        score_families = list(dict.fromkeys(score_families))
        if len(score_families) == 1:
            family = score_families[0]
            scoped = [row for row in rows if normalized_text(row["set_name"]) == normalized_text(family)]
            if scoped:
                return identity.model_copy(update={"set_name": family, "subset": family}), scoped

    visible = [name for name in set_names if normalized_text(name) and normalized_text(name) in physical]
    visible = list(dict.fromkeys(visible))
    if len(visible) == 1:
        family = visible[0]
        scoped = [row for row in rows if normalized_text(row["set_name"]) == normalized_text(family)]
        return identity.model_copy(update={"set_name": family, "subset": family}), scoped
    # Short insert titles are frequently off by one OCR character (FGARLESS ->
    # Fearless). Fuzzy repair is allowed only inside this already exact
    # year/product/player/card-number family and only with a clear winning legal
    # set title. Generic labels are never fuzzily promoted.
    lines = [normalized_text(line) for line in str(text or "").splitlines()]
    fuzzy_names = [name for name in set_names if normalized_text(name) not in {"base", "base set", "inserts", "insert"}]
    scored: list[tuple[float, str]] = []
    for name in fuzzy_names:
        target = normalized_text(name)
        if not target or len(target) > 40:
            continue
        best = max((SequenceMatcher(None, target, line).ratio() for line in lines if 3 <= len(line) <= 45), default=0.0)
        scored.append((best, name))
    scored.sort(reverse=True)
    if scored and scored[0][0] >= 0.80 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.08):
        family = scored[0][1]
        scoped = [row for row in rows if normalized_text(row["set_name"]) == normalized_text(family)]
        if scoped:
            return identity.model_copy(update={"set_name": family, "subset": family}), scoped
    if len(set_names) == 1:
        family = next(iter(set_names))
        return identity.model_copy(update={"set_name": family}), rows
    return identity, rows


def _apply_serial_guard(identity: CardIdentity, local_vision: Any, rows: list[Any]) -> list[Any]:
    serial = local_vision.serial
    source_text = str(getattr(serial, "source_text", None) or "")
    fraction = re.search(r"(?<!\d)(\d{1,6})\s*/\s*(\d{1,6})(?!\d)", source_text)
    numerator = serial.numerator
    observed = serial.visible_denominator
    if fraction:
        if numerator is None:
            numerator = int(fraction.group(1))
        if observed is None:
            observed = int(fraction.group(2))

    # Reconcile raw OCR only inside the already-bounded legal Registry family.
    # This makes a repeat scan deterministic when one OCR channel drops a digit
    # (347/39) but /399 is the sole legal, numerator-compatible print run.
    legal_runs = [row["serial_run"] for row in rows if row["serial_run"] is not None]
    corrected = reconcile_visible_denominator(observed, numerator, legal_runs)
    if corrected is not None:
        scoped = [row for row in rows if row["serial_run"] == corrected]
        if scoped:
            return scoped

    if serial.stamp_present and serial.visible_denominator is not None:
        return [row for row in rows if row["serial_run"] == serial.visible_denominator]

    # Fraction-shaped physical evidence that could not be safely reconciled is
    # ambiguous, not proof of an unnumbered card. Leave the bounded family intact.
    if fraction:
        return rows

    if local_vision.apple_vision_available and not serial.stamp_present:
        return [row for row in rows if row["serial_run"] is None]
    return rows


def _row_identity(identity: CardIdentity, row: Any, parallel: str | None = None) -> CardIdentity:
    return identity.model_copy(update={
        "year": str(row["year"] or identity.year or "")[:4] or identity.year,
        "manufacturer": row["manufacturer"] or identity.manufacturer,
        "brand": row["brand"] or identity.brand,
        "set_name": row["set_name"] or identity.set_name,
        "player": row["player"] or identity.player,
        "team": row["team"] or identity.team,
        "card_number": row["card_number"] or identity.card_number,
        # Never inherit the first Registry row as a finish. A parallel is
        # written only when the legal family collapsed to one finish or the
        # bounded finish classifier actually selected it.
        "parallel": parallel,
        "serial_run": row["serial_run"] if row["serial_run"] is not None else identity.serial_run,
    })


_COLOR_ONLY_FINISHES = {"green", "blue", "orange", "red", "gold", "pink", "purple", "black", "silver", "yellow", "cyan", "white"}


def _color_only_parallel_choice(proportions: dict[str, float], legal: list[str]) -> str | None:
    """Resolve only exact whole-field color finishes from perimeter evidence."""
    base = [p for p in legal if normalized_text(p) == "base"]
    def _plain_color_key(value: object) -> str:
        # Some publisher checklists carry cosmetic trailing separators such as
        # `Blue -` / `Green -`. Strip only trailing punctuation for the purpose
        # of recognizing a simple whole-field color; compound names remain intact.
        return re.sub(r"[\s-]+$", "", normalized_text(value)).strip()
    colors = [(p, _plain_color_key(p), float(proportions.get(_plain_color_key(p), 0.0)))
              for p in legal if _plain_color_key(p) in _COLOR_ONLY_FINISHES]
    if colors:
        colors.sort(key=lambda item: item[2], reverse=True)
        top = colors[0]
        second = colors[1][2] if len(colors) > 1 else 0.0
        if top[2] >= 0.30 and top[2] - second >= 0.12:
            return top[0]
    # Negative color evidence is safe when every non-base legal option is a
    # simple whole-field color treatment and no such legal color dominates the
    # treatment perimeter. This generalizes Base-vs-one-color to releases with
    # Base/Blue/Green/Black while still refusing any family containing Ice,
    # Velocity, Shimmer, Holo, Silver, etc.
    non_base = [p for p in legal if normalized_text(p) != "base"]
    if len(base) == 1 and non_base and len(colors) == len(non_base):
        top_color = max((value for _, _, value in colors), default=0.0)
        if top_color <= 0.16:
            return base[0]
    return None


async def _choose_parallel(
    identity: CardIdentity,
    local_vision: Any,
    front: bytes,
    rows: list[Any],
    *,
    allow_model_disambiguation: bool = True,
) -> tuple[CardIdentity, list[Any]]:
    if not rows:
        return identity, rows
    current = normalized_text(identity.parallel or local_vision.identity_hints.parallel)
    try:
        trusted_style_score = float(local_vision.front.pattern.scores.get("trusted_style_memory", 0) or 0)
    except (AttributeError, TypeError, ValueError):
        trusted_style_score = 0.0
    style_memory_only = bool(
        current
        and trusted_style_score >= 0.70
        and normalized_text(identity.parallel) == normalized_text(local_vision.identity_hints.parallel)
    )
    # Learned style memory is a family hint, never final finish authority. A
    # remembered generic Ice/Silver/Flash label must still compete against the
    # exact Registry-legal finishes using CURRENT pixels, otherwise stale memory
    # can permanently hide Orange Ice, Blue Ice, Silver Flash, etc.
    parallels = list(dict.fromkeys(
        str(row["parallel"] or "")
        for row in rows
        if row["parallel"]
    ))

    # Base is frequently an upstream/default parser value rather than a
    # physically observed finish. When this exact Registry-bounded card family
    # contains multiple legal finishes, Base must compete with CURRENT physical
    # treatment evidence just like every other parallel. Never let a preliminary
    # Base guess collapse the family before finish discrimination.
    preliminary_base = bool(
        current == "base"
        and len({normalized_text(value) for value in parallels}) > 1
    )
    if preliminary_base:
        identity = identity.model_copy(update={"parallel": None})
        current = ""

    if current and not style_memory_only:
        exact = [
            row for row in rows
            if normalized_text(row["parallel"]) == current
        ]
        if exact:
            return identity.model_copy(
                update={"parallel": str(exact[0]["parallel"])}
            ), exact
    if len(parallels) == 1:
        chosen = parallels[0]
        return identity.model_copy(update={"parallel": chosen}), rows
    visible_finish = normalized_text(local_vision.identity_hints.parallel)
    pattern = normalized_text(local_vision.front.pattern.label)
    legal = [p for p in parallels if "logo" not in normalized_text(p) or "logo" in visible_finish or "logo" in pattern]
    if len(legal) < 2:
        return identity, rows
    treatment_proportions: dict[str, float] = {}
    try:
        treatment = analyze_treatment_colors(_decode_image(front))
        treatment_proportions = dict(treatment.proportions)
        deterministic = _color_only_parallel_choice(treatment.proportions, legal)
    except Exception:
        deterministic = None
    if deterministic:
        scoped = [row for row in rows if normalized_text(row["parallel"]) == normalized_text(deterministic)]
        if scoped:
            return identity.model_copy(update={"parallel": deterministic}), scoped
    if not allow_model_disambiguation:
        return identity, rows
    try:
        finish = await asyncio.wait_for(
            classify_registry_finish(
                front,
                legal,
                base_url=settings.ollama_base_url,
                model=settings.ollama_model,
                timeout=min(float(settings.ollama_timeout_seconds), 10.0),
                color_proportions=treatment_proportions,
            ),
            timeout=12.0,
        )
    except asyncio.TimeoutError:
        _debug("finish_classifier_timeout")
        return identity, rows
    _debug("finish_classifier", finish.parallel, finish.confidence, finish.evidence)
    if not finish.parallel:
        return identity, rows
    chosen = str(finish.parallel)
    scoped = [row for row in rows if normalized_text(row["parallel"]) == normalized_text(chosen)]
    if not scoped:
        return identity, rows
    return identity.model_copy(update={"parallel": chosen}), scoped


async def repair_scan_identity(
    identity: CardIdentity,
    *,
    text: str | None,
    local_vision: Any,
    front: bytes,
    registry_store: Any,
    registry_match: RegistryMatch,
    checklist_recovery: ChecklistRecovery,
    allow_external_recovery: bool = True,
    allow_model_disambiguation: bool = True,
) -> tuple[CardIdentity, ChecklistResult]:
    # Self-repair needs every physical OCR witness. A reduced parsed-text string
    # must never hide full Vision lines such as a split player name or insert title.
    physical_parts = [str(local_vision.combined_text or "").strip(), str(text or "").strip()]
    physical_text = "\n".join(dict.fromkeys(part for part in physical_parts if part))
    _debug("start", identity.model_dump())
    identity = await asyncio.to_thread(
        _repair_prebound_physical_identity, registry_store, identity, physical_text
    )
    _debug("prebound_physical", identity.year, identity.player, identity.card_number)
    identity = await asyncio.to_thread(
        _recover_card_number_from_player, registry_store, identity, physical_text
    )
    _debug("card_number", identity.card_number)
    rows = await asyncio.to_thread(_bounded_rows, registry_store, identity, physical_text)
    _debug("bounded", len(rows))
    gap_recovered = False

    async def _try_registry_gap() -> bool:
        nonlocal identity, rows, gap_recovered
        if not allow_external_recovery:
            return False
        _debug(
            "registry_gap_input",
            getattr(local_vision.serial, "model_dump", lambda: {})(),
            len(getattr(local_vision.front, "ocr", []) or []),
            len(getattr(local_vision.back, "ocr", []) or []) if getattr(local_vision, "back", None) else 0,
            len(physical_text),
        )
        try:
            gap_identity = await asyncio.wait_for(
                recover_exact_registry_gap(
                    registry_store, identity, physical_text, local_vision
                ),
                timeout=10.0,
            )
        except asyncio.TimeoutError:
            _debug("registry_gap_timeout")
            return False
        except Exception as error:
            _debug("registry_gap_error", repr(error))
            return False
        if gap_identity is None:
            _debug("registry_gap_no_match")
            return False
        identity = gap_identity
        rows = await asyncio.to_thread(_bounded_rows, registry_store, identity, physical_text)
        gap_recovered = bool(rows)
        _debug("registry_gap_recovered", identity.player, identity.card_number, identity.parallel, len(rows))
        return gap_recovered

    # If the release exists but omitted this exact card, supplement it before
    # wasting time re-downloading the same incomplete checklist.
    if not rows:
        await _try_registry_gap()

    if not rows and allow_external_recovery:
        try:
            recovered = await asyncio.wait_for(
                checklist_recovery(identity, physical_text),
                timeout=8.0,
            )
        except asyncio.TimeoutError:
            _debug("checklist_recovery_timeout")
            recovered = False
        except Exception as error:
            _debug("checklist_recovery_error", repr(error))
            recovered = False
        if recovered:
            rows = await asyncio.to_thread(_bounded_rows, registry_store, identity, physical_text)
            _debug("post_checklist_bounded", len(rows))

    # A newly imported release can itself be incomplete. Give exact-gap recovery
    # one final bounded pass before returning review.
    if not rows:
        await _try_registry_gap()

    if not rows:
        return identity, ChecklistResult(
            outcome=ChecklistOutcome.SET_ABSENT,
            reasons=["scan_self_repair_no_bounded_registry_rows"],
        )
    repaired, rows = _recover_player(identity, physical_text, rows)
    _debug("player", repaired.player, len(rows))
    auto_states = {bool(row["is_auto"]) for row in rows}
    if len(auto_states) > 1 and isinstance(repaired.autograph, bool):
        rows = [row for row in rows if bool(row["is_auto"]) == repaired.autograph]
        _debug(
            "autograph_guard",
            repaired.autograph,
            len(rows),
            ("source:existing_physical_fact",),
        )
    repaired = _clear_product_line_subset(repaired, physical_text)
    repaired = _repair_base_subset_role(repaired, physical_text, rows)
    rows = _physical_variation_guard(repaired, physical_text, local_vision, rows)
    _debug("variation_guard", len(rows), sorted({str(r["set_name"]) for r in rows}))
    repaired, rows = _recover_set(repaired, physical_text, rows)
    _debug("set", repaired.set_name, repaired.subset, len(rows))
    if gap_recovered and repaired.serial_run is not None:
        # Exact-card gap recovery has already reconciled the physical serial
        # against the trusted release matrix. Do not let a weaker raw OCR
        # denominator (for example 347/39) erase the proven /399 identity.
        rows = [row for row in rows if row["serial_run"] == repaired.serial_run]
    else:
        rows = _apply_serial_guard(repaired, local_vision, rows)
    _debug("serial", len(rows), sorted({str(r["parallel"]) for r in rows})[:30])
    if not rows:
        return identity, ChecklistResult(
            outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
            reasons=["scan_self_repair_constraints_eliminated_all_rows"],
        )
    # Consume any physical/deterministic finish evidence before using a model.
    try:
        repaired, rows = await _choose_parallel(
            repaired,
            local_vision,
            front,
            rows,
            allow_model_disambiguation=False,
        )
        _debug("parallel_deterministic", repaired.parallel, len(rows))
    except Exception as error:
        _debug("parallel_deterministic_error", repr(error))

    auto_states = {bool(row["is_auto"]) for row in rows}
    parallels = list(dict.fromkeys(
        str(row["parallel"] or "") for row in rows if row["parallel"]
    ))
    visible_finish = normalized_text(local_vision.identity_hints.parallel)
    pattern = normalized_text(local_vision.front.pattern.label)
    legal_surface_parallels = [
        value for value in parallels
        if "logo" not in normalized_text(value)
        or "logo" in visible_finish
        or "logo" in pattern
    ]
    if not legal_surface_parallels:
        legal_surface_parallels = parallels

    if allow_model_disambiguation and (
        len(auto_states) > 1 or len(legal_surface_parallels) > 1
    ):
        surface = await classify_registry_surface(
            front,
            legal_surface_parallels,
            base_url=settings.ollama_base_url,
            model=settings.ollama_model,
            timeout=min(max(float(settings.ollama_timeout_seconds), 12.0), 18.0),
        )
        _debug(
            "surface_classifier",
            surface.autograph,
            surface.parallel,
            surface.confidence,
            surface.evidence,
        )
        if surface.confidence >= 0.88:
            if len(auto_states) > 1 and isinstance(surface.autograph, bool):
                scoped = [
                    row for row in rows
                    if bool(row["is_auto"]) == surface.autograph
                ]
                if scoped:
                    repaired = repaired.model_copy(
                        update={"autograph": surface.autograph}
                    )
                    rows = scoped
                    _debug("surface_autograph", surface.autograph, len(rows))
            if surface.parallel:
                scoped = [
                    row for row in rows
                    if normalized_text(row["parallel"])
                    == normalized_text(surface.parallel)
                ]
                if scoped:
                    repaired = repaired.model_copy(
                        update={"parallel": surface.parallel}
                    )
                    rows = scoped
                    _debug("surface_parallel", surface.parallel, len(rows))

    # Do not invoke the old separate finish VLM after the joint surface referee.
    # A final deterministic pass only consumes any fact just proven above.
    try:
        repaired, rows = await _choose_parallel(
            repaired,
            local_vision,
            front,
            rows,
            allow_model_disambiguation=False,
        )
        _debug("parallel", repaired.parallel, len(rows))
    except Exception as error:
        _debug("parallel_error", repr(error))
    if rows:
        repaired = _row_identity(repaired, rows[0], repaired.parallel)
    _debug("before_match", repaired.model_dump())
    result = await registry_match(repaired, physical_text)
    _debug("result", result.outcome, result.reasons, result.candidate_count)
    if result.outcome == ChecklistOutcome.EXACT_MATCH:
        result = result.model_copy(update={
            "source_receipts": [*result.source_receipts, "scan_self_repair:on_the_spot"],
        })
    return repaired, result
