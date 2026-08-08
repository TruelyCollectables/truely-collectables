from pathlib import Path


def test_unknown_cards_use_local_visual_evidence_before_registry_lock():
    source = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text()

    memory_index = source.index("store.find_trusted_image_match")
    printed_index = source.index("identity_from_printed_evidence")
    local_vision_index = source.index("local_vision = await analyze_local_vision")
    registry_index = source.index("printed_registry = (")

    assert memory_index < local_vision_index
    assert printed_index < local_vision_index
    assert local_vision_index < registry_index
    assert "await reader.analyze(" not in source
    assert 'match_source = "ollama_backup"' not in source
    assert "trusted_text_registry_verified" in source
    assert "trusted_text_registry.identity_id" in source
    assert 'receipt.startswith("registry_fingerprint:")' in source
    assert 'status = "needs_review"' in source


def test_health_does_not_require_external_visual_reader():
    source = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text()

    assert "ollama_ready = await reader.health()" not in source
    assert "ok=database_ready and checklist_ready" in source
    assert 'ollama="unchecked"' in source
    assert 'ollama_model="disabled_for_identity_scans"' in source
