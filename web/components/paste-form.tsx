"use client";

// Paste a reel link: POST /api/save with source "web" and wait 0, then the caller follows
// the save with a LiveTicket. Used on Samples, in the Library paste sheet and on Android setup.

import { useId, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { btnOutline, btnPrimary, inputBase } from "@/lib/styles";
import type { SaveResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

export async function saveReel(input: string, source: "web" | "sample"): Promise<SaveResponse> {
  return api<SaveResponse>("/api/save", { body: { input, source, wait: 0 } });
}

/**
 * "You saved this on Oct 3." when the reel was already in the library. The API says so at
 * the start of `message` (status duplicate) or of the re-sent proposal prompt.
 */
export function savedBeforeNote(r: SaveResponse): string | null {
  const m = /^You saved this on [^.]+\./.exec(r.message || r.prompt || "");
  return m ? m[0] : null;
}

export function PasteForm({
  label,
  button,
  helper,
  primary = false,
  onSaved,
}: {
  label: string;
  button: string;
  helper?: string;
  primary?: boolean;
  /** Called for every handled outcome that has a save (proposed, pending, duplicate, failed). */
  onSaved: (r: SaveResponse) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();

  async function submit() {
    const input = value.trim();
    if (!input) {
      setError("Paste an Instagram reel link first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await saveReel(input, "web");
      if (r.status === "error" || !r.save_id) {
        setError(r.message || "That link didn't save. Try again.");
        return;
      }
      setValue("");
      onSaved(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That link didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const describedBy = [error ? errorId : null, helper ? helpId : null].filter(Boolean).join(" ") || undefined;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={inputId} className="block text-[15px] font-medium text-ink">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className={cn(inputBase, "mt-2 w-full")}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-[14px] text-danger-ink">
          {error}
        </p>
      )}
      <button type="submit" className={cn(primary ? btnPrimary : cn(btnOutline, "w-full"), "mt-3")} disabled={busy}>
        {button}
      </button>
      {helper && (
        <p id={helpId} className="mt-2 text-[13px] text-muted">
          {helper}
        </p>
      )}
    </form>
  );
}
