(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = {
    activeLog: "service-out",
    system: null,
    health: null,
    checklist: null,
    backup: null,
  };

  const keyInput = $("#api-key");
  keyInput.value = sessionStorage.getItem("instacomp-ai-key") || "";
  keyInput.addEventListener("input", () => {
    sessionStorage.setItem("instacomp-ai-key", keyInput.value);
  });

  function authHeaders(extra = {}) {
    const key = keyInput.value.trim();
    return key ? { ...extra, "x-instacomp-ai-key": key } : extra;
  }

  async function api(path, options = {}) {
    const headers = authHeaders(options.headers || {});
    const response = await fetch(path, { ...options, headers });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      const detail = typeof body === "object" ? body.detail || body : body;
      const message = typeof detail === "string" ? detail : JSON.stringify(detail);
      const error = new Error(message || `Request failed: ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function setOrb(name, level, text) {
    const orb = $(`#${name}-orb`);
    const label = $(`#${name}-status`);
    orb.className = `status-orb ${level}`;
    label.textContent = text;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
  }

  function formatUptime(seconds) {
    let remaining = Math.max(0, Number(seconds || 0));
    const days = Math.floor(remaining / 86400);
    remaining %= 86400;
    const hours = Math.floor(remaining / 3600);
    remaining %= 3600;
    const minutes = Math.floor(remaining / 60);
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function formatTime(value) {
    if (!value) return "Never";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function compactPath(value) {
    if (!value) return "Not configured";
    const text = String(value);
    return text.length > 90 ? `…${text.slice(-89)}` : text;
  }

  function json(value) {
    return JSON.stringify(value, null, 2);
  }

  function toast(message, type = "info") {
    const stack = $("#toast-stack");
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.textContent = message;
    stack.appendChild(item);
    setTimeout(() => item.remove(), 5200);
  }

  function setBusy(button, busy, busyText) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? busyText : button.dataset.label;
  }

  async function loadAll({ quiet = false } = {}) {
    const button = $("#refresh-all");
    setBusy(button, true, "REFRESHING…");
    const results = await Promise.allSettled([
      api("/health"),
      api("/v1/system/status"),
      api("/v1/checklists/status"),
      api("/v1/backups/status"),
    ]);

    const [health, system, checklist, backup] = results;
    if (health.status === "fulfilled") {
      state.health = health.value;
      renderHealth(health.value);
    } else {
      setOrb("database", "bad", "OFFLINE");
      setOrb("ollama", "bad", "OFFLINE");
    }

    if (system.status === "fulfilled") {
      state.system = system.value;
      renderSystem(system.value);
    }

    if (checklist.status === "fulfilled") {
      state.checklist = checklist.value;
      renderChecklist(checklist.value);
    } else {
      setOrb("registry", "warn", checklist.reason?.status === 401 ? "KEY REQUIRED" : "UNAVAILABLE");
    }

    if (backup.status === "fulfilled") {
      state.backup = backup.value;
      setOrb("backup", "good", "READY");
    } else {
      setOrb("backup", "warn", backup.reason?.status === 401 ? "KEY REQUIRED" : "CHECK CONFIG");
    }

    const rejected = results.filter((result) => result.status === "rejected");
    if (rejected.length && !quiet) {
      const needsKey = rejected.some((result) => result.reason?.status === 401);
      toast(needsKey ? "Enter the configured control key to unlock protected telemetry." : "Some cockpit telemetry could not be loaded.", "error");
    } else if (!quiet) {
      toast("Cockpit telemetry refreshed.", "success");
    }
    setBusy(button, false);
  }

  function renderHealth(data) {
    setOrb("database", data.database === "ready" ? "good" : "bad", String(data.database || "unknown").toUpperCase());
    setOrb("ollama", data.ollama === "ready" ? "good" : "warn", data.ollama === "ready" ? "AI ONLINE" : "AI UNAVAILABLE");
    setOrb("registry", data.checklist === "ready" ? "good" : "warn", data.checklist === "ready" ? "ACTIVE" : "NOT READY");
  }

  function renderSystem(data) {
    $("#uptime").textContent = formatUptime(data.uptime_seconds);
    $("#model-name").textContent = data.ollama?.model || document.body.dataset.model;
    $("#image-count").textContent = Number(data.storage?.image_files || 0).toLocaleString();
    $("#disk-free").textContent = formatBytes(data.storage?.disk_free_bytes);
    $("#service-root").textContent = compactPath(data.paths?.service_root);
    $("#checklist-source").textContent = compactPath(data.paths?.checklist_source);
    $("#latest-backup").textContent = data.latest_backup
      ? `${data.latest_backup.name} · ${formatBytes(data.latest_backup.size_bytes)}`
      : "No full backup detected";
    $("#database-size").textContent = formatBytes(data.storage?.database_bytes);
    $("#registry-size").textContent = formatBytes(data.storage?.registry_bytes);
    $("#images-size").textContent = formatBytes(data.storage?.image_bytes);
    $("#receipt-count").textContent = Number(data.storage?.receipt_files || 0).toLocaleString();

    const message = $("#mission-message");
    if (!data.paths?.checklist_source) {
      message.textContent = "AI core is local. Configure the Google Drive checklist source path to activate automatic Registry missions.";
    } else if (!data.latest_backup) {
      message.textContent = "Checklist source is configured. Create the first full disaster-recovery backup before the first major Registry import.";
    } else {
      message.textContent = "Local command systems are configured. Continue with checklist synchronization and live-card scan validation.";
    }
  }

  function renderChecklist(data) {
    const registry = data.registry || {};
    const sync = data.last_sync || {};
    const rejected = registry.rejected_files || [];
    $("#registry-rows").textContent = Number(registry.imported_rows || 0).toLocaleString();
    $("#registry-files").textContent = Number(sync.files_seen || registry.imported_files || 0).toLocaleString();
    $("#registry-quarantine").textContent = Number(rejected.length || 0).toLocaleString();
    $("#last-sync").textContent = formatTime(sync.created_at || registry.created_at);
    $("#sync-state").textContent = data.sync_running ? "SYNCING" : registry.ready ? "REGISTRY READY" : "AWAITING DATA";
    $("#checklist-output").textContent = json(data);
    setOrb("registry", registry.ready ? "good" : "warn", registry.ready ? "ACTIVE" : "NOT READY");
  }

  async function syncNow() {
    const button = $("#sync-now");
    setBusy(button, true, "SYNCING + REBUILDING…");
    $("#sync-state").textContent = "SYNCING";
    try {
      const result = await api("/v1/checklists/sync", { method: "POST" });
      $("#checklist-output").textContent = json(result);
      toast(result.registry_ready ? "Checklist Registry synchronized and rebuilt." : "Sync finished, but the Registry is not ready yet.", result.registry_ready ? "success" : "error");
      await loadAll({ quiet: true });
    } catch (error) {
      $("#checklist-output").textContent = error.message;
      $("#sync-state").textContent = "SYNC FAILED";
      toast(`Checklist sync failed: ${error.message}`, "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function scanCard(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const front = $("#front-image").files[0];
    const back = $("#back-image").files[0];
    if (!front) {
      toast("Choose a front card image first.", "error");
      return;
    }
    setBusy(button, true, "SCANNING CARD…");
    $("#scan-state").textContent = "AI ANALYSIS ACTIVE";
    const form = new FormData();
    form.append("front", front);
    if (back) form.append("back", back);
    try {
      const result = await api("/v1/scans/analyze", { method: "POST", body: form });
      renderScan(result);
      toast("Card scan completed.", result.pricing_allowed ? "success" : "info");
      await loadAll({ quiet: true });
    } catch (error) {
      $("#scan-output").textContent = error.message;
      $("#scan-state").textContent = "SCAN FAILED";
      toast(`Scan failed: ${error.message}`, "error");
    } finally {
      setBusy(button, false);
    }
  }

  function renderScan(result) {
    const suggestion = result.local_suggestion || {};
    const identity = result.trusted_identity || suggestion.identity || {};
    const confidence = Number(suggestion.confidence || 0);
    const title = [identity.year, identity.player, identity.parallel].filter(Boolean).join(" · ") || "Identity unresolved";
    $("#identity-title").textContent = title;
    $("#identity-player").textContent = identity.player || "—";
    $("#identity-year").textContent = identity.year || "—";
    $("#identity-set").textContent = identity.set_name || "—";
    $("#identity-number").textContent = identity.card_number || "—";
    $("#identity-parallel").textContent = identity.parallel || "—";
    $("#identity-serial").textContent = identity.serial_run ? `/${identity.serial_run}` : identity.serial_number || "—";
    $("#confidence-ring").textContent = confidence ? `${Math.round(confidence * 100)}%` : "—";
    $("#scan-checklist").textContent = String(result.checklist?.outcome || "unknown").replaceAll("_", " ").toUpperCase();
    $("#scan-pricing").textContent = result.pricing_allowed ? "UNLOCKED" : "LOCKED";
    $("#scan-learning").textContent = result.learning_allowed ? "VERIFIED" : "LOCKED";
    $("#scan-state").textContent = String(result.status || "complete").replaceAll("_", " ").toUpperCase();
    $("#scan-output").textContent = json(result);
  }

  async function searchMemory(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const params = new URLSearchParams();
    const fields = {
      player: $("#memory-player").value.trim(),
      year: $("#memory-year").value.trim(),
      set_name: $("#memory-set").value.trim(),
      card_number: $("#memory-number").value.trim(),
    };
    Object.entries(fields).forEach(([key, value]) => value && params.set(key, value));
    if (![...params].length) {
      toast("Enter at least one identity field.", "error");
      return;
    }
    setBusy(button, true, "SEARCHING MEMORY…");
    try {
      const result = await api(`/v1/lessons/search?${params.toString()}`);
      const count = result.matches?.length || 0;
      $("#memory-readout").textContent = count
        ? `${count} trusted memory match${count === 1 ? "" : "es"} found. Highest score: ${Math.round((result.matches[0].score || 0) * 100)}%.`
        : "No trusted memory matched those identity fields.";
      $("#memory-output").textContent = json(result);
    } catch (error) {
      $("#memory-readout").textContent = `Memory search failed: ${error.message}`;
      $("#memory-output").textContent = error.message;
      toast(`Memory search failed: ${error.message}`, "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function createBackup(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const destination = $("#backup-destination").value.trim();
    const label = $("#backup-label").value.trim();
    setBusy(button, true, "BUILDING FULL ARCHIVE…");
    $("#vault-status").textContent = "BACKUP ACTIVE";
    try {
      const result = await api("/v1/backups/full", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination, label }),
      });
      $("#backup-output").textContent = json(result);
      $("#vault-status").textContent = "BACKUP VERIFIED";
      setOrb("backup", "good", "VERIFIED");
      toast(`Full backup created: ${result.archive_path}`, "success");
      await loadAll({ quiet: true });
    } catch (error) {
      $("#backup-output").textContent = error.message;
      $("#vault-status").textContent = "BACKUP FAILED";
      setOrb("backup", "bad", "FAILED");
      toast(`Backup failed: ${error.message}`, "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function loadLog() {
    const output = $("#log-output");
    output.textContent = "Loading flight recorder…";
    try {
      const result = await api(`/v1/system/logs/${state.activeLog}?lines=220`);
      output.textContent = result.lines?.length ? result.lines.join("") : `No entries found in ${result.path}.`;
      output.scrollTop = output.scrollHeight;
    } catch (error) {
      output.textContent = `Could not load log: ${error.message}`;
      toast(`Log load failed: ${error.message}`, "error");
    }
  }

  function bindFileLabel(inputSelector, nameSelector, zoneSelector) {
    const input = $(inputSelector);
    input.addEventListener("change", () => {
      const file = input.files[0];
      $(nameSelector).textContent = file ? `${file.name} · ${formatBytes(file.size)}` : "No file selected";
      $(zoneSelector).classList.toggle("has-file", Boolean(file));
    });
  }

  function setupNavigation() {
    const links = $$(".nav-link");
    const sections = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      links.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`));
    }, { rootMargin: "-15% 0px -70%", threshold: [0.01, 0.2] });
    sections.forEach((section) => observer.observe(section));
  }

  function updateClock() {
    $("#footer-clock").textContent = new Date().toLocaleString();
  }

  $("#refresh-all").addEventListener("click", () => loadAll());
  $("#registry-refresh").addEventListener("click", () => loadAll());
  $("#sync-now").addEventListener("click", syncNow);
  $("#scan-form").addEventListener("submit", scanCard);
  $("#memory-form").addEventListener("submit", searchMemory);
  $("#backup-form").addEventListener("submit", createBackup);
  $("#refresh-log").addEventListener("click", loadLog);
  $$(".log-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeLog = button.dataset.log;
      $$(".log-tab").forEach((item) => item.classList.toggle("active", item === button));
      loadLog();
    });
  });

  bindFileLabel("#front-image", "#front-name", "#front-zone");
  bindFileLabel("#back-image", "#back-name", "#back-zone");
  setupNavigation();
  updateClock();
  setInterval(updateClock, 1000);
  loadAll({ quiet: true });
  loadLog();
  setInterval(() => loadAll({ quiet: true }), 30000);
})();
