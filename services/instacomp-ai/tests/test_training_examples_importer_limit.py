from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.storage import MemoryStore
from app.training_routes import build_training_router


def test_training_examples_accepts_supervised_importer_limit_5000(tmp_path):
    store = MemoryStore(tmp_path / "memory.sqlite3")
    store.initialize()

    app = FastAPI()

    def require_api_key() -> None:
        return None

    app.include_router(
        build_training_router(
            require_api_key,
            store,
            image_store_path=tmp_path / "images",
            training_export_path=tmp_path / "training",
        )
    )
    client = TestClient(app)

    response = client.get("/v1/training/examples?trusted_only=true&limit=5000")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["schema_version"] == "tcos.instacomp-ai.training-examples.v1"
    assert payload["count"] == 0
    assert payload["examples"] == []
