from __future__ import annotations

import json
import math
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from .models import CardIdentity, LocalVisionEvidence, TrainingExample
from .training import latest_training_examples


@dataclass(frozen=True)
class PatternStyleHint:
    parallel: str
    score: float
    support_count: int
    reference_scan_ids: tuple[str, ...]
    reasons: tuple[str, ...]


def _normalized(value: object) -> str:
    return " ".join(str(value or "").strip().lower().replace("&", " and ").split())


def _product_family(text: str | None, identity: CardIdentity | None = None) -> str | None:
    haystack = _normalized(" ".join(filter(None, [text, identity.brand if identity else None])))
    families = [
        ("o-pee-chee platinum", ("o-pee-chee platinum", "o pee chee platinum", "opc platinum")),
        ("upper deck allure", ("allure",)),
        ("upper deck stature", ("stature",)),
        ("sp authentic", ("sp authentic",)),
        ("bowman chrome", ("bowman chrome",)),
        ("bowman draft", ("bowman draft",)),
        ("bowmans best", ("bowman's best", "bowmans best")),
        ("panini select", ("select",)),
        ("panini prizm", ("prizm", "prism")),
        ("panini donruss", ("donruss",)),
    ]
    for family, needles in families:
        if any(needle in haystack for needle in needles):
            return family
    return None


def _closeness(left: float, right: float, scale: float) -> float:
    return max(0.0, 1.0 - abs(left - right) / max(scale, 1e-9))


def _count_closeness(left: int, right: int, floor: float = 8.0) -> float:
    denominator = max(float(left), float(right), floor)
    return max(0.0, 1.0 - abs(float(left) - float(right)) / denominator)


def _dict_cosine(left: dict[str, float], right: dict[str, float]) -> float | None:
    keys = set(left) | set(right)
    if not keys:
        return None
    dot = sum(float(left.get(key, 0.0)) * float(right.get(key, 0.0)) for key in keys)
    left_norm = math.sqrt(sum(float(left.get(key, 0.0)) ** 2 for key in keys))
    right_norm = math.sqrt(sum(float(right.get(key, 0.0)) ** 2 for key in keys))
    if left_norm <= 1e-9 or right_norm <= 1e-9:
        return None
    return max(0.0, min(1.0, dot / (left_norm * right_norm)))


def _angle_closeness(left: float | None, right: float | None) -> float | None:
    if left is None or right is None:
        return None
    difference = abs(float(left) - float(right)) % 180.0
    difference = min(difference, 180.0 - difference)
    return max(0.0, 1.0 - difference / 45.0)


def _pattern_similarity(current: LocalVisionEvidence, learned: LocalVisionEvidence) -> tuple[float, list[str]]:
    current_pattern = current.front.pattern
    learned_pattern = learned.front.pattern
    current_colors = current.front.colors
    learned_colors = learned.front.colors

    weighted: list[tuple[float, float, str]] = []

    pattern_cosine = _dict_cosine(current_pattern.scores, learned_pattern.scores)
    if pattern_cosine is not None:
        weighted.append((0.26, pattern_cosine, "pattern score profile"))

    if current_pattern.label != "unknown" and learned_pattern.label != "unknown":
        weighted.append(
            (
                0.16,
                1.0 if current_pattern.label == learned_pattern.label else 0.0,
                "deterministic pattern label",
            )
        )

    weighted.extend(
        [
            (0.08, _closeness(current_pattern.edge_density, learned_pattern.edge_density, 0.12), "edge density"),
            (0.08, _count_closeness(current_pattern.line_count, learned_pattern.line_count, 12.0), "line geometry"),
            (0.08, _count_closeness(current_pattern.polygon_count, learned_pattern.polygon_count, 15.0), "polygon geometry"),
            (0.06, _closeness(current_pattern.angle_concentration, learned_pattern.angle_concentration, 0.35), "angle concentration"),
            (0.06, _closeness(current_pattern.angle_entropy, learned_pattern.angle_entropy, 0.35), "angle entropy"),
            (0.07, _closeness(current_colors.metallic_score, learned_colors.metallic_score, 0.28), "metallic response"),
            (0.04, _closeness(current_colors.mean_saturation, learned_colors.mean_saturation, 0.35), "saturation"),
            (0.03, _closeness(current_colors.mean_brightness, learned_colors.mean_brightness, 0.30), "brightness"),
        ]
    )

    angle_similarity = _angle_closeness(current_pattern.dominant_angle, learned_pattern.dominant_angle)
    if angle_similarity is not None:
        weighted.append((0.04, angle_similarity, "dominant angle"))

    color_cosine = _dict_cosine(current_colors.proportions, learned_colors.proportions)
    if color_cosine is not None:
        weighted.append((0.04, color_cosine, "color proportion profile"))

    total_weight = sum(weight for weight, _, _ in weighted)
    if total_weight <= 0:
        return 0.0, []
    score = sum(weight * value for weight, value, _ in weighted) / total_weight
    strongest = [
        name
        for _, value, name in sorted(weighted, key=lambda item: item[1], reverse=True)
        if value >= 0.86
    ][:5]
    return max(0.0, min(1.0, score)), strongest


