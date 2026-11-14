/** Reading the clipboard needs https (or localhost) and a tap; iOS then shows its own Paste prompt. */
export function canReadClipboard(): boolean {
  return typeof navigator !== "undefined" && window.isSecureContext && typeof navigator.clipboard?.readText === "function";
}

/** The clipboard's text, or null when the browser or the person said no. */
export async function readClipboardText(): Promise<string | null> {
  try {
    if (!canReadClipboard()) return null;
    return (await navigator.clipboard.readText()).trim();
  } catch {
    return null;
  }
}

/** Copy text; falls back to a hidden textarea where the Clipboard API is unavailable (plain http). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
