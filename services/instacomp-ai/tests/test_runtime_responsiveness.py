from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path

from app.sentinel import ChecklistSentinel


def test_registry_import_runs_off_event_loop(tmp_path, monkeypatch):
    sentinel = ChecklistSentinel(
        database_path=tmp_path / "sentinel.sqlite3",
        service_root=tmp_path,
    )
    source = tmp_path / "checklist.csv"
    source.write_text("card_number,player\n1,Test Player\n")
    caller_thread = threading.get_ident()
    worker_threads: list[int] = []

    def fake_import_sync(**_kwargs):
        worker_threads.append(threading.get_ident())
        time.sleep(0.15)
        return "imported_registry", "release:test:1"

    monkeypatch.setattr(sentinel, "_import_to_registry_sync", fake_import_sync)

    async def scenario():
        import_task = asyncio.create_task(
            sentinel._import_to_registry(
                target={"target_key": "test|1", "scope": "inventory-gap"},
                source_url="https://example.com/checklist.csv",
                local_path=source,
                content_type="text/csv",
                sha256="a" * 64,
            )
        )
        tick_started = time.monotonic()
        await asyncio.sleep(0.02)
        tick_elapsed = time.monotonic() - tick_started
        assert not import_task.done()
        result = await import_task
        return tick_elapsed, result

    tick_elapsed, result = asyncio.run(scenario())
    assert tick_elapsed < 0.10
    assert result == ("imported_registry", "release:test:1")
    assert worker_threads
    assert worker_threads[0] != caller_thread


def test_health_skips_optional_ollama(monkeypatch):
    import app.main as main

    class Checklist:
        async def health(self):
            return True

    class OptionalReader:
        calls = 0

        async def health(self):
            self.calls += 1
            raise AssertionError("optional Ollama health must not be called")

    reader = OptionalReader()
    monkeypatch.setattr(main, "_database_health_ping", lambda: True)
    monkeypatch.setattr(main, "checklist_gateway", Checklist())
    monkeypatch.setattr(main, "reader", reader)
    monkeypatch.setattr(main.settings, "ollama_runtime_reader_enabled", False)

    result = asyncio.run(main.health())
    assert result.ok is True
    assert result.database == "ready"
    assert result.checklist == "ready"
    assert result.ollama == "unavailable"
    assert reader.calls == 0


def test_health_live_is_dependency_free():
    import app.main as main

    result = asyncio.run(main.health_live())
    assert result["ok"] is True
    assert result["process"] == "alive"
