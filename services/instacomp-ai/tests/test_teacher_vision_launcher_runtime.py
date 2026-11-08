from __future__ import annotations

from pathlib import Path


def test_teacher_launcher_bootstraps_service_venv_before_app_imports() -> None:
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "run_teacher_vision_lora_training.py"
    )
    source = script.read_text("utf-8")

    bootstrap_call = source.index("_bootstrap_service_runtime()")
    first_app_import = source.index("from app.config import settings")

    assert bootstrap_call < first_app_import
    assert 'SERVICE_VENV = SERVICE_ROOT / ".venv"' in source
    assert 'SERVICE_PYTHON = SERVICE_VENV / "bin" / "python"' in source
    assert "Path(sys.prefix).resolve() == SERVICE_VENV.resolve()" in source
    assert "os.execv(" in source
