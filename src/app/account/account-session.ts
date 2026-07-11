"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STORAGE_KEY = "tcos_account_session";
let refreshClient: SupabaseClient | null = null;
let refreshInFlight: Promise<StoredAccountSession | null> | null = null;

export type StoredAccountSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user?: {
    id?: string;
    email?: string;
  };
};

export function saveAccountSession(session: StoredAccountSession | null) {
  if (!session) return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getAccountSession(): StoredAccountSession | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredAccountSession;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearAccountSession() {
  window.localStorage.removeItem(STORAGE_KEY);
}

function getRefreshClient() {
  if (refreshClient) return refreshClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  refreshClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return refreshClient;
}

export async function getFreshAccountSession(
  minimumValiditySeconds = 5 * 60,
  forceRefresh = false,
): Promise<StoredAccountSession | null> {
  const session = getAccountSession();

  if (!session) return null;

  const expiresAtMs = Number(session.expires_at || 0) * 1000;

  if (
    !forceRefresh &&
    expiresAtMs > 0 &&
    expiresAtMs - Date.now() > minimumValiditySeconds * 1000
  ) {
    return session;
  }

  if (!session.refresh_token) return session;

  const client = getRefreshClient();

  if (!client) return session;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const latestSession = getAccountSession() || session;
      const latestExpiresAtMs = Number(latestSession.expires_at || 0) * 1000;
      const { data, error } = await client.auth.refreshSession({
        refresh_token: latestSession.refresh_token,
      });

      if (error || !data.session) {
        if (latestExpiresAtMs > 0 && latestExpiresAtMs <= Date.now()) {
          clearAccountSession();
          return null;
        }

        return latestSession;
      }

      const refreshed: StoredAccountSession = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        user: {
          id: data.user?.id || latestSession.user?.id,
          email: data.user?.email || latestSession.user?.email,
        },
      };

      saveAccountSession(refreshed);
      return refreshed;
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}
