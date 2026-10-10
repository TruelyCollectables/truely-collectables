from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SERVICE = Path(__file__).resolve().parents[1]


def test_fastapi_ebay_bridge_requires_explicit_live_confirmation() -> None:
    source = (SERVICE / "app/kingmaker_accounting_routes.py").read_text()
    assert '"publish": "PUBLISH_LIVE"' in source
    assert '"revise": "REVISE_LIVE"' in source
    assert '"end": "END_LIVE"' in source
    assert "request.confirmation != required_confirmation" in source
    assert 'edit.get("confirmation")' in source
    assert '"confirmation": "REVISE_LIVE"' in source


def test_node_runner_rechecks_live_mutation_confirmation() -> None:
    source = (SERVICE / "scripts/kingmaker_ebay_publish.ts").read_text()
    assert 'payload.confirmation !== "PUBLISH_LIVE"' in source
    assert 'payload.confirmation !== "REVISE_LIVE"' in source
    assert 'payload.confirmation !== "END_LIVE"' in source
    assert "Explicit PUBLISH_LIVE confirmation" in source
    assert "Explicit REVISE_LIVE confirmation" in source
    assert "Explicit END_LIVE confirmation" in source
