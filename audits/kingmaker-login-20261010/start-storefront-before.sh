#!/bin/bash
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
export NEXT_TELEMETRY_DISABLED=1
cd '/Volumes/WD40 Data/Projects/truely-collectables'
exec /opt/homebrew/bin/node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
