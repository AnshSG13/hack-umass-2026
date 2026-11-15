// The key the iPhone Shortcut keeps. The ready-made Shortcut stores it in a file the first
// time it runs, read from the clipboard ("Add the Shortcut" on /setup copies it) or handed
// over by /connect, so nobody types or pastes a key.

import { api, isApiKey } from "./api";

const STORE = "rl_shortcut_key:";

function cached(userId: string): string | null {
  try {
    return window.localStorage.getItem(STORE + userId);
  } catch {
    return null;
  }
}

/** Whether this browser made a Shortcut key for the account before. */
export function hasCachedKey(userId: string): boolean {
  return cached(userId) !== null;
}

/** Remember a Shortcut key this browser made, per account, so the next tap reuses it. */
export function rememberShortcutKey(userId: string, key: string): void {
  try {
    window.localStorage.setItem(STORE + userId, key);
  } catch {
    /* private mode: the next tap makes a new key, which still works */
  }
}

async function stillWorks(key: string, userId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
    if (!res.ok) return false;
    const me = (await res.json()) as { user_id?: string };
    return me.user_id === userId;
  } catch {
    return false;
  }
}

/**
 * A key that works for this account. An account signed in with a key uses that key. An email
 * account reuses the key this browser made earlier while it still works, and otherwise gets
 * a new one, which stops any older key.
 */
export async function shortcutKeyFor(accountKey: string, userId: string): Promise<string> {
  if (isApiKey(accountKey)) return accountKey;
  const known = cached(userId);
  if (known && (await stillWorks(known, userId))) return known;
  const r = await api<{ api_key: string }>("/api/me/key", { method: "POST" });
  rememberShortcutKey(userId, r.api_key);
  return r.api_key;
}

/** Opens the Shortcuts app and runs the Shortcut once with the key, which it then saves. */
export function connectShortcutUrl(shortcutName: string, key: string): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}&input=text&text=${encodeURIComponent(key)}`;
}
