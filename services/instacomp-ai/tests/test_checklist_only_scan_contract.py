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


def test_unknown_scan_uses_ollama_for_evidence_not_authority():
    analyze = analyze_source()
    assert "suggestion = await reader.analyze(" in analyze
    assert "suggestion_registry = await checklist_gateway.match(" in analyze
    assert analyze.index("suggestion = await reader.analyze(") < analyze.index(
        "suggestion_registry = await checklist_gateway.match("
    )
    assert 'match_source = "ollama_backup"' in analyze
    assert 'receipt.startswith("registry_fingerprint:")' in analyze
    assert "pricing_allowed = True" in analyze


def test_unresolved_scan_still_builds_saves_and_blocks_response():
    analyze = analyze_source()
    assert "result = AnalyzeResponse(" in analyze
    assert "_save_scan(" in analyze
    assert "return result" in analyze
    assert 'status = "needs_review"' in analyze
    assert 'status = "model_unavailable"' in analyze
    assert "pricing_allowed = False" in analyze


def test_health_reports_required_local_reader():
    source = main_source()
    assert "ollama_ready = await reader.health()" in source
    assert "ok=database_ready and checklist_ready and ollama_ready" in source
    assert 'ollama="ready" if ollama_ready else "unavailable"' in source
    assert "ollama_model=settings.ollama_model" in source
