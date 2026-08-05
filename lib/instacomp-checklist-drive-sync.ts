import { createHash, createSign } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SUPPORTED_MIME_TYPES = new Set([
  "text/csv",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export type ChecklistSyncTrigger = "cron" | "manual";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  md5Checksum?: string;
  parents?: string[];
  webViewLink?: string;
};

function env(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function base64url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function readServiceAccount(): ServiceAccount {
  const raw = env("INSTACOMP_GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON");
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Drive service-account JSON is missing client_email or private_key.");
  }
  return parsed;
}

async function accessToken() {
  const service = readServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: service.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: service.token_uri || TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64url(signer.sign(service.private_key))}`;
  const response = await fetch(service.token_uri || TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Google token request failed (${response.status}).`);
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Google token response did not include an access token.");
  return payload.access_token;
}

function supabase() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function listFolder(token: string, folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,parents,webViewLink)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${DRIVE_API}/files?${params}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`Drive folder listing failed (${response.status}).`);
    const payload = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(payload.files || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return files;
}

async function walkDrive(token: string, roots: string[]) {
  const discovered: DriveFile[] = [];
  const queue = [...roots];
  const visited = new Set<string>();
  while (queue.length) {
    const folderId = queue.shift()!;
    if (visited.has(folderId)) continue;
    visited.add(folderId);
    const children = await listFolder(token, folderId);
    for (const child of children) {
      if (child.mimeType === "application/vnd.google-apps.folder") queue.push(child.id);
      else discovered.push(child);
    }
  }
  return discovered;
}

async function downloadFile(token: string, file: DriveFile) {
  const url = file.mimeType === "application/vnd.google-apps.spreadsheet"
    ? `${DRIVE_API}/files/${file.id}/export?mimeType=text%2Fcsv`
    : `${DRIVE_API}/files/${file.id}?alt=media&supportsAllDrives=true`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Drive download failed for ${file.name} (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function validateChecklistFile(file: DriveFile, bytes: Buffer) {
  const errors: string[] = [];
  if (!SUPPORTED_MIME_TYPES.has(file.mimeType)) errors.push(`unsupported_mime_type:${file.mimeType}`);
  if (!bytes.length) errors.push("empty_file");
  if (bytes.length > 50 * 1024 * 1024) errors.push("file_too_large");
  if (file.mimeType === "text/csv" || file.mimeType === "application/vnd.google-apps.spreadsheet") {
    const header = bytes.subarray(0, Math.min(bytes.length, 16_384)).toString("utf8").split(/\r?\n/, 1)[0].toLowerCase();
    const requiredGroups = [
      ["year", "season"],
      ["set_name", "set", "product"],
      ["card_number", "card #", "number"],
      ["player", "subject", "name"],
    ];
    for (const alternatives of requiredGroups) {
      if (!alternatives.some((value) => header.includes(value))) {
        errors.push(`missing_header_group:${alternatives.join("|")}`);
      }
    }
  }
  return errors;
}

export async function runInstaCompChecklistDriveSync(trigger: ChecklistSyncTrigger) {
  const db = supabase();
  const { data: run, error: runError } = await db
    .from("instacomp_checklist_sync_runs")
    .insert({ trigger_type: trigger, status: "running" })
    .select("id")
    .single();
  if (runError || !run) throw new Error(runError?.message || "Could not create checklist sync run.");

  const counts = { discovered: 0, fresh: 0, changed: 0, unchanged: 0, quarantined: 0, queued: 0 };
  try {
    const roots = env("INSTACOMP_GOOGLE_DRIVE_CHECKLIST_FOLDER_IDS")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const token = await accessToken();
    const files = await walkDrive(token, roots);
    counts.discovered = files.length;

    for (const file of files) {
      const { data: existing } = await db
        .from("instacomp_checklist_drive_files")
        .select("id,modified_time,md5_checksum,content_sha256,sync_status")
        .eq("drive_file_id", file.id)
        .maybeSingle();
      const metadataUnchanged = Boolean(existing) &&
        existing.modified_time === (file.modifiedTime || null) &&
        (existing.md5_checksum || null) === (file.md5Checksum || null);
      if (metadataUnchanged) {
        counts.unchanged += 1;
        await db.from("instacomp_checklist_drive_files").update({
          last_seen_at: new Date().toISOString(),
          sync_status: existing.sync_status === "imported" ? "imported" : "unchanged",
          latest_sync_run_id: run.id,
        }).eq("drive_file_id", file.id);
        continue;
      }

      const bytes = await downloadFile(token, file);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (existing?.content_sha256 === sha256) {
        counts.unchanged += 1;
      } else if (existing) {
        counts.changed += 1;
      } else {
        counts.fresh += 1;
      }
      const errors = validateChecklistFile(file, bytes);
      const status = errors.length ? "quarantined" : "queued";
      if (errors.length) counts.quarantined += 1;
      else counts.queued += 1;
      const row = {
        drive_file_id: file.id,
        parent_folder_id: file.parents?.[0] || null,
        name: file.name,
        mime_type: file.mimeType,
        modified_time: file.modifiedTime || null,
        md5_checksum: file.md5Checksum || null,
        content_sha256: sha256,
        source_url: file.webViewLink || `https://drive.google.com/open?id=${file.id}`,
        last_seen_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        sync_status: status,
        validation_errors: errors,
        latest_sync_run_id: run.id,
      };
      const { error } = await db
        .from("instacomp_checklist_drive_files")
        .upsert(row, { onConflict: "drive_file_id" });
      if (error) throw new Error(error.message);
    }

    await db.from("instacomp_checklist_sync_runs").update({
      status: counts.quarantined ? "partial" : "completed",
      completed_at: new Date().toISOString(),
      files_discovered: counts.discovered,
      files_new: counts.fresh,
      files_changed: counts.changed,
      files_unchanged: counts.unchanged,
      files_quarantined: counts.quarantined,
      files_queued: counts.queued,
      details: { roots },
    }).eq("id", run.id);
    return { ok: true, runId: run.id, ...counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown checklist sync error";
    await db.from("instacomp_checklist_sync_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message.slice(0, 2000),
      files_discovered: counts.discovered,
      files_new: counts.fresh,
      files_changed: counts.changed,
      files_unchanged: counts.unchanged,
      files_quarantined: counts.quarantined,
      files_queued: counts.queued,
    }).eq("id", run.id);
    throw error;
  }
}
