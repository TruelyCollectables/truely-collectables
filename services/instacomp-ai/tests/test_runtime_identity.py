from __future__ import annotations

from hashlib import sha256

from app.runtime_identity import RUNTIME_IDENTITY_FILES, runtime_source_fingerprint


def test_runtime_source_fingerprint_tracks_exact_identity_files(tmp_path):
    for index, relative in enumerate(RUNTIME_IDENTITY_FILES):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"runtime-{index}-v1\n", encoding="utf-8")

    digest = sha256()
    for relative in RUNTIME_IDENTITY_FILES:
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update((tmp_path / relative).read_bytes())
        digest.update(b"\0")

    first = runtime_source_fingerprint(tmp_path)
    assert first == digest.hexdigest()

    candidate_path = tmp_path / "app/lora_candidate_runtime.py"
    candidate_path.write_text("candidate-v2\n", encoding="utf-8")
    second = runtime_source_fingerprint(tmp_path)
    assert second != first

    sidecar_path = tmp_path / "scripts/run_lora_candidate_server.py"
    sidecar_path.write_text("sidecar-v2\n", encoding="utf-8")
    third = runtime_source_fingerprint(tmp_path)
    assert third != second
