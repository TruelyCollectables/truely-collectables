# InstaComp AI desktop assets

The approved InstaComp AI desktop icon is the dark metallic, electric-blue control-hub design approved in the InstaComp AI 1.0 Beta build conversation.

Before running `scripts/install-macos.sh`, place that approved image at one of these paths:

- `assets/instacomp-ai-approved-icon.png`
- `assets/instacomp-ai-approved-icon.jpg`

Use a square image at least 512 × 512 pixels. The Mac installer converts it into the full `.icns` icon set and stores the canonical `InstaComp AI.app` bundle inside the protected InstaComp AI folder. A desktop link points to that canonical app so the launcher itself is included in full-system backups.

The installer deliberately refuses undersized or invalid image assets rather than silently installing the wrong icon.
