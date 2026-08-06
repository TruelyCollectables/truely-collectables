from pathlib import Path


def analyze_source() -> str:
    source = Path("services/instacomp-ai/app/main.py").read_text()
    lesson_marker = '\n@app.post(\n    "/v1/lessons"'
    return source.split("async def analyze_scan", 1)[1].split(
        lesson_marker, 1
    )[0]


def test_analyze_scan_has_no_ollama_identity_call():
    analyze = analyze_source()
    assert "await reader.analyze(" not in analyze
    assert "CHECKLIST-ONLY REVIEW PATH" in analyze
    assert 'status = "needs_review"' in analyze


def test_unresolved_scan_still_builds_and_saves_response():
    analyze = analyze_source()
    assert "result = AnalyzeResponse(" in analyze
    assert "_save_scan(" in analyze
    assert "return result" in analyze


def test_health_marks_ollama_unchecked():
    source = Path("services/instacomp-ai/app/main.py").read_text()
    assert 'ollama="unchecked"' in source
    assert 'ollama_model="disabled_for_identity_scans"' in source
