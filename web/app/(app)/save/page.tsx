"use client";

// Save a reel from inside the web app. On an iPhone there is no share-sheet entry for a
// web app, so the way in is: copy the reel's link in Instagram, come here, paste.
// /save?url=<link> saves right away, which is what a bookmark or a one-step Shortcut opens.

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardPaste } from "lucide-react";
import { LiveTicket } from "@/components/live-ticket";
import { PasteForm, savedBeforeNote, saveReel } from "@/components/paste-form";
import { useToast } from "@/components/toast";
import { useTrace } from "@/components/trace";
import { ApiError } from "@/lib/api";
import { canReadClipboard, readClipboardText } from "@/lib/clipboard";
import { useRefresh } from "@/lib/hooks";
import { btnPrimary, pageTitle, sectionTitle } from "@/lib/styles";
import type { SaveResponse } from "@/lib/types";

const noopSubscribe = () => () => {};

function SaveScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const trace = useTrace();
  const refresh = useRefresh();
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clipboardOk = useSyncExternalStore(noopSubscribe, canReadClipboard, () => false);
  const handled = useRef(false);

  function onSaved(r: SaveResponse) {
    const note = savedBeforeNote(r);
    if (note) toast.show(note);
    setSaved((ids) => (ids.includes(r.save_id) ? ids : [r.save_id, ...ids]));
    trace.select(r.save_id);
    refresh();
  }

  async function save(input: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await saveReel(input, "web");
      if (r.status === "error" || !r.save_id) {
        setError(r.message || "That link didn't save. Try again.");
        return;
      }
      onSaved(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That link didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // A link handed over in the address is saved once, then taken out of the address so a
  // reload doesn't save it again.
  const handedOver = params.get("url") ?? params.get("text") ?? "";
  useEffect(() => {
    if (!handedOver || handled.current) return;
    handled.current = true;
    router.replace("/save");
    void save(handedOver);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handedOver]);

  async function pasteFromClipboard() {
    const text = await readClipboardText();
    if (!text) {
      setError("Nothing to paste. Copy a reel's link in Instagram first.");
      return;
    }
    await save(text);
  }

  return (
    <div>
      <h1 className={pageTitle}>Save a reel</h1>
      <p className="mt-1 text-[15px] text-muted">In Instagram, tap Share, then Copy link. Then paste it here.</p>

      <div className="mt-5">
        {clipboardOk && (
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void pasteFromClipboard()}>
            <ClipboardPaste aria-hidden="true" className="size-5" />
            {busy ? "Saving" : "Paste the link I copied"}
          </button>
        )}
        {error && (
          <p role="alert" className="mt-2 text-[14px] text-danger-ink">
            {error}
          </p>
        )}
        <div className={clipboardOk ? "mt-5 border-t border-line pt-5" : undefined}>
          <PasteForm
            label={clipboardOk ? "Or type or paste it" : "Instagram reel link"}
            button="Save it"
            primary={!clipboardOk}
            helper="Takes 10 to 30 seconds to read."
            onSaved={(r) => {
              setError(null);
              onSaved(r);
            }}
          />
        </div>
      </div>

      {saved.length > 0 && (
        <section className="mt-6" aria-live="polite">
          <h2 className={sectionTitle}>Just saved</h2>
          <div className="mt-3 flex flex-col gap-4">
            {saved.map((id) => (
              <LiveTicket key={id} saveId={id} href={`/s/${id}`} traceLink />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function SavePage() {
  // useSearchParams needs a Suspense boundary so the rest of the shell can prerender.
  return (
    <Suspense fallback={<h1 className={pageTitle}>Save a reel</h1>}>
      <SaveScreen />
    </Suspense>
  );
}
