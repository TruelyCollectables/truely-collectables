#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The InstaComp AI desktop app installer requires macOS." >&2
  exit 2
fi

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_root="$service_root/desktop/InstaComp AI.app"
contents="$app_root/Contents"
macos_dir="$contents/MacOS"
resources="$contents/Resources"
launcher="$macos_dir/InstaComp AI"

rm -rf "$app_root"
mkdir -p "$macos_dir" "$resources"

cat > "$launcher" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec bash "$service_root/scripts/launch-cockpit.sh"
EOF
chmod 700 "$launcher"

cat > "$contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>InstaComp AI</string>
  <key>CFBundleExecutable</key>
  <string>InstaComp AI</string>
  <key>CFBundleIdentifier</key>
  <string>com.truelycollectables.instacomp-ai.desktop</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>InstaComp AI</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0-beta</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF

icon_source=""
for candidate in \
  "$service_root/assets/instacomp-ai-approved-icon.png" \
  "$service_root/assets/instacomp-ai-approved-icon.jpg"; do
  if [[ -f "$candidate" ]]; then
    icon_source="$candidate"
    break
  fi
done

if [[ -n "$icon_source" ]] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  width="$(sips -g pixelWidth "$icon_source" 2>/dev/null | awk '/pixelWidth/ {print $2}')"
  height="$(sips -g pixelHeight "$icon_source" 2>/dev/null | awk '/pixelHeight/ {print $2}')"
  if [[ "$width" =~ ^[0-9]+$ ]] && [[ "$height" =~ ^[0-9]+$ ]] && (( width == height && width >= 512 )); then
    iconset="$service_root/desktop/InstaCompAI.iconset"
    rm -rf "$iconset"
    mkdir -p "$iconset"
    sips -z 16 16 "$icon_source" --out "$iconset/icon_16x16.png" >/dev/null
    sips -z 32 32 "$icon_source" --out "$iconset/icon_16x16@2x.png" >/dev/null
    sips -z 32 32 "$icon_source" --out "$iconset/icon_32x32.png" >/dev/null
    sips -z 64 64 "$icon_source" --out "$iconset/icon_32x32@2x.png" >/dev/null
    sips -z 128 128 "$icon_source" --out "$iconset/icon_128x128.png" >/dev/null
    sips -z 256 256 "$icon_source" --out "$iconset/icon_128x128@2x.png" >/dev/null
    sips -z 256 256 "$icon_source" --out "$iconset/icon_256x256.png" >/dev/null
    sips -z 512 512 "$icon_source" --out "$iconset/icon_256x256@2x.png" >/dev/null
    sips -z 512 512 "$icon_source" --out "$iconset/icon_512x512.png" >/dev/null
    sips -z 1024 1024 "$icon_source" --out "$iconset/icon_512x512@2x.png" >/dev/null
    iconutil -c icns "$iconset" -o "$resources/InstaComp AI.icns"
    rm -rf "$iconset"
    /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string InstaComp AI" "$contents/Info.plist"
  else
    echo "Approved icon must be square and at least 512x512; installing without a custom icon." >&2
  fi
else
  echo "Approved icon was not found or macOS icon tools are unavailable; installing without a custom icon." >&2
fi

mkdir -p "$HOME/Desktop"
desktop_link="$HOME/Desktop/InstaComp AI.app"
if [[ -L "$desktop_link" ]]; then
  rm "$desktop_link"
elif [[ -e "$desktop_link" ]]; then
  echo "Refusing to replace existing non-symlink Desktop item: $desktop_link" >&2
  exit 3
fi
ln -s "$app_root" "$desktop_link"

touch "$app_root"
echo "Installed local app bundle: $app_root"
echo "Installed Desktop launcher: $desktop_link"
