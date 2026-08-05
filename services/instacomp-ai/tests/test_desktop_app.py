from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_desktop_app_is_canonical_inside_service_folder():
    installer = (ROOT / "scripts" / "install-desktop-app.sh").read_text(encoding="utf-8")

    assert 'APP_PARENT="$SERVICE_ROOT/desktop"' in installer
    assert 'APP_PATH="$APP_PARENT/InstaComp AI.app"' in installer
    assert 'DESKTOP_LINK="$HOME/Desktop/InstaComp AI.app"' in installer
    assert 'ln -s "$APP_PATH" "$DESKTOP_LINK"' in installer
    assert "com.tcos.instacomp-ai.cockpit" in installer
    assert "http://127.0.0.1:8787/control" in installer


def test_desktop_launcher_recovers_service_before_opening_cockpit():
    launcher = (ROOT / "scripts" / "launch-cockpit.sh").read_text(encoding="utf-8")

    assert "http://127.0.0.1:8787/health" in launcher
    assert "com.tcos.instacomp-ai.service" in launcher
    assert "launchctl kickstart" in launcher
    assert "run-local.sh" in launcher
    assert 'open "$COCKPIT_URL"' in launcher
    assert "did not become ready within 30 seconds" in launcher


def test_mac_installer_builds_desktop_app_after_launch_agents():
    installer = (ROOT / "scripts" / "install-macos.sh").read_text(encoding="utf-8")

    bootstrap_position = installer.index("launchctl bootstrap")
    app_position = installer.index('"$SERVICE_ROOT/scripts/install-desktop-app.sh"')
    assert app_position > bootstrap_position
    assert "plutil -lint" in installer
    assert "Local service status: READY" in installer
