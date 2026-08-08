Verification contract:

- GET only; no mutation path exists.
- Reads only `/v1/checklist-sentinel/status` from the Mac.
- Mac URL and API key stay in server-side Production environment variables.
- Response is sanitized to job progress, target counts, heartbeat, and freeze-stale state.
- No raw findings, downloads, source URLs, provenance, credentials, or admin data are returned.
- Network failures and timeouts fail closed with HTTP 503 and generic errors.
