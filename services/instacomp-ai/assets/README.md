# InstaComp AI Approved Desktop Icon

The desktop installer accepts only an owner-approved square icon image placed at one of these paths:

```text
services/instacomp-ai/assets/instacomp-ai-approved-icon.png
services/instacomp-ai/assets/instacomp-ai-approved-icon.jpg
```

Requirements:

- square image
- at least 512 × 512 pixels
- approved dark metallic InstaComp AI design
- no generated placeholder silently represented as approved artwork

The installer uses macOS `sips` and `iconutil` to create `InstaComp AI.icns` inside the local application bundle. If the approved binary is absent or invalid, installation continues without a custom icon and prints a clear warning.

Do not commit private credentials, model files, card images, databases, or backup archives in this folder.
