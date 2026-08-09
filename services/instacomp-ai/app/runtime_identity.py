from __future__ import annotations

from hashlib import sha256
from pathlib import Path

from .config import settings

RUNTIME_IDENTITY_FILES = (
    "app/__init__.py",
    "app/main.py",
    "app/local_vision.py",
    "app/ollama.py",
    "app/lora_candidate_runtime.py",
    "scripts/run_lora_candidate_server.py",
)


def runtime_source_fingerprint(service_root: Path | None = None) -> str:
    root = (service_root or settings.service_root).resolve()
    digest = sha256()
    for relative in RUNTIME_IDENTITY_FILES:
        path = (root / relative).resolve()
        if root not in path.parents:
            raise RuntimeError("Runtime fingerprint path escaped the service root")
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()
