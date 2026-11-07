from __future__ import annotations

import gc
from pathlib import Path

import pytest

from app.deal_hunter_learning import initialize_decision_learning
from app.teacher_comp_learning import initialize_teacher_comp_learning


def _open_fd_count() -> int:
    for candidate in (Path("/proc/self/fd"), Path("/dev/fd")):
        if candidate.exists():
            return len(list(candidate.iterdir()))
    pytest.skip("Open file-descriptor inspection is unavailable on this platform")


@pytest.mark.parametrize(
    "initializer,filename",
    [
        (initialize_teacher_comp_learning, "teacher.sqlite3"),
        (initialize_decision_learning, "deal-hunter.sqlite3"),
    ],
)
def test_sqlite_initializers_close_connections_without_waiting_for_gc(
    tmp_path: Path, initializer, filename: str
):
    database = tmp_path / filename
    was_enabled = gc.isenabled()
    gc.disable()
    try:
        before = _open_fd_count()
        for _ in range(128):
            initializer(database)
        after = _open_fd_count()
    finally:
        if was_enabled:
            gc.enable()
        gc.collect()

    assert after - before <= 4
