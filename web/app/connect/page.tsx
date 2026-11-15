"use client";

// /connect hands this account's key to the iPhone Shortcut. The ready-made Shortcut opens it
// (with the reel's link as ?url=) when it has no key yet and the clipboard didn't hold one,
// or when its key stopped working. The reel is saved here right away, so it isn't lost, and
// "Connect the Shortcut" runs the Shortcut once with the key, which it keeps in a file.

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LiveTicket } from "@/components/live-ticket";
import { saveReel } from "@/components/paste-form";
import { ApiError } from "@/lib/api";
import { useConfig, useKey, useMe } from "@/lib/hooks";
import { connectShortcutUrl, shortcutKeyFor } from "@/lib/shortcut";
import { btnOutline, btnPrimary, linkInk, pageTitle, sectionTitle } from "@/lib/styles";
import { cn } from "@/lib/utils";

function ConnectScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const key = useKey();
  const { appName } = useConfig();
  const { data: me } = useMe(Boolean(key));
  const [shortcutKey, setShortcutKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const handled = useRef(false);
  const reel = params.get("url") ?? "";
  const signedIn = Boolean(key && me && !me.is_demo);

  // One key per visit. Reloading reuses it, since shortcutKeyFor keeps the one it made.
  useEffect(() => {
    if (!signedIn || !key || !me) return;
    let live = true;
    shortcutKeyFor(key, me.user_id).then(
      (k) => live && setShortcutKey(k),
      (e) => live && setKeyError(e instanceof ApiError ? e.message : "Your key wasn't made. Reload to try again."),
    );
    return () => {
      live = false;
    };
  }, [signedIn, key, me]);

  // The reel the Shortcut was holding: saved once, then taken out of the address.
  useEffect(() => {
    if (!signedIn || !reel || handled.current) return;
    handled.current = true;
    router.replace("/connect");
    saveReel(reel, "web").then(
      (r) => {
        if (r.status === "error" || !r.save_id) setSaveNote(r.message || "That reel didn't save. Share it again after connecting.");
        else setSavedId(r.save_id);
      },
      () => setSaveNote("That reel didn't save. Share it again after connecting."),
    );
  }, [signedIn, reel, router]);

  const next = `/connect${reel ? `?url=${encodeURIComponent(reel)}` : ""}`;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[440px] px-4 pb-10">
      <header className="flex h-14 items-center">
        <Link href={signedIn ? "/home" : "/"} className="wide inline-flex min-h-11 items-center rounded-[4px] text-[20px] leading-none text-ink">
          {appName}
        </Link>
      </header>
      <main className="pt-2">
        <h1 className={pageTitle}>Connect the Shortcut</h1>
        {key === undefined || (key && me === undefined) ? null : !signedIn ? (
          <>
            <p className="mt-3 text-[16px] text-ink">Sign in first, so your reels go to your own account.</p>
            <Link href={`/login?next=${encodeURIComponent(next)}`} className={cn(btnPrimary, "mt-4")}>
              Sign in
            </Link>
            <Link href="/signup" className={cn(btnOutline, "mt-3 w-full")}>
              Create an account
            </Link>
          </>
        ) : (
          <>
            <p className="mt-3 text-[16px] text-ink">
              One tap gives the {appName} Shortcut your key. After that, reels you share from Instagram save in the
              background.
            </p>
            {shortcutKey ? (
              <a className={cn(btnPrimary, "mt-5 w-full")} href={connectShortcutUrl(appName, shortcutKey)}>
                Connect the Shortcut
              </a>
            ) : (
              <button type="button" className={cn(btnPrimary, "mt-5 w-full")} disabled>
                Getting your key
              </button>
            )}
            {keyError && (
              <p role="alert" className="mt-2 text-[14px] text-danger-ink">
                {keyError}
              </p>
            )}
            <p className="mt-3 text-[14px] text-muted">
              The Shortcuts app opens, runs {appName} once and says Connected. If it says it can&apos;t find the
              Shortcut, add it first on the{" "}
              <Link href="/setup" className={linkInk}>
                setup page
              </Link>
              .
            </p>
            {(savedId || saveNote) && (
              <section className="mt-6" aria-live="polite">
                <h2 className={sectionTitle}>The reel you shared</h2>
                {savedId ? (
                  <div className="mt-3">
                    <LiveTicket saveId={savedId} href={`/s/${savedId}`} />
                  </div>
                ) : (
                  <p className="mt-2 text-[14px] text-muted">{saveNote}</p>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function ConnectPage() {
  // useSearchParams needs a Suspense boundary so the page can prerender.
  return (
    <Suspense fallback={null}>
      <ConnectScreen />
    </Suspense>
  );
}
