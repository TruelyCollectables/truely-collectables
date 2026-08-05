#!/usr/bin/env python3
"""Reset recovered pending cards so InstaComp must use stored front and back images."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SERVICE_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = SERVICE_ROOT / ".env"
ENDPOINT = "/api/instacomp/recovered-pair-identity-reset"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def main() -> int:
    env = load_env(ENV_PATH)
    base_url = (
        os.getenv("INSTACOMP_AI_REGISTRY_URL")
        or env.get("INSTACOMP_AI_REGISTRY_URL")
        or "https://truelycollectables.com"
    ).rstrip("/")
    token = (
        os.getenv("INSTACOMP_AI_REGISTRY_TOKEN")
        or env.get("INSTACOMP_AI_REGISTRY_TOKEN")
        or ""
    ).strip()
    if not token:
        print("ERROR: Local InstaComp Registry token is missing.", file=sys.stderr)
        return 2

    request = Request(
        f"{base_url}{ENDPOINT}",
        data=b"{}",
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "x-tcos-instacomp-service-token": token,
        },
    )
    try:
        with urlopen(request, timeout=300) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1500]
        print(f"ERROR: Production returned HTTP {error.code}: {detail}", file=sys.stderr)
        return 2
    except (URLError, UnicodeDecodeError, json.JSONDecodeError) as error:
        print(f"ERROR: Could not complete identity reset: {error}", file=sys.stderr)
        return 2

    if not isinstance(payload, dict):
        print("ERROR: Production returned an invalid response.", file=sys.stderr)
        return 2

    reset = int(payload.get("reset") or 0)
    failed = int(payload.get("failed") or 0)
    candidates = int(payload.get("candidates") or 0)
    for result in payload.get("results") or []:
        title = str(result.get("title") or "Untitled item")
        if result.get("reset") is True:
            print(f"RESET FOR FRONT+BACK RESCAN: {title}")
        else:
            print(f"FAILED: {title}: {result.get('error') or 'unknown error'}", file=sys.stderr)

    print(f"Finished: {reset}/{candidates} cards require a fresh front+back Registry identity; {failed} failed.")
    print("No listings were published.")
    return 1 if failed or payload.get("ok") is not True else 0


if __name__ == "__main__":
    raise SystemExit(main())
