"use client";

// Setup (DESIGN.md 7.3, SPEC 13.2): make an account, carry the key to the phone with a QR
// code, add the Shortcut, and watch for the first save.

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { QRCodeSVG } from "qrcode.react";
import { LiveTicket } from "@/components/live-ticket";
import { PasteForm } from "@/components/paste-form";
import { ToastViewport } from "@/components/toast";
import { api, ApiError, fetcher, getKey, setKey } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { browserTimezone, readStandalone, useConfig, useDevice, useKey, useMe, useStandalone } from "@/lib/hooks";
import { btnOutline, btnPrimary, inputBase, linkInk, pageTitle, sectionTitle } from "@/lib/styles";
import type { SavesPage } from "@/lib/types";
import { cn } from "@/lib/utils";

const KEY_SHAPE = /^[A-Za-z0-9_\-.~]{12,128}$/;
const noopSubscribe = () => () => {};

function CopyKeyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn(btnOutline, className)}
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 3000);
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copied" : "Copy key"}</span>
    </button>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="wide tabular w-6 shrink-0 text-[20px] leading-[1.4] text-ink">
        {n}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

/** Everything that depends on one account; remounted when the key changes. */
function Account({ accountKey }: { accountKey: string }) {
  const { config, appName } = useConfig();
  const device = useDevice();
  const standalone = useStandalone();
  const { mutate, data: latest } = useSWR<SavesPage>("/api/saves?limit=1", fetcher, {
    refreshInterval: 3000,
  });

  // The newest save when the page loaded; anything newer is the first save from the phone.
  const [baseline, setBaseline] = useState<string | null | undefined>(undefined);
  if (latest && baseline === undefined) setBaseline(latest.items[0]?.save_id ?? null);
  const newest = latest?.items[0];
  const firstSave = baseline !== undefined && newest && newest.save_id !== baseline ? newest : null;

  const keyBox = (withButton: boolean) => (
    <section className="rounded-[16px] border border-line bg-ticket p-4" aria-label="Your key">
      <p className="text-[16px] font-medium break-all text-ink">{accountKey}</p>
      {withButton && <CopyKeyButton value={accountKey} className="mt-3 w-full" />}
      <p className="mt-3 text-[14px] text-muted">Keep this. It&apos;s your account. There&apos;s no password.</p>
    </section>
  );

  const firstSaveBlock = firstSave ? (
    <section className="mt-6" aria-live="polite">
      <h2 className={sectionTitle}>Got your first save!</h2>
      <div className="mt-3">
        <LiveTicket saveId={firstSave.save_id} initial={firstSave} />
      </div>
    </section>
  ) : null;

  const openApp = (
    <p className="mt-6">
      <Link href="/home" className={cn(linkInk, "inline-flex min-h-11 items-center text-[16px]")}>
        Open {appName}
      </Link>
    </p>
  );

  // A Home Screen web app on iOS gets its own storage, so it would open signed out. While
  // this page is open in Safari the key rides in the link's fragment; "Add to Home Screen"
  // keeps that link, and the installed app reads the key from it on first launch.
  useEffect(() => {
    if (device !== "ios" || standalone !== false) return;
    window.history.replaceState(null, "", `${window.location.pathname}#k=${encodeURIComponent(accountKey)}`);
  }, [device, standalone, accountKey]);

  if (device === undefined || standalone === undefined) return null;

  if (device === "desktop") {
    const qrValue = config ? `${config.public_base_url}/setup#k=${accountKey}` : null;
    return (
      <>
        {keyBox(true)}
        <section className="mt-6">
          <h2 className={sectionTitle}>Open this on your iPhone</h2>
          <div className="mt-3 inline-block rounded-[16px] border border-line bg-ticket p-4">
            {qrValue ? (
              <QRCodeSVG
                value={qrValue}
                size={200}
                fgColor="#1B2430"
                bgColor="#FFFFFF"
                level="M"
                title="QR code that opens this setup page on your phone with your key"
              />
            ) : (
              <span aria-hidden="true" className="block size-[200px] bg-paper" />
            )}
          </div>
          <p className="mt-3 text-[14px] text-muted">Or copy the key and open this page on your phone.</p>
        </section>
        {firstSaveBlock}
        {openApp}
      </>
    );
  }

  if (device === "android") {
    return (
      <>
        {keyBox(true)}
        <section className="mt-6">
          <p className="text-[16px] text-ink">{appName} works on iPhone for now. Paste reel links here instead.</p>
          <div className="mt-4">
            <PasteForm label="Instagram reel link" button="Save it" primary onSaved={() => void mutate()} />
          </div>
        </section>
        {firstSaveBlock}
        {openApp}
      </>
    );
  }

  // iPhone: the web app is the product. Add it to the Home Screen, then save by pasting a
  // reel's link. The Shortcut, when its link is configured, is an extra.
  const reelUrl = config?.first_save_reel_url || "";
  const shortcutUrl = config?.shortcut_url || "";
  const installed = standalone === true;
  const base = installed ? 0 : 1;
  return (
    <>
      <ol className="flex flex-col gap-6">
        {!installed && (
          <Step n={1}>
            <p className="text-[16px] text-ink">Put {appName} on your Home Screen</p>
            <p className="mt-1 text-[14px] text-muted">
              In Safari, tap the Share button, then Add to Home Screen. It opens signed in to this account.
            </p>
          </Step>
        )}
        <Step n={base + 1}>
          <p className="text-[16px] text-ink">Copy a reel&apos;s link</p>
          <p className="mt-1 text-[14px] text-muted">In Instagram, tap Share on a reel, then Copy link.</p>
          {reelUrl && (
            <a className={cn(btnOutline, "mt-2")} href={reelUrl} target="_blank" rel="noopener noreferrer">
              Open a reel to try
            </a>
          )}
        </Step>
        <Step n={base + 2}>
          <PasteForm label="Paste it here" button="Save it" primary onSaved={() => void mutate()} />
        </Step>
      </ol>
      {firstSaveBlock}
      {openApp}
      <ShortcutHelp appName={appName} shortcutUrl={shortcutUrl} />
      <div className="mt-6">{keyBox(true)}</div>
    </>
  );
}

