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

/**
 * Copy text that is still on its way (a key being made). Safari only lets a page write to
 * the clipboard during a tap, so the write starts now with a promise for the text, which
 * Safari and Chrome both accept. Falls back to copying once the text arrives.
 */
export async function copyWhenReady(text: Promise<string>): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    return await copyText(await text);
  } catch {
    return false;
  }
}
