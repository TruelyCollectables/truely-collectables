#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def _read_payload(path: str | None) -> dict:
    raw = sys.stdin.read() if not path or path == "-" else open(path, "r", encoding="utf-8").read()
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise SystemExit("Manual InstaComp payload must be a JSON object.")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Send manual ChatGPT InstaComp research into the Mac market-memory pipeline.")
    parser.add_argument("payload", nargs="?", help="JSON payload path. Reads stdin when omitted or '-'.")
    parser.add_argument("--url", default=os.environ.get("INSTACOMP_AI_URL", "http://127.0.0.1:8787"), help="InstaComp AI base URL")
    parser.add_argument("--api-key", default=os.environ.get("INSTACOMP_AI_API_KEY"), help="Optional InstaComp API key")
    args = parser.parse_args()

    payload = _read_payload(args.payload)
    body = json.dumps(payload, sort_keys=True).encode("utf-8")
    request = urllib.request.Request(
        args.url.rstrip("/") + "/v1/training/manual-instacomp",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if args.api_key:
        request.add_header("X-InstaComp-AI-Key", args.api_key)

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"InstaComp ingestion failed: HTTP {exc.code}: {detail}") from exc

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
