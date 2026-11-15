"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetcher, getKey } from "./api";
import type { AppConfig, Health, Me, SaveDetail } from "./types";

// ---- the API key in localStorage ----

function subscribeKey(cb: () => void): () => void {
  window.addEventListener("rl-key", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("rl-key", cb);
    window.removeEventListener("storage", cb);
  };
}

/** undefined while rendering on the server or hydrating, null when signed out, else the key. */
export function useKey(): string | null | undefined {
  return useSyncExternalStore<string | null | undefined>(subscribeKey, getKey, () => undefined);
}

// ---- runtime config (the app name never comes from this file) ----

export function useConfig(): { config: AppConfig | undefined; appName: string } {
  const { data } = useSWR<AppConfig>("/api/config", fetcher, { revalidateOnFocus: false });
  // "Reelize" is only the loading fallback; the real name is GET /api/config app_name.
  return { config: data, appName: data?.app_name ?? "Reelize" };
}

export function useMe(enabled = true) {
  return useSWR<Me>(enabled ? "/api/me" : null, fetcher);
}

export function useHealth(enabled = true) {
  return useSWR<Health>(enabled ? "/api/health" : null, fetcher, { refreshInterval: 30000 });
}

// ---- one save, polled per SPEC 13.4 ----

export function pollInterval(processing: string | undefined): number {
  if (processing === "queued" || processing === "reading" || processing === "planning") return 700;
  if (processing === "planned" || processing === "enriching") return 3000;
  return 0;
}

export function useSaveDetail(saveId: string | null | undefined) {
  return useSWR<SaveDetail>(saveId ? `/api/saves/${saveId}` : null, fetcher, {
    refreshInterval: (latest) => pollInterval(latest?.ticket.processing),
    // SWR drops repeat requests inside its deduping window (2 s by default), which would
    // stretch the 700 ms poll to about 2 s.
    dedupingInterval: 500,
  });
}

/**
 * Revalidate every list after a change, without clearing what's on screen. `except` is a
 * key to leave alone: the save that was just deleted, which would only answer 404.
 */
export function useRefresh(): (except?: unknown) => void {
  const { mutate } = useSWRConfig();
  return useCallback(
    (except?: unknown) => {
      void mutate(
        (key) =>
          typeof key === "string" &&
          key.startsWith("/api/") &&
          key !== except &&
          key !== "/api/config" &&
          key !== "/api/health" &&
          key !== "/api/demo/hero",
      );
    },
    [mutate],
  );
}

// ---- media queries and device ----

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export type Device = "ios" | "android" | "desktop";

function readDevice(): Device {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

const noopSubscribe = () => () => {};

export function useDevice(): Device | undefined {
  return useSyncExternalStore<Device | undefined>(noopSubscribe, readDevice, () => undefined);
}

export function readStandalone(): boolean {
  // iOS Safari reports a Home Screen web app through navigator.standalone.
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

/** True when the app was opened from the Home Screen icon, undefined until hydrated. */
export function useStandalone(): boolean | undefined {
  return useSyncExternalStore<boolean | undefined>(noopSubscribe, readStandalone, () => undefined);
}

/** Seconds since an ISO time, ticking once a second while active. */
export function useElapsed(active: boolean, sinceIso: string | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  if (!active || !sinceIso) return 0;
  const since = Date.parse(sinceIso);
  if (Number.isNaN(since)) return 0;
  return Math.max(0, (now - since) / 1000);
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
