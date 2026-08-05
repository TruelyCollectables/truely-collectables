from __future__ import annotations

import os
import platform
import shutil
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import Settings


class SystemDoctor:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.service_root = settings.service_root

    def run(self) -> dict[str, Any]:
        checks: list[dict[str, Any]] = []
        is_macos = platform.system() == "Darwin"

        checks.append(
            self._check(
                "python-version",
                sys.version_info >= (3, 11),
                f"Python {platform.python_version()}",
                "Python 3.11 or newer is required.",
            )
        )
        checks.append(
            {
                "id": "operating-system",
                "status": "pass" if is_macos else "warn",
                "message": f"{platform.system()} {platform.release()}",
                "repair": None if is_macos else "Final runtime acceptance must be performed on macOS.",
            }
        )
        checks.append(
            {
                "id": "architecture",
                "status": "pass" if platform.machine() in {"arm64", "x86_64"} else "warn",
                "message": platform.machine() or "unknown",
                "repair": None,
            }
        )

        checks.extend(
            [
                self._directory_check("service-root", self.service_root, create=False),
                self._directory_check(
                    "database-folder",
                    self.settings.resolve_local_path(self.settings.database_path).parent,
                ),
                self._directory_check(
                    "image-store",
                    self.settings.resolve_local_path(self.settings.image_store_path),
                ),
                self._directory_check(
                    "checklist-mirror",
                    self.settings.resolve_local_path(self.settings.checklist_mirror_path),
                ),
                self._directory_check(
                    "registry-folder",
                    self.settings.resolve_local_path(self.settings.registry_path).parent,
                ),
                self._directory_check(
                    "default-backup-folder",
                    self.settings.resolve_local_path(
                        self.settings.backup_default_destination
                    ),
                ),
            ]
        )

        checklist_path = self.settings.resolved_checklist_source()
        if checklist_path is None:
            checks.append(
                {
                    "id": "checklist-source",
                    "status": "fail",
                    "message": "Not configured",
                    "repair": "Set INSTACOMP_AI_CHECKLIST_SOURCE_PATH in .env to the Google Drive for Desktop checklist folder.",
                }
            )
        else:
            checks.append(
                self._check(
                    "checklist-source",
                    checklist_path.is_dir() and os.access(checklist_path, os.R_OK),
                    str(checklist_path),
                    "Confirm Google Drive for Desktop is signed in and the configured folder exists and is readable.",
                )
            )

        for root in self.settings.resolved_allowed_backup_roots():
            checks.append(self._directory_check(f"approved-backup-root:{root}", root))

        env_path = self.service_root / ".env"
        if env_path.exists():
            mode = stat.S_IMODE(env_path.stat().st_mode)
            checks.append(
                self._check(
                    "env-permissions",
                    mode & 0o077 == 0,
                    oct(mode),
                    f"Run: chmod 600 '{env_path}'",
                    warning=True,
                )
            )
        else:
            checks.append(
                {
                    "id": "env-file",
                    "status": "fail",
                    "message": ".env is missing",
                    "repair": "Copy .env.example to .env and configure it.",
                }
            )

        free_bytes = shutil.disk_usage(self.service_root).free
        checks.append(
            self._check(
                "free-storage",
                free_bytes >= 5 * 1024**3,
                f"{free_bytes} bytes free",
                "Free at least 5 GB before checklist imports, card-image storage, and full backups.",
                warning=True,
            )
        )

        ollama_binary = shutil.which("ollama")
        ollama_app = Path("/Applications/Ollama.app").exists() or (
            Path.home() / "Applications" / "Ollama.app"
        ).exists()
        checks.append(
            self._check(
                "ollama-installation",
                bool(ollama_binary or ollama_app),
                ollama_binary or ("Ollama.app" if ollama_app else "Not found"),
                "Install Ollama and pull the configured vision model.",
            )
        )

        desktop_app = self.service_root / "desktop" / "InstaComp AI.app"
        desktop_link = Path.home() / "Desktop" / "InstaComp AI.app"
        checks.append(
            self._check(
                "canonical-desktop-app",
                desktop_app.is_dir(),
                str(desktop_app),
                "Run scripts/install-desktop-app.sh or scripts/install-macos.sh.",
            )
        )
        checks.append(
            self._check(
                "desktop-launcher",
                desktop_link.exists() or desktop_link.is_symlink(),
                str(desktop_link),
                "Run scripts/install-desktop-app.sh to recreate the desktop launcher.",
            )
        )

        if is_macos:
            required_binaries = [
                "/bin/launchctl",
                "/usr/bin/plutil",
                "/usr/bin/sips",
                "/usr/bin/iconutil",
                "/usr/bin/open",
                "/usr/bin/osascript",
            ]
            for binary in required_binaries:
                checks.append(
                    self._check(
                        f"mac-binary:{Path(binary).name}",
                        Path(binary).exists(),
                        binary,
                        "This required macOS system utility is missing.",
                    )
                )

            launch_agents = [
                Path.home()
                / "Library"
                / "LaunchAgents"
                / "com.tcos.instacomp-ai.service.plist",
                Path.home()
                / "Library"
                / "LaunchAgents"
                / "com.tcos.instacomp-ai.checklist-sync.plist",
            ]
            for launch_agent in launch_agents:
                checks.append(
                    self._check(
                        f"launch-agent:{launch_agent.stem}",
                        launch_agent.is_file(),
                        str(launch_agent),
                        "Run scripts/install-macos.sh to install the LaunchAgent.",
                    )
                )

        failures = [check for check in checks if check["status"] == "fail"]
        warnings = [check for check in checks if check["status"] == "warn"]
        return {
            "schema": "tcos.instacomp-ai.system-doctor.v1",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ready": not failures,
            "summary": {
                "passed": sum(check["status"] == "pass" for check in checks),
                "warnings": len(warnings),
                "failures": len(failures),
                "total": len(checks),
            },
            "checks": checks,
        }

    @staticmethod
    def _check(
        check_id: str,
        passed: bool,
        message: str,
        repair: str | None,
        *,
        warning: bool = False,
    ) -> dict[str, Any]:
        return {
            "id": check_id,
            "status": "pass" if passed else ("warn" if warning else "fail"),
            "message": message,
            "repair": None if passed else repair,
        }

    @staticmethod
    def _directory_check(
        check_id: str, path: Path, *, create: bool = True
    ) -> dict[str, Any]:
        resolved = path.expanduser().resolve()
        try:
            if create:
                resolved.mkdir(parents=True, exist_ok=True)
            passed = resolved.is_dir() and os.access(resolved, os.R_OK | os.W_OK)
        except OSError:
            passed = False
        return {
            "id": check_id,
            "status": "pass" if passed else "fail",
            "message": str(resolved),
            "repair": None
            if passed
            else "Create the folder and grant the current Mac user read/write access.",
        }
