from __future__ import annotations

from hashlib import sha256

from app.runtime_identity import RUNTIME_IDENTITY_FILES, runtime_source_fingerprint


def test_runtime_source_fingerprint_tracks_exact_identity_files(tmp_path):
    app_dir = tmp_path / "app"
    app_dir.mkdir()
    (app_dir / "local_vision.py").write_text("local-v1\n", encoding="utf-8")
    (app_dir / "ollama.py").write_text("ollama-v1\n", encoding="utf-8")

    digest = sha256()
    for relative in RUNTIME_IDENTITY_FILES:
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update((tmp_path / relative).read_bytes())
        digest.update(b"\0")

    first = runtime_source_fingerprint(tmp_path)
    assert first == digest.hexdigest()

    (app_dir / "ollama.py").write_text("ollama-v2\n", encoding="utf-8")
    second = runtime_source_fingerprint(tmp_path)
    assert second != first
