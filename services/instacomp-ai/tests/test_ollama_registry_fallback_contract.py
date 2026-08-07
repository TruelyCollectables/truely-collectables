from pathlib import Path


def test_unknown_cards_use_local_visual_evidence_before_registry_lock():
    source = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text()

    memory_index = source.index("store.find_trusted_image_match")
    printed_index = source.index("identity_from_printed_evidence")
    ollama_index = source.index("suggestion = await reader.analyze")
    registry_index = source.index(
        "suggestion_registry = await checklist_gateway.match",
        ollama_index,
    )
    pricing_index = source.index("pricing_allowed = True", registry_index)

    assert memory_index < ollama_index
    assert printed_index < ollama_index
    assert ollama_index < registry_index < pricing_index
    assert 'match_source = "ollama_backup"' in source
    assert 'receipt.startswith("registry_fingerprint:")' in source
    assert 'status = "model_unavailable"' in source


def test_health_requires_the_local_visual_reader():
    source = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text()

    assert "ollama_ready = await reader.health()" in source
    assert "ok=database_ready and checklist_ready and ollama_ready" in source
    assert 'ollama="ready" if ollama_ready else "unavailable"' in source
    assert "ollama_model=settings.ollama_model" in source
