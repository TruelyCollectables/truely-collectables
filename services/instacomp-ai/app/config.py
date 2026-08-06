from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


SERVICE_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="INSTACOMP_AI_",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "InstaComp AI™"
    codename: str = "InstaComp AI 1.0 Beta"
    version: str = "1.0.0-beta.registry-pipeline"
    host: str = "127.0.0.1"
    port: int = 8787
    database_path: Path = Path("./data/instacomp_ai.sqlite3")
    image_store_path: Path = Path("./data/images")
    backup_default_destination: Path = Path("./backups")
    backup_allowed_roots: str = ""
    local_cache_source_path: str = ""
    max_image_bytes: int = 12 * 1024 * 1024
    max_total_image_bytes: int = 24 * 1024 * 1024
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5vl:7b"
    ollama_timeout_seconds: float = 120.0
    api_key: str | None = None

    # Mac-owned Truely Collectables scheduler. The service LaunchAgent already
    # survives reboots; this internal scheduler owns cadence, locking, retries,
    # durable receipts, and the Deal Hunter chain without ChatGPT automations.
    deal_hunter_enabled: bool = True
    deal_hunter_run_on_startup: bool = True
    deal_hunter_startup_delay_seconds: int = 45
    deal_hunter_interval_minutes: int = 60
    deal_hunter_site_url: str = "https://truelycollectables.com"
    deal_hunter_per_query: int = 20
    deal_hunter_max_candidates_per_run: int = 20
    deal_hunter_candidate_cooldown_hours: int = 6
    deal_hunter_request_timeout_seconds: float = 300.0

    @property
    def service_root(self) -> Path:
        return SERVICE_ROOT

    def resolve_local_path(self, value: str | Path) -> Path:
        path = Path(value).expanduser()
        if path.is_absolute():
            return path.resolve()
        return (self.service_root / path).resolve()

    def resolved_cache_source(self) -> Path | None:
        value = self.local_cache_source_path.strip()
        return self.resolve_local_path(value) if value else None

    def resolved_allowed_backup_roots(self) -> list[Path]:
        configured = [
            self.resolve_local_path(value.strip())
            for value in self.backup_allowed_roots.split(",")
            if value.strip()
        ]
        if configured:
            return configured
        return [self.resolve_local_path(self.backup_default_destination)]

    def ensure_directories(self) -> None:
        self.resolve_local_path(self.database_path).parent.mkdir(parents=True, exist_ok=True)
        self.resolve_local_path(self.image_store_path).mkdir(parents=True, exist_ok=True)
        self.resolve_local_path(self.backup_default_destination).mkdir(
            parents=True,
            exist_ok=True,
        )


settings = Settings(_env_file=SERVICE_ROOT / ".env")
