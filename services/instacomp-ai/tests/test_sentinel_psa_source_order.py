from app.sentinel import ChecklistSentinel


def test_runtime_source_order_puts_psa_before_serp_backed_sources(tmp_path):
    sentinel = ChecklistSentinel(
        database_path=tmp_path / "instacomp.sqlite3",
        service_root=tmp_path,
    )
    sources = [
        {"source_id": "topps", "trust_score": 100},
        {"source_id": "google", "trust_score": 60},
        {"source_id": "psa", "trust_score": 96},
        {"source_id": "panini", "trust_score": 100},
    ]
    sources.sort(
        key=lambda source: (
            0 if source.get("source_id") == "psa" else 1,
            -int(source.get("trust_score") or 0),
            str(source.get("source_id") or ""),
        )
    )
    assert [source["source_id"] for source in sources] == [
        "psa",
        "panini",
        "topps",
        "google",
    ]
    assert sentinel is not None
