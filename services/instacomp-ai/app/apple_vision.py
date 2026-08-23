from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from .models import OCRBox, OCRObservation

_BUILD_LOCK = threading.Lock()


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
        try:
            variants = self._variants(image_bytes)
        except Exception as exc:
            return [], [
                f"{side}:apple_vision_preprocess_failed:{type(exc).__name__.lower()}"
            ]

        observations: list[OCRObservation] = []
        errors: list[str] = []
        for variant_name, variant_bytes in variants:
            try:
                values = self._run_variant(variant_bytes)
            except Exception as exc:
                errors.append(
                    f"{side}:{variant_name}:apple_vision_failed:{type(exc).__name__.lower()}"
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
            score += max(0.0, observation.confidence) * min(24, len(compact))
            score += min(2.0, observation.box.width * 4.0)

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
                center_y = observation.box.y + observation.box.height / 2
                strong_top_anchor = re.search(
                    r"\b(?:rc|rookie|all-american|draft\s+picks?)\b",
                    normalized_text,
                )
                product_top_anchor = re.search(
                    r"\b(?:topps|bowman|panini|prizm|select|donruss|upper\s+deck)\b",
                    normalized_text,
                )
                if strong_top_anchor:
                    score += 24.0 * (center_y - 0.5)
                elif product_top_anchor:
                    score += 10.0 * (center_y - 0.5)

                words = re.findall(r"[a-z]+", normalized_text)
                likely_player_label = (
                    2 <= len(words) <= 4
                    and 5 <= len(normalized_text) <= 32
                    and observation.text.upper() == observation.text
                    and not strong_top_anchor
                    and not product_top_anchor
                    and observation.confidence >= 0.7
                    and observation.box.width >= 0.18
                )
                if likely_player_label:
                    score += 8.0 * (0.5 - center_y)
        return score

    def detect_upright_rotation(
        self,
        image_bytes: bytes,
        *,
        side: str,
    ) -> tuple[int, float, list[str]]:
        """Return the clockwise text correction selected from four OCR witnesses."""
        if not self.supported:
            return 0, 0.0, [f"{side}:apple_vision_unavailable"]

        candidates: list[tuple[int, float, list[OCRObservation]]] = []
        for rotation in (0, 90, 180, 270):
            rotated = self._clockwise_rotated_bytes(image_bytes, rotation)
            observations, _errors = self.recognize(rotated, side=side)
            candidates.append(
                (
                    rotation,
                    self._orientation_score(observations, side=side),
                    observations,
                )
            )

        candidates.sort(key=lambda candidate: (-candidate[1], candidate[0]))
        best_rotation, best_score, best_observations = candidates[0]
        second_score = candidates[1][1]
        if best_score <= 0:
            return 0, 0.0, [f"{side}:no_readable_text_for_orientation"]

        margin = max(0.0, (best_score - second_score) / max(1.0, best_score))
        confidence = max(0.0, min(0.99, 0.55 + margin))
        # Close OCR scores are ambiguous on art-heavy cards. Preserve the
        # submitted direction instead of applying a low-evidence correction.
        applied_rotation = best_rotation if best_rotation == 0 or margin >= 0.04 else 0
        evidence = [
            observation.text[:80]
            for observation in best_observations
            if observation.text.strip()
        ][:6]
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
            if not swiftc:
                raise RuntimeError(
                    "swiftc was not found. Install the Apple command-line developer tools."
                )

            temporary_binary = self.binary_path.with_name(
                self.binary_path.name + ".partial"
            )
            temporary_digest = self.digest_path.with_name(
                self.digest_path.name + ".partial"
            )
            temporary_binary.unlink(missing_ok=True)
            temporary_digest.unlink(missing_ok=True)
            command = [
                swiftc,
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
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if completed.returncode != 0 or not temporary_binary.is_file():
                temporary_binary.unlink(missing_ok=True)
                raise RuntimeError(
                    "swiftc failed: "
                    + (
                        completed.stderr
                        or completed.stdout
                        or f"compiler exited {completed.returncode} without an output binary"
                    )[-4000:]
                )
            temporary_binary.chmod(0o755)
            temporary_digest.write_text(source_digest + "\n", encoding="utf-8")
            temporary_binary.replace(self.binary_path)
            temporary_digest.replace(self.digest_path)

    def _run_variant(self, content: bytes) -> list[OCRObservation]:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as handle:
            path = Path(handle.name)
            handle.write(content)
        try:
            completed = subprocess.run(
                [str(self.binary_path), str(path)],
                check=False,
                capture_output=True,
                text=True,
                timeout=45,
            )
            raw = completed.stdout.strip()
            payload = json.loads(raw or "{}")
            if completed.returncode != 0 or payload.get("ok") is not True:
                raise ValueError(str(payload.get("error") or completed.stderr or "OCR failed"))
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
