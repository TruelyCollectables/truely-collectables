from __future__ import annotations

import inspect

from app.runtime_compat import _psa_requires_browser_render, install_sentinel_runtime_compat
from app.sentinel import ChecklistSentinel
from app.sentinel_sources import DownloadedFile, SentinelSourceClient


PSA_URL = "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-elite-black-box/101090"


def downloaded(url: str, content: bytes) -> DownloadedFile:
    return DownloadedFile(
        url=url,
        content=content,
        content_type="text/html",
        sha256="0" * 64,
        extension=".html",
    )


def test_psa_next_flight_shell_requires_browser_render() -> None:
    shell = b'<html>collectors-web/_next (self.__next_f=self.__next_f||[]).push([0])</html>'
    assert _psa_requires_browser_render(downloaded(PSA_URL, shell)) is True


def test_psa_rendered_items_table_stays_on_normal_path() -> None:
    rendered = b"<html><h2>Items in Set</h2><table><tr><th>No.</th><th>Subject</th><th>Auction Results</th></tr></table></html>"
    assert _psa_requires_browser_render(downloaded(PSA_URL, rendered)) is False


def test_non_psa_html_never_invokes_psa_browser_fallback() -> None:
    shell = b"(self.__next_f=self.__next_f||[]).push([0])"
    assert (
        _psa_requires_browser_render(
            downloaded("https://example.com/checklist.html", shell)
        )
        is False
    )


def test_runtime_compat_is_idempotent_and_uses_source_file_relay_contract() -> None:
    install_sentinel_runtime_compat()
    first = SentinelSourceClient.download
    install_sentinel_runtime_compat()
    assert SentinelSourceClient.download is first
    assert getattr(SentinelSourceClient, "_instacomp_psa_render_compat", False) is True
    assert getattr(ChecklistSentinel, "_instacomp_source_file_relay_compat", False) is True
    source = inspect.getsource(ChecklistSentinel._import_to_registry)
    assert '"sourceFile"' in source
