from pathlib import Path


def test_unknown_cards_use_local_evidence_and_registry_before_optional_engineering_reader():
    source = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text()

    analyze = source[source.index("async def analyze_scan(") :]
    memory_index = analyze.index("store.find_trusted_image_match")
    printed_index = analyze.index("identity_from_printed_evidence")
    guard_index = analyze.index("if settings.ollama_runtime_reader_enabled:")
    ollama_index = analyze.index("suggestion = await reader.analyze", guard_index)
    registry_index = analyze.index(
        "suggestion_registry = await checklist_gateway.match",
        ollama_index,
    )
    pricing_index = analyze.index("pricing_allowed = True", registry_index)

    assert memory_index < guard_index
    assert printed_index < guard_index
    assert guard_index < ollama_index < registry_index < pricing_index
    assert 'status = "needs_review"' in source
    assert 'match_source = "ollama_backup"' in source
    assert 'receipt.startswith("registry_fingerprint:")' in source
    assert 'status = "model_unavailable"' in source


def test_health_observes_local_teacher_without_making_it_a_live_dependency():
    source = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text()

    assert "if settings.ollama_runtime_reader_enabled:" in source
    assert "ollama_ready = await asyncio.wait_for(reader.health(), timeout=2.0)" in source
    assert "teacher. Dedicated teacher/system-doctor endpoints own that telemetry." in source
    assert "ollama_ready = False" in source
    assert (
        "runtime_ollama_ready = ollama_ready if settings.ollama_runtime_reader_enabled else True"
        in source
    )
    assert "ok=database_ready and checklist_ready and runtime_ollama_ready" in source
    assert 'ollama="ready" if ollama_ready else "unavailable"' in source
    assert "ollama_model=settings.ollama_model" in source
