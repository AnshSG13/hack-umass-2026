// Fetch wrapper: adds the Bearer key from localStorage and turns error bodies into messages.
// Every runtime value (app name, URLs) comes from GET /api/config, never from this file.

import type { ChatEvent } from "./types";

const KEY = "rl_key";

export function getKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setKey(key: string): void {
  window.localStorage.setItem(KEY, key);
  window.dispatchEvent(new Event("rl-key"));
}

export function clearKey(): void {
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("rl-key"));
}

/** An API key (rl_...) rather than a session from signing in with an email and password. */
export function isApiKey(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith("rl_"));
}

/** End the session on the server (best effort), then forget it here. */
export async function signOut(): Promise<void> {
  const key = getKey();
  if (key && !isApiKey(key)) {
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${key}` } });
    } catch {
      /* signed out here either way */
    }
  }
  clearKey();
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function headers(json: boolean, withKey = true): HeadersInit {
  const h: Record<string, string> = {};
  const key = withKey ? getKey() : null;
  if (key) h.Authorization = `Bearer ${key}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

/** `anonymous`: leave the key out, for pages a link opens for someone with no account. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; anonymous?: boolean } = {},
): Promise<T> {
  const hasBody = init.body !== undefined;
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (hasBody ? "POST" : "GET"),
      headers: headers(hasBody, !init.anonymous),
      body: hasBody ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Check your connection.");
  }
  if (!res.ok) {
    let message = "Something went wrong. Try again.";
    try {
      const data = await res.json();
      if (data && typeof data.message === "string") message = data.message;
    } catch {
      /* keep the default */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// SWR fetcher: the key is the path.
export const fetcher = <T,>(path: string) => api<T>(path);

// The same, without the key: public pages opened by a share link.
export const publicFetcher = <T,>(path: string) => api<T>(path, { anonymous: true });

// POST /api/chat answers with NDJSON; call onEvent for each line as it arrives.
export async function chatStream(
  body: { message: string; history: { role: "user" | "assistant"; text: string }[]; chat_id?: string },
  onEvent: (e: ChatEvent) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat", { method: "POST", headers: headers(true), body: JSON.stringify(body) });
  } catch {
    onEvent({ type: "error", message: "Ask didn't answer. Try again." });
    return;
  }
  if (!res.ok || !res.body) {
    let message = "Ask didn't answer. Try again.";
    try {
      const data = await res.json();
      if (data && typeof data.message === "string") message = data.message;
    } catch {
      /* keep the default */
    }
    onEvent({ type: "error", message });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as ChatEvent);
      } catch {
        /* skip a malformed line */
      }
    }
  }
}