def _load_latest_examples(database_path: Path) -> list[TrainingExample]:
    if not database_path.exists():
        return []
    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True, timeout=2.0)
    try:
        rows = connection.execute(
            "SELECT example_json FROM training_examples ORDER BY created_at DESC LIMIT 10000"
        ).fetchall()
    finally:
        connection.close()
    parsed: list[TrainingExample] = []
    for (raw,) in rows:
        try:
            parsed.append(TrainingExample.model_validate(json.loads(raw)))
        except Exception:
            continue
    return latest_training_examples(parsed)


def find_trusted_pattern_style(
    *,
    database_path: Path,
    current: LocalVisionEvidence,
) -> PatternStyleHint | None:
    """Return one high-confidence learned parallel style without inventing identity.

    This memory is intentionally parallel-only. Player, card number, year and set
    remain Registry/printed-evidence responsibilities. One excellent supervised
    example can seed a style; additional examples reinforce it.
    """
    if current.identity_hints.parallel:
        return None

    current_manufacturer = _normalized(current.identity_hints.manufacturer)
    current_family = _product_family(current.combined_text, current.identity_hints)
    current_pattern = current.front.pattern
    current_colors = current.front.colors
    has_visual_signal = (
        current_pattern.label != "unknown"
        or current_pattern.line_count >= 8
        or current_pattern.polygon_count >= 10
        or current_pattern.edge_density >= 0.05
        or current_colors.metallic_score >= 0.10
    )
    if not has_visual_signal:
        return None

    grouped: dict[str, list[tuple[float, TrainingExample, list[str]]]] = defaultdict(list)
    for example in _load_latest_examples(database_path):
        if not example.trusted or not example.local_vision:
            continue
        parallel = str(example.confirmed_identity.parallel or "").strip()
        if not parallel:
            continue

        learned_manufacturer = _normalized(example.confirmed_identity.manufacturer)
        if current_manufacturer and learned_manufacturer and current_manufacturer != learned_manufacturer:
            continue

        learned_family = _product_family(
            example.local_vision.combined_text,
            example.confirmed_identity,
        )
        if current_family and learned_family and current_family != learned_family:
            continue
        # If current OCR cannot establish even a product family, require a very
        # strong visual match later. Never use style memory to guess across a
        # known different family.

        score, reasons = _pattern_similarity(current, example.local_vision)
        if score < 0.86:
            continue
        grouped[parallel].append((score, example, reasons))

    if not grouped:
        return None

    ranked: list[tuple[float, str, list[tuple[float, TrainingExample, list[str]]]]] = []
    for parallel, matches in grouped.items():
        matches.sort(key=lambda item: item[0], reverse=True)
        top = matches[:3]
        # Preserve one-shot learning: a single extremely close trusted example
        # is allowed. Repeated examples raise stability through the top-3 mean.
        group_score = sum(item[0] for item in top) / len(top)
        ranked.append((group_score, parallel, top))
    ranked.sort(reverse=True, key=lambda item: item[0])

    best_score, best_parallel, best_matches = ranked[0]
    runner_up = ranked[1][0] if len(ranked) > 1 else 0.0
    support_count = len(best_matches)
    threshold = 0.94 if support_count == 1 else 0.90
    if not current_family:
        threshold = max(threshold, 0.96)
    if best_score < threshold or (runner_up and best_score - runner_up < 0.035):
        return None

    reasons = list(dict.fromkeys(
        reason
        for _, _, match_reasons in best_matches
        for reason in match_reasons
    ))
    return PatternStyleHint(
        parallel=best_parallel,
        score=round(best_score, 4),
        support_count=support_count,
        reference_scan_ids=tuple(item[1].scan_id for item in best_matches),
        reasons=tuple(reasons[:6]),
    )


def apply_trusted_pattern_style(
    *,
    database_path: Path,
    evidence: LocalVisionEvidence,
) -> LocalVisionEvidence:
    try:
        hint = find_trusted_pattern_style(database_path=database_path, current=evidence)
    except Exception:
        return evidence
    if hint is None:
        return evidence

    identity_hints = evidence.identity_hints.model_copy(
        update={"parallel": hint.parallel}
    )
    pattern = evidence.front.pattern.model_copy(
        update={
            "scores": {
                **evidence.front.pattern.scores,
                "trusted_style_memory": hint.score,
            },
            "geometry": [
                *evidence.front.pattern.geometry,
                f"trusted style memory suggests {hint.parallel} ({hint.score:.3f}; support={hint.support_count})",
            ],
        }
    )
    front = evidence.front.model_copy(update={"pattern": pattern})
    return evidence.model_copy(update={"identity_hints": identity_hints, "front": front})
