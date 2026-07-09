"use client";

const STORAGE_KEY = "tcos_account_session";

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