/**
 * The optional Shortcut. A web app can't sit in Instagram's Share menu, a Shortcut can. The
 * one built here has a single action: it opens this app's /save page with the reel's link,
 * so it needs no key and the plan shows up as a ticket like any other save.
 */
function ShortcutHelp({ appName, shortcutUrl }: { appName: string; shortcutUrl: string }) {
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
  const [copied, setCopied] = useState(false);
  const address = `${origin}/save?url=`;

  return (
    <details className="mt-6 rounded-[16px] border border-line bg-ticket px-4">
      <summary className="flex min-h-12 cursor-pointer items-center text-[16px] font-medium text-ink">
        Save straight from Instagram&apos;s Share menu
      </summary>
      <div className="pb-4">
        <p className="text-[14px] text-muted">
          Optional. A Shortcut with one action sends the reel here, so you skip the copy and paste.
        </p>
        <ol className="mt-4 flex flex-col gap-5">
          <Step n={1}>
            <p className="text-[16px] text-ink">Copy this address</p>
            <p className="mt-2 rounded-[12px] border border-line bg-paper px-3 py-2 text-[14px] break-all text-ink">
              {address}
            </p>
            <button
              type="button"
              className={cn(btnOutline, "mt-2")}
              onClick={async () => {
                if (await copyText(address)) {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 3000);
                }
              }}
            >
              <span aria-live="polite">{copied ? "Copied" : "Copy address"}</span>
            </button>
          </Step>
          <Step n={2}>
            <p className="text-[16px] text-ink">Make the Shortcut</p>
            <p className="mt-1 text-[14px] text-muted">
              Open the Shortcuts app and tap +. Add the action Open URLs and paste the address into it.
            </p>
          </Step>
          <Step n={3}>
            <p className="text-[16px] text-ink">Add the reel&apos;s link to the end</p>
            <p className="mt-1 text-[14px] text-muted">
              With the cursor right after the = sign, tap Shortcut Input in the row above the keyboard.
            </p>
          </Step>
          <Step n={4}>
            <p className="text-[16px] text-ink">Show it in the Share menu</p>
            <p className="mt-1 text-[14px] text-muted">
              Tap the info button, turn on Show in Share Sheet, and name the Shortcut {appName}.
            </p>
          </Step>
          <Step n={5}>
            <p className="text-[16px] text-ink">Try it</p>
            <p className="mt-1 text-[14px] text-muted">
              In Instagram, tap Share on a reel, open the share sheet and tap {appName}. Safari opens here and the
              reel is saved. It uses the account you&apos;re signed in to in Safari.
            </p>
          </Step>
        </ol>
        {shortcutUrl && (
          <p className="mt-5 text-[14px] text-muted">
            There is also a ready-made Shortcut that shows the plan as a menu and adds it to Calendar and Reminders.{" "}
            <a className={linkInk} href={shortcutUrl}>
              Add that Shortcut
            </a>
            . When it asks for your key, paste it.
          </p>
        )}
      </div>
    </details>
  );
}

