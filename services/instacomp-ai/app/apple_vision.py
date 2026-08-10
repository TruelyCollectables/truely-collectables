from __future__ import annotations

import hashlib
import json
import os
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
