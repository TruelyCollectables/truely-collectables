from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from .models import OCRBox, OCRObservation

_BUILD_LOCK = threading.Lock()
_ORIENTATION_OBSERVATION_CACHE_LOCK = threading.Lock()
_ORIENTATION_OBSERVATION_CACHE: dict[
    tuple[str, str],
    tuple[int, float, list[OCRObservation]],
] = {}
_ORIENTATION_OBSERVATION_CACHE_MAX = 64
_ORIENTATION_OBSERVATION_CACHE_TTL_SECONDS = 60.0


class AppleVisionOCR:
    """Compile and invoke a tiny native Apple Vision OCR helper.

    The helper is built lazily on the Mac mini from repository source. Linux CI
    exercises the deterministic unavailable path; macOS CI compiles the native
    helper. No cloud OCR or per-card API is involved.
    """

    def __init__(self, service_root: Path, data_root: Path) -> None:
        self.service_root = service_root
        self.source_path = service_root / "native" / "apple_vision_ocr.swift"
        self.bin_dir = data_root / "bin"
        self.binary_path = self.bin_dir / "apple-vision-ocr"
        self.digest_path = self.bin_dir / "apple-vision-ocr.sha256"
        self._thread_state = threading.local()
        try:
            configured_timeout = float(
                os.getenv("INSTACOMP_AI_APPLE_VISION_HELPER_TIMEOUT_SECONDS", "6")
            )
        except ValueError:
            configured_timeout = 6.0
        # A native Vision helper that has not answered quickly is wedged, not
        # "still thinking". Keep interactive scans responsive and fail this
        # optional OCR witness closed instead of stacking 45-second processes.
        self._helper_timeout_seconds = max(3.0, min(configured_timeout, 12.0))

    @property
    def supported(self) -> bool:
        return sys.platform == "darwin" and self.source_path.is_file()

    def health(self) -> tuple[bool, str | None]:
        if not self.supported:
            return False, "apple_vision_requires_macos"
        try:
            self._ensure_binary()
            return self.binary_path.is_file(), None
        except (OSError, subprocess.SubprocessError, RuntimeError) as exc:
            return False, f"apple_vision_build_failed:{type(exc).__name__.lower()}"

    @staticmethod
    def _orientation_cache_key(image_bytes: bytes, side: str) -> tuple[str, str]:
        return hashlib.sha256(image_bytes).hexdigest(), str(side)

    @classmethod
    def _remember_orientation_observations(
        cls,
        image_bytes: bytes,
        *,
        side: str,
        rotation: int,
        observations: list[OCRObservation],
    ) -> None:
        if not image_bytes or not observations:
            return
        key = cls._orientation_cache_key(image_bytes, side)
        now = time.monotonic()
        values = [observation.model_copy(deep=True) for observation in observations]
        with _ORIENTATION_OBSERVATION_CACHE_LOCK:
            _ORIENTATION_OBSERVATION_CACHE[key] = (
                int(rotation),
                now,
                values,
            )
            if len(_ORIENTATION_OBSERVATION_CACHE) > _ORIENTATION_OBSERVATION_CACHE_MAX:
                oldest = sorted(
                    _ORIENTATION_OBSERVATION_CACHE.items(),
                    key=lambda item: item[1][1],
                )[: len(_ORIENTATION_OBSERVATION_CACHE) - _ORIENTATION_OBSERVATION_CACHE_MAX]
                for old_key, _value in oldest:
                    _ORIENTATION_OBSERVATION_CACHE.pop(old_key, None)

    @classmethod
    def cached_orientation_observations(
        cls,
        image_bytes: bytes,
        *,
        side: str,
        rotation: int,
    ) -> list[OCRObservation] | None:
        if not image_bytes:
            return None
        key = cls._orientation_cache_key(image_bytes, side)
        now = time.monotonic()
        with _ORIENTATION_OBSERVATION_CACHE_LOCK:
            cached = _ORIENTATION_OBSERVATION_CACHE.get(key)
            if cached is None:
                return None
            cached_rotation, created_at, observations = cached
            if (
                int(cached_rotation) != int(rotation)
                or now - float(created_at) > _ORIENTATION_OBSERVATION_CACHE_TTL_SECONDS
            ):
                _ORIENTATION_OBSERVATION_CACHE.pop(key, None)
                return None
            return [observation.model_copy(deep=True) for observation in observations]

    def recognize(self, image_bytes: bytes, *, side: str) -> tuple[list[OCRObservation], list[str]]:
        if not image_bytes:
            return [], [f"{side}:empty_image"]
        if not self.supported:
            return [], [f"{side}:apple_vision_unavailable"]

        try:
            self._ensure_binary()
        except (OSError, subprocess.SubprocessError, RuntimeError) as exc:
            return [], [f"{side}:apple_vision_build_failed:{type(exc).__name__.lower()}"]

        # Apple Vision is an optional OCR witness inside the local-vision layer.
        # Any failure in its image preprocessing/helper/observation parsing must
        # be preserved as bounded evidence instead of taking down the entire scan.
        # OpenCV still runs independently in local_vision.py and remains required
        # for the fresh visual witness used by trusted-memory acceptance.
        orientation_only = bool(getattr(self._thread_state, "orientation_only", False))
        try:
            variants = (
                self._orientation_variants(image_bytes)
                if orientation_only
                else self._variants(image_bytes)
            )
        except Exception as exc:
            return [], [
                f"{side}:apple_vision_preprocess_failed:{type(exc).__name__.lower()}"
            ]

        preprocess_errors: list[str] = []
        if side == "back" and not orientation_only:
            variants = [value for value in variants if value[0] not in {"title_upper", "title_middle"}]
            # Card numbers are frequently printed as a tiny `No.` plus a large
            # isolated digit/code in the upper-right back corner. This crop is an
            # optional witness and must never abort the already-valid full-card
            # OCR variants when its own preprocessing fails.
            try:
                variants.append(("back_header", self._back_header_variant(image_bytes)))
            except Exception as exc:
                preprocess_errors.append(
                    f"{side}:back_header:apple_vision_preprocess_failed:{type(exc).__name__.lower()}"
                )
            try:
                variants.append(("number_corner_left", self._number_corner_left_variant(image_bytes)))
            except Exception as exc:
                preprocess_errors.append(
                    f"{side}:number_corner_left:apple_vision_preprocess_failed:{type(exc).__name__.lower()}"
                )
            try:
                variants.append(("number_corner", self._number_corner_variant(image_bytes)))
            except Exception as exc:
                preprocess_errors.append(
                    f"{side}:number_corner:apple_vision_preprocess_failed:{type(exc).__name__.lower()}"
                )

        # Tiny foil serial stamps are often lost in full-card OCR. Add enlarged,
        # overlapping horizontal bands as independent physical witnesses. These
        # crops are OCR-only: their local boxes never drive orientation/layout.
        try:
            if not orientation_only:
                variants.extend(self._serial_band_variants(image_bytes))
        except Exception as exc:
            preprocess_errors.append(
                f"{side}:serial_bands:apple_vision_preprocess_failed:{type(exc).__name__.lower()}"
            )

        observations: list[OCRObservation] = []
        errors: list[str] = list(preprocess_errors)

        # Each OCR variant is an independent native Vision subprocess. Running
        # all 7-8 witnesses serially made one card side take the sum of every
        # subprocess latency. Bound the per-side fan-out to three workers; front
        # and back already run concurrently, so live scans use at most six
        # native OCR helpers at once while preserving the exact same witnesses.
        native_timeout = threading.Event()

        def run_variant(item: tuple[str, bytes]):
            variant_name, variant_bytes = item
            if native_timeout.is_set():
                return (
                    variant_name,
                    [],
                    RuntimeError("apple_vision_native_timeout_circuit_open"),
                )
            try:
                return variant_name, self._run_variant(variant_bytes), None
            except subprocess.TimeoutExpired as exc:
                # Vision can occasionally wedge inside the native framework.
                # Once one helper times out, skip queued sibling variants for
                # this card side instead of spending another timeout per wave.
                native_timeout.set()
                return variant_name, [], exc
            except Exception as exc:
                return variant_name, [], exc

        try:
            configured_workers = int(os.getenv("INSTACOMP_AI_APPLE_VISION_VARIANT_WORKERS", "3"))
        except ValueError:
            configured_workers = 2
        worker_count = max(1, min(configured_workers, 3, len(variants)))
        if worker_count == 1:
            variant_results = [run_variant(item) for item in variants]
        else:
            with ThreadPoolExecutor(
                max_workers=worker_count, thread_name_prefix=f"apple-vision-{side}"
            ) as pool:
                # executor.map preserves input order, keeping evidence ordering
                # deterministic even though the native helpers finish out of order.
                variant_results = list(pool.map(run_variant, variants))

        for variant_name, values, variant_error in variant_results:
            if variant_error is not None:
                errors.append(
                    f"{side}:{variant_name}:apple_vision_failed:{type(variant_error).__name__.lower()}"
                )
                continue
            for value in values:
                try:
                    observation = OCRObservation(
                        text=value.text,
                        confidence=value.confidence,
                        box=value.box,
                        side=side,
                        source=f"apple_vision:{variant_name}",
                    )
                    if not self._is_duplicate(observation, observations):
                        observations.append(observation)
                except Exception as exc:
                    errors.append(
                        f"{side}:{variant_name}:apple_vision_observation_failed:{type(exc).__name__.lower()}"
                    )

        observations.sort(
            key=lambda value: (
                0 if value.side == "front" else 1,
                -value.box.y,
                value.box.x,
                -value.confidence,
            )
        )
        return observations, errors

    def _run_fast_identity_variants(
        self, variants: list[tuple[str, bytes]], *, side: str
    ) -> tuple[list[OCRObservation], list[str]]:
        observations: list[OCRObservation] = []
        errors: list[str] = []
        for variant_name, variant_bytes in variants:
            try:
                values = self._run_variant(variant_bytes)
            except Exception as exc:
                errors.append(f"{side}:{variant_name}:apple_vision_failed:{type(exc).__name__.lower()}")
                continue
            for value in values:
                observation = value.model_copy(update={
                    "side": side,
                    "source": f"apple_vision_fast:{variant_name}",
                })
                if not self._is_duplicate(observation, observations):
                    observations.append(observation)
        observations.sort(key=lambda value: (-value.box.y, value.box.x, -value.confidence))
        return observations, errors

    def recognize_identity_witness_single(
        self, image_bytes: bytes, *, side: str
    ) -> tuple[list[OCRObservation], list[str]]:
        """One full-card Apple Vision pass for the normal learned-card path."""
        if not image_bytes:
            return [], [f"{side}:empty_image"]
        if not self.supported:
            return [], [f"{side}:apple_vision_unavailable"]
        try:
            self._ensure_binary()
            variants = self._orientation_variants(image_bytes)[:1]
        except Exception as exc:
            return [], [f"{side}:fast_identity_preprocess_failed:{type(exc).__name__.lower()}"]
        return self._run_fast_identity_variants(variants, side=side)

    def recognize_identity_witness_recovery(
        self, image_bytes: bytes, *, side: str
    ) -> tuple[list[OCRObservation], list[str]]:
        """Selective contrast/number-corner recovery after the one-pass witness fails."""
        if not image_bytes:
            return [], [f"{side}:empty_image"]
        if not self.supported:
            return [], [f"{side}:apple_vision_unavailable"]
        try:
            self._ensure_binary()
            variants = self._orientation_variants(image_bytes)[1:2]
            if side == "back":
                # Keep seller-scan recovery bounded but include the three small
                # back witnesses that most often contain the printed card code.
                # These replace the much broader serial-band/full-variant sweep.
                variants.append(("back_header", self._back_header_variant(image_bytes)))
                variants.append(("number_corner_left", self._number_corner_left_variant(image_bytes)))
                variants.append(("number_corner", self._number_corner_variant(image_bytes)))
        except Exception as exc:
            return [], [f"{side}:fast_identity_recovery_preprocess_failed:{type(exc).__name__.lower()}"]
        return self._run_fast_identity_variants(variants, side=side)

    def recognize_serial_box_recovery(
        self, image_bytes: bytes, observations: list[OCRObservation], *, side: str, expected_run: int
    ) -> tuple[list[OCRObservation], list[str]]:
        """Re-OCR a padded physical stamp box without using the remembered numerator."""
        if not image_bytes:
            return [], [f"{side}:empty_image"]
        if not self.supported:
            return [], [f"{side}:apple_vision_unavailable"]
        try:
            self._ensure_binary()
            variants = self._serial_box_recovery_variants(
                image_bytes, observations, expected_run=int(expected_run)
            )
        except Exception as exc:
            return [], [f"{side}:serial_box_recovery_preprocess_failed:{type(exc).__name__.lower()}"]
        return self._run_fast_identity_variants(variants, side=side)

    def recognize_serial_micro(
        self, image_bytes: bytes, *, side: str
    ) -> tuple[list[OCRObservation], list[str]]:
        """Fast common-zone stamp probe used before a Base identity can lock.

        These are tiny physical-image crops only. They do not infer a print run
        from Registry data; they merely surface low-contrast stamped glyphs that
        full-card OCR commonly misses.
        """
        if not image_bytes:
            return [], [f"{side}:empty_image"]
        if not self.supported:
            return [], [f"{side}:apple_vision_unavailable"]
        try:
            self._ensure_binary()
            variants = self._serial_micro_variants(image_bytes)
        except Exception as exc:
            return [], [f"{side}:serial_micro_preprocess_failed:{type(exc).__name__.lower()}"]
        return self._run_fast_identity_variants(variants, side=side)

    def recognize_serial_forensic(
        self, image_bytes: bytes, *, side: str
    ) -> tuple[list[OCRObservation], list[str]]:
        """Bounded physical stamp OCR for edge/logo-obscured serial layouts."""
        if not image_bytes:
            return [], [f"{side}:empty_image"]
        if not self.supported:
            return [], [f"{side}:apple_vision_unavailable"]
        try:
            self._ensure_binary()
            variants = self._serial_forensic_variants(image_bytes)
        except Exception as exc:
            return [], [f"{side}:serial_forensic_preprocess_failed:{type(exc).__name__.lower()}"]
        return self._run_fast_identity_variants(variants, side=side)

    def recognize_identity_witness(self, image_bytes: bytes, *, side: str) -> tuple[list[OCRObservation], list[str]]:
        """Fast seller-facing identity witness.

        Normal identification gets exactly one full-card Apple Vision pass per
        side. Targeted recovery is an explicit fallback elsewhere in the
        pipeline and must never run automatically on every card.
        """
        return self.recognize_identity_witness_single(
            image_bytes,
            side=side,
        )

    @staticmethod
    def _clockwise_rotated_bytes(content: bytes, rotation: int) -> bytes:
        from io import BytesIO

        with Image.open(BytesIO(content)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            if rotation:
                image = image.rotate(-rotation, expand=True)
            image.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
            output = BytesIO()
            image.save(
                output,
                format="JPEG",
                quality=92,
                optimize=True,
                progressive=False,
                subsampling=0,
            )
            return output.getvalue()

    @staticmethod
    def _image_frame_rotation_choices(content: bytes) -> tuple[tuple[int, ...], list[str]]:
        from io import BytesIO

        with Image.open(BytesIO(content)) as opened:
            try:
                image = ImageOps.exif_transpose(opened)
            except Exception:
                image = opened.copy()
            width = int(image.width)
            height = int(image.height)

        longer = max(width, height)
        shorter = max(1, min(width, height))
        aspect = longer / shorter
        if aspect < 1.08:
            return (0, 90, 180, 270), [
                f"image_frame_unclear:{width}x{height}:aspect_{aspect:.2f}"
            ]
        if width > height:
            return (90, 270), [f"image_frame_landscape:{width}x{height}:force_portrait"]
        return (0, 180), [f"image_frame_portrait:{width}x{height}:allow_flip_only"]

    @staticmethod
    def _card_frame_rotation_choices(content: bytes) -> tuple[tuple[int, ...], list[str]] | None:
        """Use the detected physical card rectangle as a hard sideways gate.

        OCR is still responsible for deciding which end is up, but OCR should
        not be allowed to keep a standard portrait card sideways just because
        Apple Vision managed to read a few rotated words.
        """
        try:
            import cv2
            import numpy as np
            from io import BytesIO

            with Image.open(BytesIO(content)) as opened:
                image = ImageOps.exif_transpose(opened).convert("RGB")
                image.thumbnail((1400, 1400), Image.Resampling.LANCZOS)
                rgb = np.array(image)

            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
            gray = cv2.GaussianBlur(gray, (5, 5), 0)
            edges = cv2.Canny(gray, 40, 130)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            image_area = float(rgb.shape[0] * rgb.shape[1])
            best: tuple[float, float, float, float] | None = None
            for contour in contours:
                area = float(cv2.contourArea(contour))
                if area < image_area * 0.08 or area > image_area * 0.98:
                    continue
                rect = cv2.minAreaRect(contour)
                rect_width, rect_height = float(rect[1][0]), float(rect[1][1])
                if rect_width <= 0 or rect_height <= 0:
                    continue
                long_side = max(rect_width, rect_height)
                short_side = max(1.0, min(rect_width, rect_height))
                aspect = long_side / short_side
                if aspect < 1.18 or aspect > 1.85:
                    continue
                fill = area / max(1.0, rect_width * rect_height)
                if fill < 0.55:
                    continue
                score = area * min(1.0, fill)
                if best is None or score > best[0]:
                    best = (score, rect_width, rect_height, aspect)

            if best is None:
                return None

            _, rect_width, rect_height, aspect = best
            if rect_width > rect_height:
                return (90, 270), [
                    f"card_frame_landscape:{rect_width:.0f}x{rect_height:.0f}:aspect_{aspect:.2f}:force_portrait"
                ]
            return (0, 180), [
                f"card_frame_portrait:{rect_width:.0f}x{rect_height:.0f}:aspect_{aspect:.2f}:allow_flip_only"
            ]
        except Exception:
            return None

    @classmethod
    def _geometry_rotation_choices(
        cls, content: bytes, *, side: str
    ) -> tuple[tuple[int, ...], list[str]]:
        image_rotations, image_evidence = cls._image_frame_rotation_choices(content)
        card_frame = cls._card_frame_rotation_choices(content)
        if card_frame is not None:
            card_rotations, card_evidence = card_frame
            if set(image_rotations) != set(card_rotations):
                return (0, 90, 180, 270), [
                    *image_evidence,
                    *card_evidence,
                    f"{side}_geometry_disagreement:test_all_rotations",
                ]
            return card_rotations, [*image_evidence, *card_evidence]
        return image_rotations, image_evidence

    @staticmethod
    def _ambiguous_rotation_fallback(*, side: str, rotations: tuple[int, ...]) -> tuple[int, str]:
        return 0, f"{side}_ambiguous_fallback:keep_0"

    @staticmethod
    def _orientation_score(
        observations: list[OCRObservation],
        *,
        side: str,
    ) -> float:
        score = 0.0
        for observation in observations:
            compact = "".join(character for character in observation.text if character.isalnum())
            if len(compact) < 2:
                continue
            line_aspect = observation.box.width / max(0.005, observation.box.height)
            legibility = max(0.0, observation.confidence) * min(24, len(compact))
            # Vision can sometimes transcribe a 90° text column, which made a
            # sideways card look deceptively readable. Real upright card text
            # has a horizontal baseline: its bounding box is wider than it is
            # tall. Down-weight tall OCR boxes before semantic anchors are
            # considered, while retaining a small score for narrow labels.
            if line_aspect < 1.0:
                legibility *= max(0.1, line_aspect)
            elif line_aspect >= 1.5:
                legibility += min(4.0, (line_aspect - 1.0) * 0.75)
            score += legibility
            score += min(2.0, observation.box.width * 4.0)

            # Fast Apple Vision is deliberately used for bounded live-card OCR.
            # It can still emit a surprising amount of glyph-like garbage for an
            # upside-down image, so raw OCR volume is not enough to choose 0° vs
            # 180°. Reward recognizable sports-card / legal-language anchors.
            # These words prove orientation only; they never establish identity.
            normalized_text = " ".join(observation.text.casefold().split())
            semantic_anchors = re.findall(
                r"\b(?:rc|rookie|topps|bowman|panini|donruss|prizm|select|"
                r"nflpa|nbapa|wnbpa|mlb|nfl|nba|nhl|wnba|basketball|baseball|"
                r"football|hockey|college|drafted|born|season|career|yards?|"
                r"touchdowns?|trademark|registered|licensed|company|rights|reserved)\b",
                normalized_text,
            )
            if "upper deck" in normalized_text:
                semantic_anchors.append("upper deck")
            # Fast Vision occasionally turns an upright ROOKIE/CARD label into
            # pookie/capg. Those are still much stronger orientation evidence
            # than mirrored alphabet soup from a wrong 180-degree candidate, but
            # they are not identity evidence.
            if re.search(r"\b(?:pookie|2ookie|roo[kx]ie)\b", normalized_text):
                semantic_anchors.append("rookie_ocr")
            if re.search(r"\b(?:capg|carg)\b", normalized_text):
                semantic_anchors.append("card_ocr")
            score += min(72.0, 12.0 * len(set(semantic_anchors)))

            if side == "back":
                # Upright card backs usually contain normal prose. Wrong 180
                # candidates can still produce lots of glyphs, so raw OCR volume
                # alone is misleading. Common function words are used only as a
                # text-direction witness; they never identify the card.
                language_words = re.findall(
                    r"\b(?:the|and|her|his|she|he|with|from|into|for|of|to|in|"
                    r"on|is|are|was|were|this|that|when|court|team|guard|season)\b",
                    normalized_text,
                )
                score += min(18.0, 6.0 * len(set(language_words)))

            # Vision can read text upside down, so raw OCR quantity alone cannot
            # distinguish 0° from 180°. Card backs provide a deterministic
            # layout witness: legal/licensing copy belongs at the bottom and the
            # printed card number normally belongs near the top. Weight those
            # positions heavily enough to break an otherwise rotation-invariant
            # OCR tie without applying the heuristic to card fronts.
            if side == "back":
                normalized_text = " ".join(observation.text.casefold().split())
                center_y = observation.box.y + observation.box.height / 2
                legal_footer = any(
                    marker in normalized_text
                    for marker in (
                        "©",
                        "panini america",
                        "officially licensed",
                        "trademark",
                        "all rights reserved",
                        "printed in",
                        "made in",
                    )
                )
                if legal_footer:
                    score += 36.0 * (0.5 - center_y)
                if re.search(
                    r"\b(?:no\.?|card\s*(?:no\.?|#))\s*[a-z0-9-]+",
                    normalized_text,
                ):
                    score += 12.0 * (center_y - 0.5)
            elif side == "front":
                normalized_text = " ".join(observation.text.casefold().split())
                strong_top_anchor = re.search(
                    r"\b(?:rc|rookie|all-american|draft\s+picks?)\b",
                    normalized_text,
                )
                product_top_anchor = re.search(
                    r"\b(?:topps|bowman|panini|prizm|select|donruss|upper\s+deck)\b",
                    normalized_text,
                )

                words = re.findall(r"[a-z]+", normalized_text)
                likely_player_label = (
                    2 <= len(words) <= 4
                    and 5 <= len(normalized_text) <= 32
                    and observation.text.upper() == observation.text
                    and not strong_top_anchor
                    and not product_top_anchor
                    # Native Apple Vision's fast path frequently reports
                    # correctly-read card-front labels at 0.50 confidence. Requiring
                    # 0.70 discarded strong two-to-four-word uppercase player labels
                    # and let upside-down glyph volume beat readable names.
                    and observation.confidence >= 0.45
                    and observation.box.width >= 0.18
                )
                if likely_player_label:
                    score += 36.0
        return score

    @staticmethod
    def _front_layout_score(observations: list[OCRObservation]) -> float:
        """Return position-only evidence that a front candidate is upright.

        This deliberately ignores raw OCR volume. It exists to decide the
        dangerous 0° vs 180° case, where Vision may transcribe both directions.
        """
        score = 0.0
        for observation in observations:
            normalized_text = " ".join(observation.text.casefold().split())
            words = re.findall(r"[a-z]+", normalized_text)
            # Apple Vision bounding boxes use a bottom-left origin, while these
            # front layout heuristics are written as conventional image Y
            # coordinates (0=top, 1=bottom). Flip Y before scoring anchors.
            center_y = 1.0 - (observation.box.y + observation.box.height / 2)
            strong_top_anchor = re.search(
                r"\b(?:rc|rookie|all-american|draft\s+picks?)\b",
                normalized_text,
            )
            product_top_anchor = re.search(
                r"\b(?:topps|bowman|panini|prizm|select|donruss|upper\s+deck)\b",
                normalized_text,
            )
            likely_player_label = (
                2 <= len(words) <= 4
                and 5 <= len(normalized_text) <= 32
                and observation.text.upper() == observation.text
                and not strong_top_anchor
                and not product_top_anchor
                # Position scoring uses the same native Vision floor as
                # the semantic front-name witness. The uppercase/multiword/layout
                # constraints remain the fail-closed guard against random glyphs.
                and observation.confidence >= 0.45
                and observation.box.width >= 0.18
            )
            if likely_player_label:
                score += max(-18.0, min(26.0, 52.0 * (center_y - 0.58)))
            if strong_top_anchor:
                score += max(-10.0, min(18.0, 36.0 * (0.50 - center_y)))
            if product_top_anchor:
                score += max(-5.0, min(8.0, 16.0 * (0.50 - center_y)))
        return score

    @classmethod
    def _source_upright_fast_decision(
        cls,
        observations: list[OCRObservation],
        *,
        side: str,
    ) -> tuple[bool, float, list[str]]:
        """Accept source 0° only when physical layout evidence is unusually strong.

        This is a latency optimization, never an identity shortcut. Weak, sparse,
        sideways, or contradictory OCR falls through to the full four-rotation
        referee exactly as before.
        """
        reliable = []
        for observation in observations:
            compact = "".join(ch for ch in observation.text if ch.isalnum())
            aspect = observation.box.width / max(0.005, observation.box.height)
            if (
                len(compact) >= 2
                and observation.confidence >= 0.68
                and aspect >= 1.10
            ):
                reliable.append(observation)
        if len(reliable) < 3:
            return False, 0.0, []

        score = cls._orientation_score(reliable, side=side)
        texts = [
            str(observation.text).strip()[:80]
            for observation in reliable
            if str(observation.text).strip()
        ]

        if side == "front":
            layout = cls._front_layout_score(reliable)
            has_product_anchor = any(
                re.search(
                    r"\b(?:topps|bowman|panini|prizm|select|donruss|upper\s+deck|"
                    r"rc|rookie|all-american|draft\s+picks?)\b",
                    str(observation.text),
                    re.I,
                )
                for observation in reliable
            )
            has_player_layout = False
            for observation in reliable:
                normalized = " ".join(observation.text.casefold().split())
                words = re.findall(r"[a-z]+", normalized)
                conventional_y = 1.0 - (
                    observation.box.y + observation.box.height / 2
                )
                if (
                    2 <= len(words) <= 4
                    and 5 <= len(normalized) <= 32
                    and observation.text.upper() == observation.text
                    and observation.confidence >= 0.72
                    and observation.box.width >= 0.18
                    and conventional_y >= 0.62
                    and not re.search(
                        r"\b(?:topps|bowman|panini|prizm|select|donruss|rookie|rc)\b",
                        normalized,
                    )
                ):
                    has_player_layout = True
                    break
            accepted = bool(
                score >= 70.0
                and layout >= 6.0
                and has_product_anchor
                and has_player_layout
            )
            if not accepted:
                return False, 0.0, []
            confidence = max(0.90, min(0.99, 0.90 + min(score, 150.0) / 1500.0))
            return True, confidence, [
                f"{side}:fast_source_upright:score_{score:.2f}:layout_{layout:.2f}",
                *texts[:5],
            ]

        legal_footer = False
        top_card_number = False
        language_hits: set[str] = set()
        for observation in reliable:
            normalized = " ".join(observation.text.casefold().split())
            center_y = observation.box.y + observation.box.height / 2
            if (
                center_y <= 0.42
                and any(
                    marker in normalized
                    for marker in (
                        "officially licensed",
                        "trademark",
                        "all rights reserved",
                        "printed in",
                        "made in",
                        "panini america",
                    )
                )
            ):
                legal_footer = True
            if (
                center_y >= 0.58
                and re.search(
                    r"\b(?:no\.?|card\s*(?:no\.?|#))\s*[a-z0-9-]+",
                    normalized,
                )
            ):
                top_card_number = True
            language_hits.update(
                re.findall(
                    r"\b(?:the|and|her|his|she|he|with|from|for|of|to|in|"
                    r"season|career|team|guard|drafted|born)\b",
                    normalized,
                )
            )

        accepted = bool(
            score >= 82.0
            and legal_footer
            and (top_card_number or len(language_hits) >= 2)
            and len(reliable) >= 4
        )
        if not accepted:
            return False, 0.0, []
        confidence = max(0.90, min(0.99, 0.91 + min(score, 180.0) / 1800.0))
        return True, confidence, [
            f"{side}:fast_source_upright:score_{score:.2f}:legal_footer_1:"
            f"card_number_{int(top_card_number)}",
            *texts[:5],
        ]

    def detect_upright_rotation(
        self,
        image_bytes: bytes,
        *,
        side: str,
    ) -> tuple[int, float, list[str]]:
        """Return the clockwise text correction selected from geometry-gated OCR."""
        if not self.supported:
            return 0, 0.0, [f"{side}:apple_vision_unavailable"]

        rotations = (0, 90, 180, 270)
        geometry_rotations: tuple[int, ...] = rotations
        if side == "front":
            geometry_evidence: list[str] = []
            try:
                image_rotations, image_evidence = self._image_frame_rotation_choices(
                    image_bytes
                )
                geometry_rotations = tuple(image_rotations)
                geometry_evidence.extend(image_evidence)
            except Exception as exc:
                geometry_evidence.append(
                    f"image_geometry_failed:{type(exc).__name__.lower()}"
                )
            try:
                card_frame = self._card_frame_rotation_choices(image_bytes)
                if card_frame is not None:
                    _card_rotations, card_evidence = card_frame
                    geometry_evidence.extend(card_evidence)
            except Exception as exc:
                geometry_evidence.append(
                    f"card_geometry_failed:{type(exc).__name__.lower()}"
                )
            if not geometry_evidence:
                geometry_evidence = ["front_geometry_all_rotations"]
        else:
            # Back layouts are frequently landscape inside a portrait capture.
            # Geometry can describe the card frame but must not eliminate the
            # true text orientation; let all four OCR rotations compete.
            try:
                candidate_rotations, geometry_evidence = self._geometry_rotation_choices(
                    image_bytes,
                    side=side,
                )
                geometry_rotations = tuple(candidate_rotations)
            except Exception as exc:
                geometry_evidence = [
                    f"geometry_probe_failed:{type(exc).__name__.lower()}:all_rotations"
                ]

        try:
            orientation_budget = float(
                os.getenv("INSTACOMP_AI_ORIENTATION_BUDGET_SECONDS", "12")
            )
        except ValueError:
            orientation_budget = 12.0
        orientation_budget = max(6.0, min(orientation_budget, 30.0))
        orientation_started = time.monotonic()

        candidates: list[tuple[int, float, list[OCRObservation]]] = []
        self._thread_state.orientation_only = True
        try:
            for rotation in rotations:
                rotated = self._clockwise_rotated_bytes(image_bytes, rotation)
                observations, orientation_errors = self.recognize(rotated, side=side)
                if any(
                    "timeoutexpired" in str(value).lower()
                    or "native_timeout" in str(value).lower()
                    for value in orientation_errors
                ):
                    return 0, 0.0, [
                        *[f"{side}:{value}" for value in geometry_evidence],
                        f"{side}:apple_vision_orientation_timeout:rotation_{rotation}",
                    ][:6]

                score = self._orientation_score(observations, side=side)
                candidates.append((rotation, score, observations))

                # Most scanner captures are already upright. Prove source 0°
                # first and skip three extra native OCR waves only when layout,
                # card-language, and geometry all independently agree. Anything
                # weaker keeps the full four-way referee.
                if rotation == 0 and 0 in geometry_rotations:
                    accepted, confidence, fast_evidence = (
                        self._source_upright_fast_decision(
                            observations,
                            side=side,
                        )
                    )
                    if accepted:
                        self._remember_orientation_observations(
                            image_bytes,
                            side=side,
                            rotation=0,
                            observations=observations,
                        )
                        return 0, confidence, fast_evidence[:6]

                # A slow native Vision helper is a reliability fault, not a
                # reason to keep stacking more subprocess work. Fail closed to
                # orientation review once the bounded per-side budget is spent.
                if (
                    rotation != rotations[-1]
                    and time.monotonic() - orientation_started >= orientation_budget
                ):
                    return 0, 0.0, [
                        f"{side}:orientation_budget_exhausted:{orientation_budget:.1f}s",
                        *[f"{side}:{value}" for value in geometry_evidence],
                    ][:6]
        finally:
            self._thread_state.orientation_only = False

        if side == "front":
            # Every front rotation competes under one scoring contract.  The old
            # portrait-vs-sideways branches used different thresholds and could
            # preserve an upside-down 0-degree source even when 180 was better.
            ranked: list[tuple[int, float, float, float, list[OCRObservation]]] = []
            for rotation, ocr_score, observations in candidates:
                layout_score = self._front_layout_score(observations)
                combined_score = ocr_score + layout_score
                ranked.append((rotation, combined_score, ocr_score, layout_score, observations))
            ranked.sort(key=lambda candidate: (-candidate[1], -candidate[2], candidate[0]))
            best_rotation, best_total, best_ocr, best_layout, best_observations = ranked[0]
            second_total = ranked[1][1]
            if best_total <= 0:
                evidence = [f"{side}:{value}" for value in geometry_evidence]
                evidence.append(f"{side}:front_review_required:no_upright_text")
                return 0, 0.0, evidence[:6]
            margin = max(0.0, best_total - second_total)
            relative_margin = margin / max(1.0, abs(best_total))
            decisive = margin >= 3.0 or relative_margin >= 0.04
            # If the source orientation narrowly wins, preserving it is safe: we
            # are not applying a speculative rotation. A non-zero winner must be
            # decisive before we physically rotate the canonical image.
            if best_rotation == 0:
                decisive = True
            confidence = max(0.55, min(0.99, 0.55 + relative_margin)) if decisive else max(0.0, min(0.54, relative_margin / 0.04 * 0.54))
            evidence = [f"{side}:{value}" for value in geometry_evidence]
            evidence.append(
                f"{side}:front_four_way_rotation:{best_rotation}:total_{best_total:.2f}:ocr_{best_ocr:.2f}:layout_{best_layout:.2f}:margin_{margin:.2f}"
            )
            evidence.extend(observation.text[:80] for observation in best_observations if observation.text.strip())
            self._remember_orientation_observations(
                image_bytes,
                side=side,
                rotation=best_rotation,
                observations=best_observations,
            )
            return best_rotation, confidence, evidence[:6]

        candidates.sort(key=lambda candidate: (-candidate[1], candidate[0]))
        best_rotation, best_score, best_observations = candidates[0]
        second_score = candidates[1][1]
        fallback_rotation, fallback_evidence = self._ambiguous_rotation_fallback(
            side=side,
            rotations=rotations,
        )
        if best_score <= 0:
            return fallback_rotation, 0.0, [
                *[f"{side}:{value}" for value in geometry_evidence],
                f"{side}:{fallback_evidence}",
                f"{side}:no_readable_text_for_orientation",
            ]

        margin = max(0.0, (best_score - second_score) / max(1.0, best_score))
        # A close score is ambiguous even when the winning candidate is 0°.
        # Reporting those ties as completed previously let an unchanged,
        # potentially upside-down upload reach the listing workspace. Keep the
        # pixels unchanged, but return sub-threshold confidence so the caller
        # can retry or hold the card outside Pending Listings.
        decisive = margin >= 0.04
        confidence = (
            max(0.55, min(0.99, 0.55 + margin))
            if decisive
            else max(0.0, min(0.54, margin / 0.04 * 0.54))
        )
        applied_rotation = best_rotation if decisive or 0 not in rotations else fallback_rotation
        evidence = [f"{side}:{value}" for value in geometry_evidence]
        if not decisive and 0 in rotations:
            evidence.append(f"{side}:{fallback_evidence}")
        evidence.extend(
            observation.text[:80]
            for observation in best_observations
            if observation.text.strip()
        )
        evidence = evidence[:6]
        if applied_rotation == best_rotation:
            self._remember_orientation_observations(
                image_bytes,
                side=side,
                rotation=best_rotation,
                observations=best_observations,
            )
        return applied_rotation, confidence, evidence

    def _ensure_binary(self) -> None:
        if not self.supported:
            raise RuntimeError("Apple Vision OCR is only available on macOS")
        source_digest = hashlib.sha256(self.source_path.read_bytes()).hexdigest()
        if (
            self.binary_path.is_file()
            and os.access(self.binary_path, os.X_OK)
            and self.digest_path.is_file()
            and self.digest_path.read_text(encoding="utf-8").strip() == source_digest
        ):
            return

        with _BUILD_LOCK:
            if (
                self.binary_path.is_file()
                and os.access(self.binary_path, os.X_OK)
                and self.digest_path.is_file()
                and self.digest_path.read_text(encoding="utf-8").strip() == source_digest
            ):
                return
            self.bin_dir.mkdir(parents=True, exist_ok=True)
            swiftc = shutil.which("swiftc")
            xcrun = shutil.which("xcrun")
            if not swiftc and xcrun:
                probe = subprocess.run(
                    [xcrun, "--find", "swiftc"],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                candidate = probe.stdout.strip()
                if probe.returncode == 0 and candidate and Path(candidate).is_file():
                    swiftc = candidate

            temporary_binary = self.binary_path.with_name(
                self.binary_path.name + ".partial"
            )
            temporary_digest = self.digest_path.with_name(
                self.digest_path.name + ".partial"
            )
            temporary_binary.unlink(missing_ok=True)
            temporary_digest.unlink(missing_ok=True)

            base_args = [
                str(self.source_path),
                "-O",
                "-framework",
                "Vision",
                "-framework",
                "AppKit",
                "-framework",
                "CoreGraphics",
                "-o",
                str(temporary_binary),
            ]
            attempts: list[tuple[list[str], dict[str, str] | None]] = []
            if swiftc:
                attempts.append(([swiftc, *base_args], None))

            clt_root = Path("/Library/Developer/CommandLineTools")
            clt_swiftc = clt_root / "usr" / "bin" / "swiftc"
            clt_sdk = clt_root / "SDKs" / "MacOSX.sdk"
            clt_resources = clt_root / "usr" / "lib" / "swift"
            if clt_swiftc.is_file() and clt_sdk.exists() and clt_resources.is_dir():
                clt_env = dict(os.environ)
                clt_env["DEVELOPER_DIR"] = str(clt_root)
                attempts.append((
                    [
                        str(clt_swiftc),
                        *base_args[:-2],
                        "-sdk", str(clt_sdk),
                        "-resource-dir", str(clt_resources),
                        *base_args[-2:],
                    ],
                    clt_env,
                ))

            if not attempts:
                raise RuntimeError(
                    "swiftc was not found. Install the Apple command-line developer tools."
                )

            failures: list[str] = []
            completed = None
            for command, env in attempts:
                temporary_binary.unlink(missing_ok=True)
                try:
                    completed = subprocess.run(
                        command,
                        check=False,
                        capture_output=True,
                        text=True,
                        timeout=240,
                        env=env,
                    )
                except subprocess.TimeoutExpired as exc:
                    failures.append(f"{command[0]} timed out after {exc.timeout}s")
                    continue
                if completed.returncode == 0 and temporary_binary.is_file():
                    break
                failures.append(
                    (completed.stderr or completed.stdout or f"compiler exited {completed.returncode}")[-2000:]
                )
            else:
                temporary_binary.unlink(missing_ok=True)
                raise RuntimeError("swiftc failed: " + " | ".join(failures)[-4000:])
            temporary_binary.chmod(0o755)
            temporary_digest.write_text(source_digest + "\n", encoding="utf-8")
            temporary_binary.replace(self.binary_path)
            temporary_digest.replace(self.digest_path)

    def _run_variant(self, content: bytes) -> list[OCRObservation]:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as handle:
            path = Path(handle.name)
            handle.write(content)
        try:
            process = subprocess.Popen(
                [str(self.binary_path), str(path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                start_new_session=True,
            )
            try:
                stdout, stderr = process.communicate(timeout=self._helper_timeout_seconds)
            except subprocess.TimeoutExpired as exc:
                # Vision framework calls can wedge below Python. Kill the whole
                # process group so a timed-out OCR helper cannot survive as an
                # orphan and poison every later KINGMAKER scan.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except OSError:
                    process.kill()
                try:
                    process.communicate(timeout=2)
                except Exception:
                    pass
                raise subprocess.TimeoutExpired(
                    process.args,
                    self._helper_timeout_seconds,
                ) from exc
            raw = stdout.strip()
            payload = json.loads(raw or "{}")
            if process.returncode != 0 or payload.get("ok") is not True:
                raise ValueError(str(payload.get("error") or stderr or "OCR failed"))
            observations: list[OCRObservation] = []
            for row in payload.get("observations") or []:
                box = row.get("box") or {}
                observations.append(
                    OCRObservation(
                        text=str(row.get("text") or "").strip(),
                        confidence=max(0.0, min(float(row.get("confidence") or 0), 1.0)),
                        box=OCRBox(
                            x=max(0.0, min(float(box.get("x") or 0), 1.0)),
                            y=max(0.0, min(float(box.get("y") or 0), 1.0)),
                            width=max(0.0, min(float(box.get("width") or 0), 1.0)),
                            height=max(0.0, min(float(box.get("height") or 0), 1.0)),
                        ),
                        side="unknown",
                        source="apple_vision",
                    )
                )
            return [value for value in observations if value.text]
        finally:
            path.unlink(missing_ok=True)

    @staticmethod
    def _serial_box_recovery_variants(
        content: bytes, observations: list[OCRObservation], *, expected_run: int
    ) -> list[tuple[str, bytes]]:
        from io import BytesIO

        with Image.open(BytesIO(content)) as opened:
            base = ImageOps.exif_transpose(opened).convert("RGB")
            width, height = base.size
            run_text = str(int(expected_run))
            boxes: list[OCRBox] = []
            for observation in observations:
                digits = re.sub(r"\D", "", str(observation.text or ""))
                if run_text not in digits:
                    continue
                box = observation.box
                if box.width <= 0 or box.height <= 0:
                    continue
                if not any(
                    abs(box.x-old.x) < 0.01 and abs(box.y-old.y) < 0.01
                    and abs(box.width-old.width) < 0.01 and abs(box.height-old.height) < 0.01
                    for old in boxes
                ):
                    boxes.append(box)

            outputs: list[tuple[str, bytes]] = []
            for index, box in enumerate(boxes[:4]):
                # Two very small padding changes materially alter how Vision
                # segments tiny foil numerators. Both variants contain only the
                # physical stamp neighborhood; neither uses remembered digits.
                for variant, (xpad, ypad) in enumerate(((0.22, 0.65), (0.33, 0.58), (0.36, 0.66))):
                    left = max(0.0, box.x - xpad * box.width)
                    right = min(1.0, box.x + box.width + 0.30 * box.width)
                    top = max(0.0, 1.0 - (box.y + box.height) - ypad * box.height)
                    bottom = min(1.0, 1.0 - box.y + ypad * box.height)
                    crop = base.crop((
                        int(width * left), int(height * top),
                        max(int(width * right), int(width * left) + 1),
                        max(int(height * bottom), int(height * top) + 1),
                    ))
                    crop = crop.resize((crop.width * 10, crop.height * 10), Image.Resampling.LANCZOS)
                    crop = ImageEnhance.Contrast(crop).enhance(1.50)
                    crop = crop.filter(ImageFilter.UnsharpMask(radius=0.8, percent=200, threshold=0))
                    canvas = Image.new("RGB", (crop.width + 400, crop.height + 240), "white")
                    canvas.paste(crop, (200, 120))
                    buffer = BytesIO(); canvas.save(buffer, format="PNG")
                    outputs.append((f"serial_box_{index}_{variant}", buffer.getvalue()))

            if outputs:
                return outputs

            # If the first OCR pass saw no denominator at all, use four color
            # bands as a bounded fallback. These remain physical-image OCR only.
            for index, (top, bottom) in enumerate(((0.00,0.30),(0.23,0.53),(0.47,0.77),(0.70,1.00))):
                crop = base.crop((0, int(height*top), width, max(int(height*bottom), int(height*top)+1)))
                scale = min(6, max(2, int(2200 / max(1, crop.width))))
                crop = crop.resize((crop.width*scale, crop.height*scale), Image.Resampling.LANCZOS)
                crop = ImageEnhance.Contrast(crop).enhance(1.35)
                crop = crop.filter(ImageFilter.UnsharpMask(radius=0.8, percent=180, threshold=0))
                buffer = BytesIO(); crop.save(buffer, format="PNG")
                outputs.append((f"serial_color_band_{index}", buffer.getvalue()))
            return outputs

    @staticmethod
    def _serial_micro_variants(content: bytes) -> list[tuple[str, bytes]]:
        """Inspect all common serial zones with one native Vision request.

        The old implementation launched one Apple Vision subprocess for every
        crop. That made an ordinary unnumbered card pay for up to eight extra
        native OCR processes across front/back.

        Preserve all four physical witnesses, but place them on one white 2x2
        OCR montage. Serial parsing consumes the recognized glyphs rather than
        original-card crop coordinates, so no identity evidence is lost.
        """
        from io import BytesIO
        import cv2
        import numpy as np

        with Image.open(BytesIO(content)) as opened:
            base = ImageOps.exif_transpose(opened).convert("RGB")
            width, height = base.size

            specs = (
                ("center_stamp", (0.40, 0.73, 0.62, 0.85)),
                ("center_stamp_tight", (0.42, 0.74, 0.60, 0.84)),
                ("bottom_left_stamp", (0.02, 0.78, 0.40, 0.98)),
                ("bottom_right_stamp", (0.60, 0.78, 0.98, 0.98)),
            )

            panels = []

            for _name, (x1, y1, x2, y2) in specs:
                crop = base.crop((
                    int(width * x1),
                    int(height * y1),
                    max(int(width * x2), int(width * x1) + 1),
                    max(int(height * y2), int(height * y1) + 1),
                ))

                gray = cv2.cvtColor(
                    np.asarray(crop),
                    cv2.COLOR_RGB2GRAY,
                )

                clahe = cv2.createCLAHE(
                    clipLimit=2.0,
                    tileGridSize=(6, 6),
                ).apply(gray)

                enlarged = cv2.resize(
                    clahe,
                    None,
                    fx=10.0,
                    fy=10.0,
                    interpolation=cv2.INTER_CUBIC,
                )

                blur = cv2.GaussianBlur(
                    enlarged,
                    (0, 0),
                    1.0,
                )

                sharpened = cv2.addWeighted(
                    enlarged,
                    1.8,
                    blur,
                    -0.8,
                    0,
                )

                panel = np.full(
                    (
                        sharpened.shape[0] + 160,
                        sharpened.shape[1] + 240,
                    ),
                    255,
                    np.uint8,
                )

                panel[
                    80:80 + sharpened.shape[0],
                    120:120 + sharpened.shape[1],
                ] = sharpened

                panels.append(panel)

            if not panels:
                return []

            cell_h = max(panel.shape[0] for panel in panels)
            cell_w = max(panel.shape[1] for panel in panels)

            gap = 100

            montage = np.full(
                (
                    cell_h * 2 + gap * 3,
                    cell_w * 2 + gap * 3,
                ),
                255,
                np.uint8,
            )

            for index, panel in enumerate(panels):
                row = index // 2
                col = index % 2

                y = gap + row * (cell_h + gap)
                x = gap + col * (cell_w + gap)

                montage[
                    y:y + panel.shape[0],
                    x:x + panel.shape[1],
                ] = panel

            ok, encoded = cv2.imencode(".png", montage)

            if not ok:
                return []

            return [
                (
                    "serial_micro_montage",
                    encoded.tobytes(),
                )
            ]

    @staticmethod
    def _serial_forensic_variants(content: bytes) -> list[tuple[str, bytes]]:
        from io import BytesIO
        with Image.open(BytesIO(content)) as opened:
            base = ImageOps.exif_transpose(opened).convert("RGB")
            width, height = base.size
            specs = (
                ("bottom_center", (0.30, 0.67, 0.83, 0.97), 0, None),
                ("bottom_center_tight", (0.385, 0.765, 0.695, 0.915), 0, 13),
                ("bottom_left", (0.00, 0.73, 0.55, 1.00), 0, None),
                ("bottom_left_tight", (0.00, 0.80, 0.55, 1.00), 0, 5),
                ("right_mid_90", (0.70, 0.06, 1.00, 0.58), 90, None),
                ("right_mid_270", (0.70, 0.06, 1.00, 0.58), 270, None),
                ("left_mid_270", (0.00, 0.05, 0.40, 0.64), 270, None),
                ("left_mid_tight_270", (0.00, 0.14, 0.43, 0.56), 270, 5),
            )
            outputs: list[tuple[str, bytes]] = []
            for name, (x1,y1,x2,y2), rotation, scale_override in specs:
                crop = base.crop((int(width*x1), int(height*y1), max(int(width*x2), int(width*x1)+1), max(int(height*y2), int(height*y1)+1)))
                if rotation:
                    crop = crop.rotate(-rotation, expand=True)
                scale = int(scale_override) if scale_override else min(8, max(3, int(2200 / max(1, crop.width))))
                crop = crop.resize((crop.width*scale, crop.height*scale), Image.Resampling.LANCZOS)
                treatments = [("color", ImageEnhance.Contrast(crop).enhance(1.35))]
                gray = ImageOps.grayscale(crop)
                treatments.append(("invert", ImageOps.invert(ImageOps.autocontrast(gray)).convert("RGB")))
                lab_a = crop.convert("LAB").split()[1]
                treatments.append(("lab_a", ImageOps.autocontrast(lab_a).convert("RGB")))
                for treatment, image in treatments:
                    image = image.filter(ImageFilter.UnsharpMask(radius=0.8, percent=180, threshold=0))
                    canvas = Image.new("RGB", (image.width+240, image.height+160), "white")
                    canvas.paste(image, (120,80))
                    buffer = BytesIO(); canvas.save(buffer, format="PNG")
                    outputs.append((f"serial_forensic_{name}_{treatment}", buffer.getvalue()))

            # Two raw stamp neighborhoods preserve glyph shapes that broad
            # autocontrast/canvas processing can distort. These are generic
            # physical locations used by bottom-center and logo-obscured stamps.
            raw_specs = (
                ("bottom_center_stamp_raw_invert", (0.385,0.765,0.695,0.915), 13, "invert"),
                ("bottom_left_serial_stamp_raw_color", (0.00,0.888,0.28,1.00), 5, "color"),
                ("bottom_left_stamp_raw_color", (0.00,0.82,0.53,1.00), 5, "color"),
            )
            for name, (x1,y1,x2,y2), scale, treatment in raw_specs:
                crop = base.crop((int(width*x1), int(height*y1), max(int(width*x2),int(width*x1)+1), max(int(height*y2),int(height*y1)+1)))
                crop = crop.resize((crop.width*scale, crop.height*scale), Image.Resampling.LANCZOS)
                if treatment == "invert":
                    crop = ImageOps.invert(ImageOps.grayscale(crop)).convert("RGB")
                crop = crop.filter(ImageFilter.UnsharpMask(radius=0.6, percent=160, threshold=0))
                buffer = BytesIO(); crop.save(buffer, format="PNG")
                outputs.append((f"serial_forensic_{name}", buffer.getvalue()))
            return outputs

    @staticmethod
    def _serial_band_variants(content: bytes) -> list[tuple[str, bytes]]:
        from io import BytesIO

        with Image.open(BytesIO(content)) as opened:
            base = ImageOps.exif_transpose(opened).convert("RGB")
            width, height = base.size
            outputs: list[tuple[str, bytes]] = []
            # Four overlapping bands cover the whole card while enlarging tiny
            # stamped numerators/denominators by roughly 3x. A neutral grayscale
            # treatment reduces foil/color interference without destroying glyphs.
            bands = (
                ("serial_band_top", 0.00, 0.32),
                ("serial_band_upper_mid", 0.20, 0.55),
                ("serial_band_lower_mid", 0.45, 0.80),
                ("serial_band_bottom", 0.68, 1.00),
            )
            for name, top, bottom in bands:
                crop = base.crop((0, int(height * top), width, max(int(height * bottom), int(height * top) + 1)))
                scale = min(4, max(2, int(2200 / max(1, crop.width))))
                crop = crop.resize(
                    (min(2600, crop.width * scale), min(1800, crop.height * scale)),
                    Image.Resampling.LANCZOS,
                )
                gray = ImageOps.grayscale(crop)
                gray = ImageOps.autocontrast(gray, cutoff=0.5)
                gray = ImageEnhance.Contrast(gray).enhance(1.45)
                gray = gray.filter(ImageFilter.UnsharpMask(radius=1.0, percent=210, threshold=1))
                buffer = BytesIO()
                gray.convert("RGB").save(
                    buffer,
                    format="JPEG",
                    quality=96,
                    optimize=True,
                    progressive=False,
                    subsampling=0,
                )
                outputs.append((name, buffer.getvalue()))
            return outputs

    @staticmethod
    def _back_header_variant(content: bytes) -> bytes:
        """Enlarge the printed top header where player names normally live."""
        from io import BytesIO

        with Image.open(BytesIO(content)) as opened:
            base = ImageOps.exif_transpose(opened).convert("RGB")
            width, height = base.size
            crop = base.crop((0, 0, width, max(1, int(height * 0.28))))
            scale = min(4, max(2, int(2400 / max(1, crop.width))))
            crop = crop.resize(
                (min(2800, crop.width * scale), min(1600, crop.height * scale)),
                Image.Resampling.LANCZOS,
            )
            crop = ImageEnhance.Contrast(crop).enhance(1.35)
            crop = crop.filter(ImageFilter.UnsharpMask(radius=1.0, percent=170, threshold=1))
            output = BytesIO()
            crop.save(output, format="JPEG", quality=95, optimize=True, progressive=False, subsampling=0)
            return output.getvalue()

    @staticmethod
    def _number_corner_left_variant(content: bytes) -> bytes:
        """High-contrast top-left number strip for small foil card numbers.

        Topps Flagship Football prints the card number in a tiny metallic header.
        Fast Vision misses it in the full image, but a 10x Otsu strip preserves
        the glyphs without invoking the unbounded .accurate recognizer.
        """
        from io import BytesIO
        import cv2
        import numpy as np

        with Image.open(BytesIO(content)) as opened:
            base = ImageOps.exif_transpose(opened).convert("RGB")
            width, height = base.size
            crop = base.crop((0, 0, max(1, int(width * 0.50)), max(1, int(height * 0.14))))
            rgb = np.asarray(crop)
            enlarged = cv2.resize(
                rgb,
                None,
                fx=10.0,
                fy=10.0,
                interpolation=cv2.INTER_CUBIC,
            )
            gray = cv2.cvtColor(enlarged, cv2.COLOR_RGB2GRAY)
            _, thresholded = cv2.threshold(
                gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
            )
            output = BytesIO()
            Image.fromarray(thresholded).convert("RGB").save(
                output,
                format="JPEG",
                quality=98,
                optimize=True,
                progressive=False,
                subsampling=0,
            )
            return output.getvalue()

    @staticmethod
    def _number_corner_variant(content: bytes) -> bytes:
        from io import BytesIO

        with Image.open(BytesIO(content)) as opened:
            base = ImageOps.exif_transpose(opened).convert("RGB")
            width, height = base.size
            crop = base.crop((int(width * 0.72), 0, width, int(height * 0.34)))
            crop = crop.resize(
                (min(2400, crop.width * 4), min(1800, crop.height * 4)),
                Image.Resampling.LANCZOS,
            )
            crop = ImageEnhance.Contrast(crop).enhance(1.5)
            crop = crop.filter(ImageFilter.UnsharpMask(radius=1.2, percent=180, threshold=2))
            output = BytesIO()
            crop.save(output, format="JPEG", quality=95, optimize=True, progressive=False, subsampling=0)
            return output.getvalue()

    @staticmethod
    def _orientation_variants(content: bytes) -> list[tuple[str, bytes]]:
        """Minimal full-card OCR witnesses used only for rotation scoring.

        Orientation must never pay for serial bands, title crops, or number-corner
        OCR. Those forensic witnesses run later in the identity/serial pass.
        """
        from io import BytesIO

        with Image.open(BytesIO(content)) as opened:
            base = ImageOps.exif_transpose(opened).convert("RGB")
            base.thumbnail((1400, 1400), Image.Resampling.LANCZOS)
            grayscale = ImageOps.grayscale(base)
            contrast = ImageEnhance.Contrast(grayscale).enhance(1.55).convert("RGB")
            outputs: list[tuple[str, bytes]] = []
            for name, image in (("orientation_original", base), ("orientation_contrast", contrast)):
                buffer = BytesIO()
                image.save(buffer, format="JPEG", quality=88, optimize=True, progressive=False, subsampling=0)
                outputs.append((name, buffer.getvalue()))
            return outputs

    @staticmethod
    def _variants(content: bytes) -> list[tuple[str, bytes]]:
        from io import BytesIO

        with Image.open(BytesIO(content)) as opened:
            base = ImageOps.exif_transpose(opened).convert("RGB")
            base.thumbnail((1800, 1800), Image.Resampling.LANCZOS)

            variants: list[tuple[str, Image.Image]] = [("original", base)]
            grayscale = ImageOps.grayscale(base)
            contrast = ImageEnhance.Contrast(grayscale).enhance(1.8)
            sharpened = contrast.filter(ImageFilter.UnsharpMask(radius=1.5, percent=190, threshold=2))
            variants.append(("contrast", sharpened.convert("RGB")))

            # Front insert titles are often stylized/foil text that full-card OCR
            # misses. Add enlarged horizontal bands as independent OCR witnesses.
            # Coordinates remain local to the crop, so these are text witnesses
            # only; they are never used for layout/orientation geometry.
            width, height = base.size
            for name, top, bottom in (("title_upper", 0.0, 0.42), ("title_middle", 0.22, 0.72)):
                crop = base.crop((0, int(height * top), width, int(height * bottom)))
                crop = crop.resize((min(2400, crop.width * 2), min(1800, crop.height * 2)), Image.Resampling.LANCZOS)
                crop = ImageEnhance.Contrast(crop).enhance(1.35)
                crop = crop.filter(ImageFilter.UnsharpMask(radius=1.2, percent=170, threshold=2))
                variants.append((name, crop))

            outputs: list[tuple[str, bytes]] = []
            for name, image in variants:
                buffer = BytesIO()
                image.save(
                    buffer,
                    format="JPEG",
                    quality=92,
                    optimize=True,
                    progressive=False,
                    subsampling=0,
                )
                outputs.append((name, buffer.getvalue()))
            return outputs

    @staticmethod
    def _is_duplicate(candidate: OCRObservation, existing: list[OCRObservation]) -> bool:
        normalized = " ".join(candidate.text.lower().split())
        for current in existing:
            if " ".join(current.text.lower().split()) != normalized:
                continue
            overlap_x = max(
                0.0,
                min(candidate.box.x + candidate.box.width, current.box.x + current.box.width)
                - max(candidate.box.x, current.box.x),
            )
            overlap_y = max(
                0.0,
                min(candidate.box.y + candidate.box.height, current.box.y + current.box.height)
                - max(candidate.box.y, current.box.y),
            )
            intersection = overlap_x * overlap_y
            smaller = min(
                candidate.box.width * candidate.box.height,
                current.box.width * current.box.height,
            )
            if smaller > 0 and intersection / smaller >= 0.55:
                if candidate.confidence > current.confidence:
                    existing.remove(current)
                    return False
                return True
        return False
