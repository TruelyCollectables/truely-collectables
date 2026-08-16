from pathlib import Path


def main_source() -> str:
    root = Path(__file__).resolve().parents[1]
    return (root / "app" / "main.py").read_text(encoding="utf-8")


def analyze_source() -> str:
    source = main_source()
    lesson_marker = '\n@app.post(\n    "/v1/lessons"'
    return source.split("async def analyze_scan", 1)[1].split(
        lesson_marker, 1
    )[0]


def test_unknown_scan_keeps_ollama_out_of_default_live_identity_path():
    analyze = analyze_source()
    guard = "if settings.ollama_runtime_reader_enabled:"
    reader_call = "suggestion = await reader.analyze("
    assert guard in analyze
    assert reader_call in analyze
    assert analyze.index(guard) < analyze.index(reader_call)
    assert 'status = "needs_review"' in analyze
    assert "hard training example" in analyze
    assert "do not hand the live identity decision to a teacher model" in analyze
    # The legacy engineering comparison path may still lock only through Registry.
    assert "suggestion_registry = await checklist_gateway.match(" in analyze
    assert 'match_source = "ollama_backup"' in analyze
    assert 'receipt.startswith("registry_fingerprint:")' in analyze


def test_unresolved_scan_still_builds_saves_and_blocks_response():
    analyze = analyze_source()
    assert "result = AnalyzeResponse(" in analyze
    assert "_save_scan(" in analyze
    assert "return result" in analyze
    assert 'status = "needs_review"' in analyze
    assert 'status = "model_unavailable"' in analyze
    assert "pricing_allowed = False" in analyze


def test_health_reports_teacher_status_without_requiring_teacher_runtime():
    source = main_source()
    assert "ollama_ready = await reader.health()" in source
    assert (
        "runtime_ollama_ready = ollama_ready if settings.ollama_runtime_reader_enabled else True"
        in source
    )
    assert "ok=database_ready and checklist_ready and runtime_ollama_ready" in source
    assert 'ollama="ready" if ollama_ready else "unavailable"' in source
    assert "ollama_model=settings.ollama_model" in source
