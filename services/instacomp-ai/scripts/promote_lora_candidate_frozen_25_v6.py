#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import promote_lora_candidate_frozen_25_v2 as v2
import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_25_v5 as v5
import promote_lora_candidate_frozen_five_v2 as frozen_five_v2


_original_run_round = v2.run_round


def _refresh_runtime_candidate_settings(env_file: Path | None = None):
    """Refresh only mutable LoRA candidate fields on the shared Settings object.

    Frozen 25 v5 performs live Registry/image preflight before activation. That
    imports app.config and creates its module-level settings singleton while the
    candidate is still disabled. The enable script then correctly writes the
    protected .env, but every module that already imported the singleton keeps a
    reference to the stale object. Replacing the object would not repair those
    references, so mutate the existing singleton in place from a fresh Settings
    load after activation.
    """
    from app import config

    source = (env_file or (config.SERVICE_ROOT / ".env")).expanduser().resolve()
    fresh = config.Settings(_env_file=source)
    current = config.settings
    current.lora_candidate_enabled = fresh.lora_candidate_enabled
    current.lora_candidate_url = fresh.lora_candidate_url
    return current


async def _run_round(
    number: int,
    fixtures: list[dict[str, Any]],
    adapter_sha: str,
) -> dict[str, Any]:
    settings = _refresh_runtime_candidate_settings()
    if settings.lora_candidate_enabled is not True:
        raise RuntimeError(
            "Candidate setting did not reload enabled after fresh protected .env reload"
        )
    return await _original_run_round(number, fixtures, adapter_sha)


def _install_contract_fix() -> None:
    # Preserve every v5 image-witness/Registry correction. Only replace the
    # round entrypoint so preflight-loaded app.config state is refreshed after
    # the enable script writes the protected .env.
    v5._install_contract_fix()
    v2.run_round = _run_round
    v3.SCHEMA = "tcos.instacomp-ai.lora-frozen-25-promotion.v6"


def _runtime_reload_self_test() -> None:
    from app import config

    saved_env = {
        key: os.environ.get(key)
        for key in frozen_five_v2.MUTABLE_CANDIDATE_ENV_KEYS
    }
    saved_enabled = config.settings.lora_candidate_enabled
    saved_url = config.settings.lora_candidate_url
    shared = config.settings

    try:
        # Reproduce the Mac failure exactly: app.config has already been imported
        # while disabled, then activation changes the protected .env afterward.
        shared.lora_candidate_enabled = False
        shared.lora_candidate_url = "http://127.0.0.1:8791"
        os.environ["INSTACOMP_AI_LORA_CANDIDATE_ENABLED"] = "false"
        os.environ["INSTACOMP_AI_LORA_CANDIDATE_URL"] = "http://127.0.0.1:9999"
        frozen_five_v2.clear_mutable_candidate_env_overrides()

        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                "INSTACOMP_AI_LORA_CANDIDATE_ENABLED=true\n"
                "INSTACOMP_AI_LORA_CANDIDATE_URL=http://127.0.0.1:8791\n",
                "utf-8",
            )
            refreshed = _refresh_runtime_candidate_settings(env_file)

        assert refreshed is shared
        assert config.settings is shared
        assert shared.lora_candidate_enabled is True
        assert shared.lora_candidate_url == "http://127.0.0.1:8791"
    finally:
        shared.lora_candidate_enabled = saved_enabled
        shared.lora_candidate_url = saved_url
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    print("PASS stale preflight Settings singleton refreshes enabled state in place")
    print("PASS already-imported modules retain the refreshed shared Settings object")


def self_test() -> int:
    _install_contract_fix()
    assert v5.self_test() == 0
    _runtime_reload_self_test()
    print("PASS Frozen 25 v6 preserves v5 image/Registry fail-closed contract")
    return 0


def main() -> int:
    _install_contract_fix()
    if "--self-test" in sys.argv[1:]:
        return self_test()
    return v3.main()


if __name__ == "__main__":
    raise SystemExit(main())
