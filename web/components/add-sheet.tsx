"use client";

// The mockup's "Add a reel" sheet, wired to POST /api/save. The shell opens it from Home,
// Plans and the saves list, and shows the new save first on Home while it is being read.

import { useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { savedBeforeNote, saveReel } from "@/components/paste-form";
import { useToast } from "@/components/toast";
import { Sheet, SheetContent, SheetHead } from "@/components/ui/sheet";
import { ApiError } from "@/lib/api";
import { canReadClipboard, readClipboardText } from "@/lib/clipboard";
import type { SaveResponse } from "@/lib/types";

const noopSubscribe = () => () => {};
const DID_NOT_SAVE = "That link didn't save. Try again.";

function AddForm({
  isDemo,
  onSaved,
  onNavigate,
}: {
  isDemo: boolean;
  onSaved: (r: SaveResponse) => void;
  onNavigate: () => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clipboardOk = useSyncExternalStore(noopSubscribe, canReadClipboard, () => false);
  const inputId = useId();
  const errorId = useId();

  async function save(input: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await saveReel(input, "web");
      if (r.status === "error" || !r.save_id) {
        setError(r.message || DID_NOT_SAVE);
        return;
      }
      // "You saved this on Oct 3." for a reel that was already here; the server's own
      // words when it could not be read (a private reel, for one).
      const note = savedBeforeNote(r);
      toast.show(note ?? (r.status === "failed" && r.message ? r.message : "Saved. Reading it now."));
      onSaved(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : DID_NOT_SAVE);
    } finally {
      setBusy(false);
    }
  }

  async function pasteFromClipboard() {
    const text = await readClipboardText();
    if (!text) {
      setError("Nothing to paste. Copy a reel's link in Instagram first.");
      return;
    }
    setValue(text);
    await save(text);
  }

  return (
    <>
      <form
        className="paste"
        onSubmit={(e) => {
          e.preventDefault();
          const input = value.trim();
          if (!input) {
            setError("Paste an Instagram reel link first.");
            return;
          }
          void save(input);
        }}
      >
        <label className="vh" htmlFor={inputId}>
          Reel link
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Paste an Instagram reel link"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving" : "Save"}
        </button>
      </form>
      {error && (
        <p id={errorId} role="alert" className="field-error">
          {error}
        </p>
      )}

      {clipboardOk && (
        <div className="sheet-foot" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-block" disabled={busy} onClick={() => void pasteFromClipboard()}>
            <Icon name="paste" />
            Paste the link I copied
          </button>
        </div>
      )}

      <p className="sheet-sub">Where to find the link</p>
      <ol className="how-steps">
        <li>
          <span>
            In Instagram, tap <b>Share</b> on a reel
          </span>
        </li>
        <li>
          <span>
            Tap <b>Copy link</b>
          </span>
        </li>
        <li>
          <span>Come back here and paste it</span>
        </li>
      </ol>

      {isDemo && (
        <p style={{ marginTop: 22 }}>
          <Link href="/demo" className="link" onClick={onNavigate}>
            Try a sample reel
          </Link>
        </p>
      )}
    </>
  );
}

export function AddSheet({
  open,
  onOpenChange,
  isDemo,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDemo: boolean;
  onSaved: (r: SaveResponse) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <SheetHead>Add a reel</SheetHead>
        <AddForm isDemo={isDemo} onSaved={onSaved} onNavigate={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
