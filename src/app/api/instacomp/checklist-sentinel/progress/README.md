# Sentinel progress endpoint

`GET /api/instacomp/checklist-sentinel/progress` is intentionally read-only and returns only a sanitized progress summary.

The Production-only Mac URL and API key remain server-side. The response does not expose credentials, source URLs, findings, downloads, provenance, admin capabilities, mutation endpoints, or raw Sentinel payloads.

The endpoint is `no-store` and exists so operational progress can be read without exporting sensitive Vercel environment values into CI.
