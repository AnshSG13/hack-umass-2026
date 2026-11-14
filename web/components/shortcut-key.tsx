"use client";

// The key the iPhone Shortcut sends with each reel. An email account signs in with its
// password, so it never needed a key on the web; the Shortcut still does. The first time,
// getting one is a single tap. After that, making another replaces the one already pasted
// into a Shortcut, so that path asks first.

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/toast";
import { api, ApiError, getKey, isApiKey, setKey } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { btnOutline, btnPrimary, btnText, sectionTitle } from "@/lib/styles";
import type { Me } from "@/lib/types";
import { cn } from "@/lib/utils";

function CopyButton({ value, label = "Copy key", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn(btnOutline, "w-full", className)}
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 3000);
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}

export function ShortcutKey({ me, className }: { me: Me; className?: string }) {
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const onChanged = () => void mutate("/api/me");
  const [shown, setShown] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedInWithKey = isApiKey(getKey());
  const current = signedInWithKey ? getKey() : null;
  // An email account that has never been shown a key: getting one replaces nothing.
  const firstTime = !signedInWithKey && !me.shortcut_key;

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ api_key: string }>("/api/me/key", { method: "POST" });
      if (signedInWithKey) setKey(r.api_key);
      setShown(r.api_key);
      setConfirm(false);
      onChanged();
      toast.show(firstTime ? "Here's your Shortcut key." : "New key made. Paste it into your Shortcut.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The key wasn't made. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cn("rounded-[16px] border border-line bg-ticket p-4", className)} aria-labelledby="shortcut-key-h">
      <h2 id="shortcut-key-h" className={sectionTitle}>
        Shortcut key
      </h2>
      <p className="mt-1 text-[14px] text-muted">
        {signedInWithKey
          ? "This key is your account. The Shortcut sends it with each reel."
          : "The iPhone Shortcut sends this with each reel so it lands in your account. Signing in here doesn't need it."}
      </p>

      {shown ? (
        <div className="mt-3">
          <p className="rounded-[12px] border border-line bg-paper px-3 py-2 text-[16px] font-medium break-all text-ink">
            {shown}
          </p>
          <CopyButton value={shown} className="mt-2" />
          <p className="mt-2 text-[14px] text-muted">
            {signedInWithKey
              ? "Your old key stopped working. Paste this one into your Shortcut."
              : "It's shown once. Paste it into your Shortcut where it asks for a key."}
          </p>
        </div>
      ) : firstTime ? (
        <button type="button" className={cn(btnPrimary, "mt-3")} disabled={busy} onClick={() => void make()}>
          {busy ? "Making your key" : "Get my Shortcut key"}
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[15px] text-ink">
            Key ending <span className="font-semibold">{me.key_preview}</span>
          </p>
          {current && <CopyButton value={current} />}
          <button type="button" className={cn(btnOutline, "w-full")} onClick={() => setConfirm(true)}>
            {signedInWithKey ? "Make a new key" : "Get a new Shortcut key"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[14px] text-danger-ink">
          {error}
        </p>
      )}

      <Sheet open={confirm} onOpenChange={setConfirm}>
        <SheetContent>
          <SheetTitle>{signedInWithKey ? "Make a new key" : "Get a new Shortcut key"}</SheetTitle>
          <SheetDescription>
            The key ending {me.key_preview} stops working. Any Shortcut that uses it needs the new one pasted in.
          </SheetDescription>
          <button type="button" className={cn(btnPrimary, "mt-5")} disabled={busy} onClick={() => void make()}>
            Make a new key
          </button>
          <button type="button" className={cn(btnText, "mt-1 w-full")} onClick={() => setConfirm(false)}>
            Keep the current key
          </button>
        </SheetContent>
      </Sheet>
    </section>
  );
}
