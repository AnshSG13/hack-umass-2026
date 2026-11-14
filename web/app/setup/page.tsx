"use client";

// Setup (DESIGN.md 7.3, SPEC 13.2): make an account, carry the key to the phone with a QR
// code, add the Shortcut, and watch for the first save.

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { QRCodeSVG } from "qrcode.react";
import { LiveTicket } from "@/components/live-ticket";
import { PasteForm } from "@/components/paste-form";
import { ToastViewport } from "@/components/toast";
import { api, ApiError, fetcher, setKey } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { browserTimezone, useConfig, useDevice, useKey, useMe } from "@/lib/hooks";
import { btnOutline, btnPrimary, linkInk, pageTitle, sectionTitle } from "@/lib/styles";
import type { SavesPage } from "@/lib/types";
import { cn } from "@/lib/utils";

const KEY_SHAPE = /^[A-Za-z0-9_\-.~]{12,128}$/;

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
      <Link href="/plans" className={cn(linkInk, "inline-flex min-h-11 items-center text-[16px]")}>
        Open {appName}
      </Link>
    </p>
  );

  if (device === undefined) return null;

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

  const reelUrl = config?.first_save_reel_url || "";
  const shortcutUrl = config?.shortcut_url || "";
  return (
    <>
      {keyBox(false)}
      <ol className="mt-6 flex flex-col gap-6">
        <Step n={1}>
          <p className="text-[16px] text-ink">Copy your key</p>
          <CopyKeyButton value={accountKey} className="mt-2" />
        </Step>
        <Step n={2}>
          {shortcutUrl ? (
            <>
              <a className={btnPrimary} href={shortcutUrl}>
                Add the Shortcut
              </a>
              <p className="mt-2 text-[14px] text-muted">When it asks for your key, paste it.</p>
            </>
          ) : (
            <>
              <p className="text-[16px] text-ink">Add the Shortcut</p>
              <p className="mt-1 text-[14px] text-muted">Shortcut link isn&apos;t ready yet.</p>
            </>
          )}
        </Step>
        <Step n={3}>
          <p className="text-[16px] text-ink">
            The first time, iOS asks to allow network, Calendar and Reminders. Tap Allow.
          </p>
        </Step>
        <Step n={4}>
          {reelUrl ? (
            <>
              <p className="text-[16px] text-ink">Try it: open this reel, tap Share, then {appName}.</p>
              <a className={cn(btnOutline, "mt-2")} href={reelUrl} target="_blank" rel="noopener noreferrer">
                Open the reel
              </a>
            </>
          ) : (
            <p className="text-[16px] text-ink">Try it: open a reel in Instagram, tap Share, then {appName}.</p>
          )}
        </Step>
      </ol>
      {firstSaveBlock}
      {openApp}
    </>
  );
}

export default function SetupPage() {
  const key = useKey();
  const { config, appName } = useConfig();
  const { data: me } = useMe(Boolean(key));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Laptop to phone: the QR code carries the key in the fragment (SPEC 13.2).
  useEffect(() => {
    const m = window.location.hash.match(/^#k=(.+)$/);
    if (!m) return;
    const carried = decodeURIComponent(m[1]);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (KEY_SHAPE.test(carried)) setKey(carried);
  }, []);

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
        <Link href={key && !isDemo ? "/plans" : "/"} className="wide inline-flex min-h-11 items-center rounded-[4px] text-[20px] leading-none text-ink">
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
