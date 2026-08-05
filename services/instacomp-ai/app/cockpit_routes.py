from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

from .config import settings
from .system_doctor import run_system_doctor


_CONTROL_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>InstaComp AI Local Control</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #060b16; color: #eaf2ff; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 18px 64px; }
    header, section { border: 1px solid #24324b; background: #0b1324; border-radius: 18px; padding: 20px; margin-bottom: 16px; }
    h1, h2 { margin: 0 0 10px; } p { color: #aebbd0; line-height: 1.5; }
    .badge { display:inline-block; border:1px solid #2e76ff; color:#82b1ff; border-radius:999px; padding:5px 10px; font-size:12px; font-weight:800; }
    .grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
    label { display:block; font-weight:700; color:#d9e6ff; }
    input { width:100%; box-sizing:border-box; margin-top:7px; border:1px solid #31415f; background:#060b16; color:#fff; border-radius:10px; padding:11px; }
    button { border:0; border-radius:10px; padding:11px 15px; font-weight:900; cursor:pointer; background:#4c91ff; color:#061124; }
    button.secondary { background:#17243a; color:#d9e6ff; border:1px solid #31415f; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:15px; }
    pre { white-space:pre-wrap; word-break:break-word; background:#050913; border-radius:12px; padding:14px; min-height:48px; color:#b8d4ff; }
    .warning { color:#ffd37a; font-weight:800; }
    .authority { border-color:#6d4aff; }
  </style>
</head>
<body>
<main>
  <header class="authority">
    <span class="badge">LOCAL OWNER CONTROL PLANE</span>
    <h1>InstaComp AI 1.0 Beta</h1>
    <p>Local AI reads evidence and maintains private learning memory. The authenticated central Checklist Registry remains the only canonical identity authority. This console cannot publish listings or mutate seller inventory.</p>
    <p class="warning">Beta 1.0 is not passed until the physical Mac acceptance mission succeeds.</p>
  </header>

  <section>
    <h2>Secure connection</h2>
    <label>Local API key
      <input id="apiKey" type="password" autocomplete="off" placeholder="Required only when INSTACOMP_AI_API_KEY is configured" />
    </label>
    <div class="actions"><button onclick="refreshAll()">Refresh status</button></div>
    <pre id="status">Not loaded.</pre>
  </section>

  <section>
    <h2>Local setup</h2>
    <div class="grid">
      <label>Optional checklist cache source
        <input id="cacheSource" placeholder="Google Drive for Desktop folder or other approved local source" />
      </label>
      <label>Default backup destination
        <input id="backupDestination" value="./backups" />
      </label>
      <label>Approved backup roots
        <input id="backupRoots" placeholder="Comma-separated; blank uses the default destination" />
      </label>
      <label>Ollama model
        <input id="ollamaModel" value="qwen2.5vl:7b" />
      </label>
    </div>
    <label style="margin-top:14px"><input id="restartService" type="checkbox" checked style="width:auto" /> Restart the Mac service after the response is returned</label>
    <div class="actions">
      <button onclick="loadSettings()" class="secondary">Load settings</button>
      <button onclick="saveSettings()">Save settings</button>
    </div>
    <pre id="settingsOutput">Settings not loaded.</pre>
  </section>

  <section>
    <h2>Backup vault</h2>
    <p>Create a full local ZIP, SHA-256 receipt, and manifest in an approved destination.</p>
    <div class="actions"><button onclick="createBackup()">Back up everything now</button></div>
    <pre id="backupOutput">No backup run.</pre>
  </section>

  <section>
    <h2>System Doctor</h2>
    <div class="actions"><button onclick="runDoctor()">Run System Doctor</button></div>
    <pre id="doctorOutput">No diagnostic run.</pre>
  </section>
</main>
<script>
  const output = (id, value) => document.getElementById(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const headers = (json = false) => {
    const result = {};
    const key = document.getElementById('apiKey').value.trim();
    if (key) result['X-InstaComp-AI-Key'] = key;
    if (json) result['Content-Type'] = 'application/json';
    return result;
  };
  async function request(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
    return body;
  }
  async function refreshAll() {
    try { output('status', await request('/v1/control/status', { headers: headers() })); }
    catch (error) { output('status', String(error)); }
  }
  async function loadSettings() {
    try {
      const data = await request('/v1/settings/local', { headers: headers() });
      document.getElementById('cacheSource').value = data.local_cache_source_path || '';
      document.getElementById('backupDestination').value = data.backup_default_destination || './backups';
      document.getElementById('backupRoots').value = data.backup_allowed_roots || '';
      document.getElementById('ollamaModel').value = data.ollama_model || 'qwen2.5vl:7b';
      output('settingsOutput', data);
    } catch (error) { output('settingsOutput', String(error)); }
  }
  async function saveSettings() {
    try {
      const data = await request('/v1/settings/local', {
        method: 'POST', headers: headers(true), body: JSON.stringify({
          local_cache_source_path: document.getElementById('cacheSource').value,
          backup_default_destination: document.getElementById('backupDestination').value,
          backup_allowed_roots: document.getElementById('backupRoots').value,
          ollama_model: document.getElementById('ollamaModel').value,
          restart_service: document.getElementById('restartService').checked
        })
      });
      output('settingsOutput', data);
    } catch (error) { output('settingsOutput', String(error)); }
  }
  async function createBackup() {
    try {
      const destination = document.getElementById('backupDestination').value.trim() || null;
      output('backupOutput', await request('/v1/control/backup', {
        method: 'POST', headers: headers(true), body: JSON.stringify({ destination })
      }));
    } catch (error) { output('backupOutput', String(error)); }
  }
  async function runDoctor() {
    try { output('doctorOutput', await request('/v1/control/doctor', { headers: headers() })); }
    catch (error) { output('doctorOutput', String(error)); }
  }
</script>
</body>
</html>"""


def build_cockpit_router(require_api_key, store, reader, checklist_gateway) -> APIRouter:
    router = APIRouter()

    @router.get("/control", response_class=HTMLResponse)
    async def control_page() -> HTMLResponse:
        return HTMLResponse(
            _CONTROL_HTML,
            headers={"Cache-Control": "no-store"},
        )

    @router.get(
        "/v1/control/status",
        dependencies=[Depends(require_api_key)],
    )
    async def control_status():
        registry_ready = await checklist_gateway.health()
        ollama_ready = await reader.health()
        return {
            "schema": "tcos.instacomp-ai.local-control-status.v2",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "app": settings.app_name,
            "codename": settings.codename,
            "version": settings.version,
            "database": "ready" if store.ready() else "error",
            "ollama": "ready" if ollama_ready else "unavailable",
            "ollama_model": settings.ollama_model,
            "central_registry": "ready" if registry_ready else "not_configured",
            "canonical_identity_authority": "central_checklist_registry",
            "local_cache_is_authoritative": False,
            "seller_mutations_allowed": False,
            "beta_1_0_passed": False,
        }

    @router.get(
        "/v1/control/doctor",
        dependencies=[Depends(require_api_key)],
    )
    async def system_doctor():
        return await run_system_doctor(
            settings,
            store,
            reader,
            checklist_gateway,
        )

    return router
