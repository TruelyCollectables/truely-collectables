import base64
from pathlib import Path

from app.sentinel_routes import (
    _archive_token_valid,
    _pending_backlog_ready,
    build_sentinel_router,
)


def test_registry_relay_archive_token_is_required_and_exact(monkeypatch):
    monkeypatch.setenv(
        "INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN",
        "correct-archive-token",
    )
    assert _archive_token_valid("correct-archive-token") is True
    assert _archive_token_valid("wrong-archive-token") is False
    assert _archive_token_valid("") is False
    assert _archive_token_valid(None) is False


def test_registry_relay_accepts_basic_auth_from_local_import_url(monkeypatch):
    monkeypatch.setenv(
        "INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN",
        "correct-archive-token",
    )
    encoded = base64.b64encode(b"sentinel:correct-archive-token").decode("ascii")
    assert _archive_token_valid(None, f"Basic {encoded}") is True
    wrong = base64.b64encode(b"sentinel:wrong-token").decode("ascii")
    assert _archive_token_valid(None, f"Basic {wrong}") is False
    wrong_user = base64.b64encode(b"other:correct-archive-token").decode("ascii")
    assert _archive_token_valid(None, f"Basic {wrong_user}") is False


def test_pending_backlog_drain_only_runs_when_safe_and_needed():
    completed = {
        "targets": {"pending": 378, "total": 453},
        "latest_job": {"status": "completed"},
    }
    running = {
        "targets": {"pending": 378, "total": 453},
        "latest_job": {"status": "running"},
    }
    empty = {
        "targets": {"pending": 0, "total": 453},
        "latest_job": {"status": "completed"},
    }

    assert _pending_backlog_ready(completed, has_due_targets=True) is True
    assert _pending_backlog_ready(running, has_due_targets=True) is False
    assert _pending_backlog_ready(empty, has_due_targets=True) is False
    assert _pending_backlog_ready(completed, has_due_targets=False) is False


def test_router_contains_protected_controls_and_separate_relay(tmp_path: Path):
    router = build_sentinel_router(
        lambda: None,
        tmp_path / "sentinel.sqlite3",
        tmp_path,
    )
    paths = {route.path for route in router.routes}
    assert "/v1/checklist-sentinel/status" in paths
    assert "/v1/checklist-sentinel/run" in paths
    assert "/v1/checklist-sentinel/refresh-targets" in paths
    assert "/v1/checklist-sentinel/targets" in paths
    assert "/v1/checklist-sentinel/findings" in paths
    assert "/v1/checklist-sentinel/downloads" in paths
    assert "/v1/checklist-sentinel/sources" in paths
    assert "/v1/checklist-sentinel/registry-import-relay" in paths