/** Sign in on a new device or browser with a key made earlier. */
function UseKeyForm() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  async function submit() {
    const candidate = value.trim();
    if (!KEY_SHAPE.test(candidate)) {
      setError("That doesn't look like a key. Paste the whole thing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${candidate}` }, cache: "no-store" });
      if (res.ok) setKey(candidate);
      else setError(res.status === 401 ? "That key didn't work. Check it and try again." : "Couldn't check the key. Try again.");
    } catch {
      setError("Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-8 border-t border-line pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={inputId} className="block text-[15px] font-medium text-ink">
        Already have a key?
      </label>
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn(inputBase, "mt-2 w-full")}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
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
      <button type="submit" className={cn(btnOutline, "mt-3 w-full")} disabled={busy}>
        Use this key
      </button>
    </form>
  );
}

export default function SetupPage() {
  const key = useKey();
  const router = useRouter();
  const { config, appName } = useConfig();
  const { data: me } = useMe(Boolean(key));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The key can arrive in the link's fragment: from the laptop's QR code (SPEC 13.2), or
  // from the Home Screen icon, which keeps the link this page had when it was added.
  useEffect(() => {
    const m = window.location.hash.match(/^#k=(.+)$/);
    if (!m) return;
    let carried = "";
    try {
      carried = decodeURIComponent(m[1]);
    } catch {
      /* not a key */
    }
    const valid = KEY_SHAPE.test(carried);
    if (readStandalone()) {
      // The icon's link never changes, so a key already stored here (a newer one, after
      // "New key" in Settings) wins over the one in the link.
      if (valid && getKey() === null) setKey(carried);
      if (getKey() !== null) router.replace("/home");
      return;
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (valid) setKey(carried);
  }, [router]);

  async function createAccount() {
    setCreating(true);
    setError(null);
    try {
      const r = await api<{ user_id: string; api_key: string }>("/api/users", {
        body: { timezone: browserTimezone() },
      });
      setKey(r.api_key);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The account wasn't created. Try again.");
    } finally {
      setCreating(false);
    }
  }

  const isDemo = Boolean(me?.is_demo);
  const waitingOnMe = Boolean(key) && me === undefined;
  const needsAccount = key === null || isDemo;
  const judgeUrl = config?.judge_shortcut_url || "";

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[440px] px-4 pb-10">
      <header className="flex h-14 items-center">
        <Link href={key && !isDemo ? "/home" : "/"} className="wide inline-flex min-h-11 items-center rounded-[4px] text-[20px] leading-none text-ink">
          {appName}
        </Link>
      </header>
      <main className="pt-2">
        <h1 className={pageTitle}>Set up on iPhone</h1>
        <div className="mt-5">
          {key === undefined || waitingOnMe ? null : needsAccount ? (
            <>
              <button type="button" className={btnPrimary} disabled={creating} onClick={() => void createAccount()}>
                Create my account
              </button>
              {error && (
                <p role="alert" className="mt-2 text-[14px] text-danger-ink">
                  {error}
                </p>
              )}
              {isDemo && (
                <p className="mt-5 text-[15px] text-ink">
                  {judgeUrl ? (
                    <a className="underline underline-offset-4" href={judgeUrl}>
                      Judges: use the judge Shortcut, no key needed.
                    </a>
                  ) : (
                    <>
                      Judges: use the judge Shortcut, no key needed.{" "}
                      <span className="text-muted">Shortcut link isn&apos;t ready yet.</span>
                    </>
                  )}
                </p>
              )}
              <UseKeyForm />
            </>
          ) : (
            key && <Account key={key} accountKey={key} />
          )}
        </div>
      </main>
      <ToastViewport />
    </div>
  );
}
