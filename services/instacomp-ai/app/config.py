from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="INSTACOMP_AI_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "InstaComp AI™"
    codename: str = "InstaComp AI 1.0 Beta"
    version: str = "1.0.0-beta.prechecklist"
    host: str = "127.0.0.1"
    port: int = 8787
    database_path: Path = Path("./data/instacomp_ai.sqlite3")
    image_store_path: Path = Path("./data/images")
    max_image_bytes: int = 12 * 1024 * 1024
    max_total_image_bytes: int = 24 * 1024 * 1024
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5vl:7b"
    ollama_timeout_seconds: float = 120.0
    allow_teacher_suggestions: bool = True
    require_operator_for_trusted_memory: bool = True
    api_key: str | None = None

    def ensure_directories(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.image_store_path.mkdir(parents=True, exist_ok=True)


settings = Settings()
