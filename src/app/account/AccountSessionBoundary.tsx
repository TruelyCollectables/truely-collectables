"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  ACCOUNT_SESSION_CHANGE_EVENT,
  getAccountSession,
  getFreshAccountSession,
  type StoredAccountSession,
} from "./account-session";

const REFRESH_AHEAD_SECONDS = 5 * 60;
const MIN_RETRY_MS = 15_000;
const MAX_TIMER_MS = 2_147_000_000;

function sessionVersion(session: StoredAccountSession | null) {
  if (!session?.access_token) return "guest";
  return `${session.user?.id || "account"}:${session.expires_at || 0}:${session.access_token.slice(-24)}`;
}

function nextRefreshDelay(session: StoredAccountSession | null) {
  if (!session?.refresh_token) return null;

  const expiresAtMs = Number(session.expires_at || 0) * 1000;
  if (expiresAtMs <= 0) return MIN_RETRY_MS;

  return Math.min(
    MAX_TIMER_MS,
    Math.max(
      MIN_RETRY_MS,
      expiresAtMs - Date.now() - REFRESH_AHEAD_SECONDS * 1000,
    ),
  );
}

export default function AccountSessionBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState("initial");

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    function cancelTimer() {
      if (!refreshTimer) return;
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }

    function scheduleRefresh(session: StoredAccountSession | null) {
      cancelTimer();
      const delay = nextRefreshDelay(session);
      if (delay == null) return;

      refreshTimer = setTimeout(() => {
        void refreshSession(true);
      }, delay);
    }

    function applySession(session: StoredAccountSession | null) {
      if (cancelled) return;
      setVersion(sessionVersion(session));
      scheduleRefresh(session);
      setReady(true);
    }

    async function refreshSession(forceRefresh = false) {
      try {
        applySession(
          await getFreshAccountSession(REFRESH_AHEAD_SECONDS, forceRefresh),
        );
      } catch {
        applySession(getAccountSession());
      }
    }

    function handleSessionChange() {
      applySession(getAccountSession());
    }

    window.addEventListener(
      ACCOUNT_SESSION_CHANGE_EVENT,
      handleSessionChange,
    );
    void refreshSession(false);

    return () => {
      cancelled = true;
      cancelTimer();
      window.removeEventListener(
        ACCOUNT_SESSION_CHANGE_EVENT,
        handleSessionChange,
      );
    };
  }, []);

  if (!ready) {
    return (
      <div
        className="mx-auto w-full max-w-5xl px-4 py-8 font-semibold text-neutral-600 sm:px-6"
        aria-live="polite"
      >
        Checking your account…
      </div>
    );
  }

  return (
    <div key={version} className="contents">
      {children}
    </div>
  );
}
