(() => {
  "use strict";

  function authHeaders() {
    const key = document.querySelector("#api-key")?.value.trim();
    return key ? { "x-instacomp-ai-key": key } : {};
  }

  function buildDoctorConsole() {
    const panel = document.querySelector("#diagnostics");
    if (!panel || document.querySelector("#system-doctor-console")) return null;

    const section = document.createElement("div");
    section.id = "system-doctor-console";
    section.style.marginTop = "22px";
    section.style.padding = "18px";
    section.style.border = "1px solid rgba(69, 192, 255, .3)";
    section.style.borderRadius = "14px";
    section.style.background = "rgba(3, 12, 22, .72)";
    section.innerHTML = `
      <div style="display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <div>
          <p class="panel-code" style="margin:0 0 5px">MISSION READINESS</p>
          <h3 style="margin:0">Mac System Doctor</h3>
        </div>
        <button class="button primary" id="run-system-doctor" type="button">RUN SYSTEM DOCTOR</button>
      </div>
      <div id="doctor-summary" style="margin:16px 0;color:#a9c7d8">Not run yet.</div>
      <pre class="flight-recorder" id="doctor-output" style="min-height:180px;max-height:430px">The doctor checks Python, macOS tools, Ollama, Google Drive source, folder permissions, backups, LaunchAgents, storage, and the desktop app.</pre>
    `;
    panel.appendChild(section);
    return section;
  }

  async function runDoctor() {
    const button = document.querySelector("#run-system-doctor");
    const summary = document.querySelector("#doctor-summary");
    const output = document.querySelector("#doctor-output");
    if (!button || !summary || !output) return;

    const label = button.textContent;
    button.disabled = true;
    button.textContent = "RUNNING DIAGNOSTICS…";
    summary.textContent = "Inspecting the local mission stack…";

    try {
      const response = await fetch("/v1/system/doctor", { headers: authHeaders() });
      const body = await response.json();
      if (!response.ok) {
        const detail = body.detail || body;
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }

      const lines = body.checks.map((check) => {
        const mark = check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✕";
        const repair = check.repair ? `\n    REPAIR: ${check.repair}` : "";
        return `${mark} [${check.status.toUpperCase()}] ${check.id}\n    ${check.message}${repair}`;
      });
      output.textContent = lines.join("\n\n");
      summary.textContent = body.ready
        ? `MISSION READY · ${body.summary.passed} passed · ${body.summary.warnings} warnings · 0 failures`
        : `NOT READY · ${body.summary.passed} passed · ${body.summary.warnings} warnings · ${body.summary.failures} failures`;
      summary.style.color = body.ready ? "#65f0bf" : "#ff8f8f";

      const mission = document.querySelector("#mission-message");
      if (mission && !body.ready) {
        mission.textContent = `System Doctor found ${body.summary.failures} blocking mission-readiness item${body.summary.failures === 1 ? "" : "s"}. Open Diagnostics for repair instructions.`;
      }
    } catch (error) {
      summary.textContent = "SYSTEM DOCTOR FAILED";
      summary.style.color = "#ff8f8f";
      output.textContent = String(error.message || error);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    buildDoctorConsole();
    document.querySelector("#run-system-doctor")?.addEventListener("click", runDoctor);
  });
})();
