from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import httpx

from .sentinel import ChecklistSentinel
from .sentinel_sources import DownloadedFile, SentinelSourceClient, _is_psa_set_apr_url


_CHROME_CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
)


def _psa_requires_browser_render(downloaded: DownloadedFile) -> bool:
    host = (urlparse(downloaded.url).hostname or "").lower()
    if host not in {"psacard.com", "www.psacard.com"}:
        return False
    if not _is_psa_set_apr_url(downloaded.url):
        return False
    if "html" not in downloaded.content_type.lower():
        return False
    lowered = downloaded.content.lower()
    has_rows = (
        b"items in set" in lowered
        and b"auction results" in lowered
        and b"<table" in lowered
    )
    if has_rows:
        return False
    return b"self.__next_f" in lowered or b"collectors-web/_next" in lowered


def _chrome_binary() -> str | None:
    configured = os.getenv("INSTACOMP_AI_CHROME_BIN", "").strip()
    if configured and Path(configured).is_file():
        return configured
    for candidate in _CHROME_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        resolved = shutil.which(name)
        if resolved:
            return resolved
    return None


async def _render_psa_apr_with_chrome(
    client: SentinelSourceClient,
    url: str,
) -> DownloadedFile:
    chrome = _chrome_binary()
    if not chrome:
        raise ValueError(
            "PSA APR returned only its Next.js shell and no supported Chrome/Chromium binary is installed."
        )

    timeout = max(45.0, min(float(client.timeout_seconds) * 2.0, 150.0))
    with tempfile.TemporaryDirectory(prefix="instacomp-psa-chrome-") as profile:
        process = await asyncio.create_subprocess_exec(
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-sync",
            "--metrics-recording-only",
            "--mute-audio",
            f"--user-data-dir={profile}",
            "--virtual-time-budget=20000",
            "--dump-dom",
            url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise ValueError("PSA APR browser rendering timed out.") from exc

    if process.returncode != 0:
        detail = stderr.decode("utf-8", errors="replace").strip().replace("\n", " ")[-500:]
        raise ValueError(
            "PSA APR browser rendering failed"
            + (f": {detail}" if detail else ".")
        )
    if not stdout:
        raise ValueError("PSA APR browser rendering returned an empty DOM.")
    if len(stdout) > client.max_download_bytes:
        raise ValueError("Rendered PSA APR page exceeded the configured byte limit.")

    lowered = stdout.lower()
    if not (
        b"items in set" in lowered
        and b"auction results" in lowered
        and b"<table" in lowered
    ):
        raise ValueError(
            "PSA APR browser rendering completed but did not expose deterministic Items in Set table rows."
        )

    return DownloadedFile(
        url=url,
        content=stdout,
        content_type="text/html",
        sha256=hashlib.sha256(stdout).hexdigest(),
        extension=".html",
    )


async def _import_to_registry_source_file(
    self: ChecklistSentinel,
    *,
    target: dict,
    source_url: str,
    local_path: Path,
    content_type: str,
    sha256: str,
) -> tuple[str, str | None]:
    if not self.registry_import_url:
        return "downloaded_local_pending_registry_import", None

    headers: dict[str, str] = {}
    if self.registry_token:
        headers["authorization"] = f"Bearer {self.registry_token}"
        headers["x-tcos-instacomp-service-token"] = self.registry_token
    data = {
        "targetKey": target["target_key"],
        "sport": target.get("sport") or "",
        "year": str(target.get("year") or ""),
        "season": str(target.get("season") or ""),
        "manufacturer": str(target.get("manufacturer") or ""),
        "product": str(target.get("product") or ""),
        "sourceUrl": source_url,
        "sha256": sha256,
        "source": "instacomp-ai-checklist-sentinel",
    }
    try:
        async with httpx.AsyncClient(
            timeout=max(60.0, self.request_timeout_seconds),
            follow_redirects=True,
            headers=headers,
        ) as client:
            with local_path.open("rb") as handle:
                response = await client.post(
                    self.registry_import_url,
                    data=data,
                    files={
                        "sourceFile": (
                            local_path.name,
                            handle,
                            content_type or "application/octet-stream",
                        )
                    },
                )
        payload = response.json() if response.content else {}
        receipt = str(
            payload.get("receipt")
            or payload.get("importId")
            or payload.get("id")
            or ""
        ).strip()
        if (
            response.is_success
            and payload.get("ok") is True
            and payload.get("registryImported") is True
        ):
            return "imported_registry", receipt or None
        if response.is_success and payload.get("ok") is True:
            return "downloaded_local_pending_registry_validation", receipt or None
        return (
            "downloaded_local_registry_rejected",
            receipt
            or str(
                payload.get("registryError")
                or payload.get("error")
                or response.status_code
            )[:1000],
        )
    except (httpx.HTTPError, OSError, ValueError, json.JSONDecodeError) as error:
        return "downloaded_local_registry_error", str(error)[:1000]


def install_sentinel_runtime_compat() -> None:
    if getattr(SentinelSourceClient, "_instacomp_psa_render_compat", False):
        return

    original_download = SentinelSourceClient.download

    async def download_with_psa_render(
        self: SentinelSourceClient,
        url: str,
    ) -> DownloadedFile:
        downloaded = await original_download(self, url)
        if _psa_requires_browser_render(downloaded):
            return await _render_psa_apr_with_chrome(self, downloaded.url)
        return downloaded

    SentinelSourceClient.download = download_with_psa_render
    SentinelSourceClient._instacomp_psa_render_compat = True
    SentinelSourceClient._instacomp_original_download = original_download

    # The Production relay accepts multipart field `sourceFile`; older Mac
    # Sentinel code used `file`, causing otherwise-valid downloads to stop at
    # the relay boundary. Keep the corrected contract centralized here until
    # every installed runtime has moved past the legacy implementation.
    ChecklistSentinel._import_to_registry = _import_to_registry_source_file
    ChecklistSentinel._instacomp_source_file_relay_compat = True
