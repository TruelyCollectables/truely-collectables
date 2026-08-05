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
    checklist_source_path: Path | None = None
    checklist_mirror_path: Path = Path("./data/checklists/mirror")
    registry_path: Path = Path("./data/registry/checklist-registry.sqlite3")
    backup_default_destination: Path = Path("./backups")
    backup_allowed_roots: str = ""
    max_image_bytes: int = 12 * 1024 * 1024
    max_total_image_bytes: int = 24 * 1024 * 1024
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5vl:7b"
    ollama_timeout_seconds: float = 120.0
    allow_teacher_suggestions: bool = True
    require_operator_for_trusted_memory: bool = True
    api_key: str | None = None

    @property
    def service_root(self) -> Path:
        return Path(__file__).resolve().parents[1]

    def resolve_local_path(self, value: Path) -> Path:
        expanded = value.expanduser()
        return expanded.resolve() if expanded.is_absolute() else (self.service_root / expanded).resolve()

    def resolved_checklist_source(self) -> Path | None:
        return (
            self.checklist_source_path.expanduser().resolve()
            if self.checklist_source_path
            else None
        )

    def resolved_allowed_backup_roots(self) -> list[Path]:
        values = [item.strip() for item in self.backup_allowed_roots.split(",") if item.strip()]
        if not values:
            values = [str(self.backup_default_destination)]
        return [self.resolve_local_path(Path(value)) for value in values]

    def ensure_directories(self) -> None:
        self.resolve_local_path(self.database_path).parent.mkdir(parents=True, exist_ok=True)
        self.resolve_local_path(self.image_store_path).mkdir(parents=True, exist_ok=True)
        self.resolve_local_path(self.checklist_mirror_path).mkdir(parents=True, exist_ok=True)
        self.resolve_local_path(self.registry_path).parent.mkdir(parents=True, exist_ok=True)
        self.resolve_local_path(self.backup_default_destination).mkdir(parents=True, exist_ok=True)


settings = Settings()
