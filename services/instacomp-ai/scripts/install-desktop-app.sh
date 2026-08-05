#!/usr/bin/env bash
set -euo pipefail

SERVICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PARENT="$SERVICE_ROOT/desktop"
APP_PATH="$APP_PARENT/InstaComp AI.app"
CONTENTS="$APP_PATH/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES_DIR="$CONTENTS/Resources"
DESKTOP_LINK="$HOME/Desktop/InstaComp AI.app"
ICON_PNG="$SERVICE_ROOT/assets/instacomp-ai-approved-icon.png"
ICON_JPG="$SERVICE_ROOT/assets/instacomp-ai-approved-icon.jpg"
RECEIPT_DIR="$SERVICE_ROOT/data/receipts/desktop-app"

mkdir -p "$APP_PARENT" "$RECEIPT_DIR" "$HOME/Desktop"
rm -rf "$APP_PATH"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>InstaComp AI</string>
  <key>CFBundleExecutable</key><string>InstaComp AI</string>
  <key>CFBundleIconFile</key><string>InstaCompAI</string>
  <key>CFBundleIdentifier</key><string>com.tcos.instacomp-ai.cockpit</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>InstaComp AI</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
/usr/bin/plutil -lint "$CONTENTS/Info.plist" >/dev/null

cat > "$MACOS_DIR/InstaComp AI" <<LAUNCHER
#!/usr/bin/env bash
exec "$SERVICE_ROOT/scripts/launch-cockpit.sh"
LAUNCHER
chmod +x "$MACOS_DIR/InstaComp AI" "$SERVICE_ROOT/scripts/launch-cockpit.sh"

build_icon() {
  local source=""
  local width="0"
  local height="0"

  if [[ -f "$ICON_PNG" ]]; then
    source="$ICON_PNG"
  elif [[ -f "$ICON_JPG" ]]; then
    source="$ICON_JPG"
  fi

  if [[ -z "$source" || ! -s "$source" ]]; then
    echo "Approved icon asset is not present. The app will use the standard macOS application icon." >&2
    return 0
  fi

  width="$(/usr/bin/sips -g pixelWidth "$source" 2>/dev/null | /usr/bin/awk '/pixelWidth/ {print $2}' || true)"
  height="$(/usr/bin/sips -g pixelHeight "$source" 2>/dev/null | /usr/bin/awk '/pixelHeight/ {print $2}' || true)"
  if [[ -z "$width" || -z "$height" || "$width" -lt 256 || "$height" -lt 256 ]]; then
    echo "Approved icon asset is invalid or smaller than 256 × 256 pixels and was not installed." >&2
    return 0
  fi

  local working_png iconset
  working_png="$(mktemp -t instacomp-icon).png"
  iconset="$(mktemp -d -t InstaCompAI.iconset)"
  /usr/bin/sips -s format png "$source" --out "$working_png" >/dev/null

  /usr/bin/sips -z 16 16 "$working_png" --out "$iconset/icon_16x16.png" >/dev/null
  /usr/bin/sips -z 32 32 "$working_png" --out "$iconset/icon_16x16@2x.png" >/dev/null
  /usr/bin/sips -z 32 32 "$working_png" --out "$iconset/icon_32x32.png" >/dev/null
  /usr/bin/sips -z 64 64 "$working_png" --out "$iconset/icon_32x32@2x.png" >/dev/null
  /usr/bin/sips -z 128 128 "$working_png" --out "$iconset/icon_128x128.png" >/dev/null
  /usr/bin/sips -z 256 256 "$working_png" --out "$iconset/icon_128x128@2x.png" >/dev/null
  /usr/bin/sips -z 256 256 "$working_png" --out "$iconset/icon_256x256.png" >/dev/null
  /usr/bin/sips -z 512 512 "$working_png" --out "$iconset/icon_256x256@2x.png" >/dev/null
  /usr/bin/sips -z 512 512 "$working_png" --out "$iconset/icon_512x512.png" >/dev/null
  /usr/bin/sips -z 1024 1024 "$working_png" --out "$iconset/icon_512x512@2x.png" >/dev/null
  /usr/bin/iconutil -c icns "$iconset" -o "$RESOURCES_DIR/InstaCompAI.icns"

  rm -rf "$working_png" "$iconset"
}

build_icon

if [[ -L "$DESKTOP_LINK" ]]; then
  rm "$DESKTOP_LINK"
elif [[ -e "$DESKTOP_LINK" ]]; then
  previous="$HOME/Desktop/InstaComp AI.previous.$(date '+%Y%m%d-%H%M%S').app"
  mv "$DESKTOP_LINK" "$previous"
  echo "Preserved the existing desktop item at: $previous"
fi
ln -s "$APP_PATH" "$DESKTOP_LINK"
/usr/bin/touch "$APP_PATH"
/usr/bin/xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true

cat > "$RECEIPT_DIR/latest.json" <<RECEIPT
{
  "schema": "tcos.instacomp-ai.desktop-app-install.v1",
  "installed_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "canonical_app": "$APP_PATH",
  "desktop_link": "$DESKTOP_LINK",
  "launcher": "$SERVICE_ROOT/scripts/launch-cockpit.sh",
  "cockpit_url": "http://127.0.0.1:8787/control",
  "icon_installed": $([[ -f "$RESOURCES_DIR/InstaCompAI.icns" ]] && echo true || echo false)
}
RECEIPT

echo "Desktop cockpit app installed: $DESKTOP_LINK"
echo "Canonical app stored inside the protected InstaComp AI folder: $APP_PATH"
