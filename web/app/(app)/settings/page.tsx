"use client";

// Settings, kept to what is needed: your profile, plans and reminders (plans per day, quiet
// hours, time zone) and the iPhone Shortcut key. Every change saves itself and answers with the toast "Saved".
// The routine (cook and workout days) keeps its saved values; the app still plans with them.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Minus, Plus } from "lucide-react";
import { useToast } from "@/components/toast";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { api, ApiError, getKey, isApiKey, setKey, signOut } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { browserTimezone, useMe } from "@/lib/hooks";
import { btnDanger, btnOutline, btnPrimary, btnText, inputBase, pageTitle } from "@/lib/styles";
import type { Me, Prefs } from "@/lib/types";
import { STORY_REPLAY_HREF } from "@/lib/story";
import { cn } from "@/lib/utils";

function timezones(current: string): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch {
    all = [];
  }
  const set = new Set(all);
  set.add(current);
  set.add(browserTimezone());
  return Array.from(set).sort();
}

/** "America/New_York" reads "New York (America)": the city first, so it fits the row. */
function zoneLabel(zone: string): string {
  const parts = zone.split("/");
  const city = parts[parts.length - 1].replace(/_/g, " ");
  return parts.length > 1 ? `${city} (${parts[0].replace(/_/g, " ")})` : city;
}

function TimeField({
  label,
  value,
  onChange,
  inline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inline?: boolean;
}) {
  const id = useId();
  return (
    <div className={inline ? "inline-flex items-center" : "mt-3 flex items-center justify-between gap-3"}>
      <label htmlFor={id} className={inline ? "sr-only" : "text-[15px] text-ink"}>
        {label}
      </label>
      <input
        id={id}
        type="time"
        className={cn(inputBase, "tabular w-[136px]")}
        value={value}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
      />
    </div>
  );
}

function SettingsForm({ me, onSaved }: { me: Me; onSaved: (next: Me) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Prefs>(me.prefs);
  const [timezone, setTimezone] = useState(me.timezone);
  const [confirm, setConfirm] = useState<"new-key" | "sign-out" | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(me.name ?? "");
  const [savingName, setSavingName] = useState(false);
  // A key made here while signed in with an email: shown once, for the Shortcut.
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [shownCopied, setShownCopied] = useState(false);
  const signedInWithKey = isApiKey(getKey());
  const timer = useRef<number | null>(null);
  const tzId = useId();
  const nameId = useId();
  const zones = useMemo(() => timezones(me.timezone), [me.timezone]);

  async function saveName() {
    setSavingName(true);
    try {
      const next = await api<Me>("/api/me", { method: "PATCH", body: { name: name.trim() } });
      onSaved(next);
      setName(next.name ?? name.trim());
      toast.show("Saved");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "That didn't save. Check your connection.");
    } finally {
      setSavingName(false);
    }
  }

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  async function patch(body: { prefs?: Prefs; timezone?: string }) {
    try {
      const next = await api<Me>("/api/me", { method: "PATCH", body });
      onSaved(next);
      toast.show("Saved");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "That didn't save. Check your connection.");
    }
  }

  // Coalesce quick taps (the stepper, several day chips) into one save.
  function update(next: Prefs) {
    setDraft(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void patch({ prefs: next }), 400);
  }

  async function makeNewKey() {
    setBusy(true);
    try {
      const r = await api<{ api_key: string }>("/api/me/key", { method: "POST" });
      if (signedInWithKey) setKey(r.api_key);
      else setShownKey(r.api_key);
      setConfirm(null);
      toast.show("New key made. Copy it into your Shortcut.");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "The new key wasn't made. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const cap = draft.daily_cap;
  // An email account has no Shortcut key until it makes one (a key account always has one).
  const hasKey = signedInWithKey || Boolean(me.shortcut_key) || shownKey !== null;
  const initial = (me.name?.trim() || me.email || "?")[0].toUpperCase();

  return (
    <div className="set">
      <h1 className="set-title">Settings</h1>

      {me.is_demo && <p className="set-demo">Demo account. It deletes itself in 24 hours.</p>}

      <section className="set-group" aria-labelledby="profile-h">
        <h2 id="profile-h" className="set-head">
          Profile
        </h2>
        <div className="set-card">
          <form
            className="set-row set-profile"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <span className="set-avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="set-profile-text">
              <label htmlFor={nameId} className="vh">
                Your name
              </label>
              <input
                id={nameId}
                type="text"
                className="set-name"
                autoComplete="given-name"
                maxLength={40}
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                // Leaving the field keeps the change, the same as Save or Enter.
                onBlur={(e) => {
                  const into = e.relatedTarget as HTMLElement | null;
                  if (into?.classList.contains("set-save")) return; // Save is about to do it
                  if (name.trim() !== (me.name ?? "") && !savingName) void saveName();
                }}
              />
              <span className="set-sub">{me.email ?? (me.is_demo ? "Demo account" : "Signed in with a key")}</span>
            </span>
            {name.trim() !== (me.name ?? "") && (
              <button type="submit" className="set-save" disabled={savingName}>
                {savingName ? "Saving" : "Save"}
              </button>
            )}
          </form>
          {!me.email && !me.is_demo && <AddEmail />}
        </div>
      </section>

      <section className="set-group" aria-labelledby="pings-h">
        <h2 id="pings-h" className="set-head">
          Plans and reminders
        </h2>
        <div className="set-card">
          <div className="set-row">
            <span className="set-label">
              Plans per day
              <span className="set-sub">The most it suggests for one day</span>
            </span>
            <span className="set-stepper">
              <button type="button" aria-label="Fewer plans a day" disabled={cap <= 1} onClick={() => update({ ...draft, daily_cap: Math.max(1, cap - 1) })}>
                <Minus aria-hidden="true" />
              </button>
              <output aria-live="polite">{cap}</output>
              <button type="button" aria-label="More plans a day" disabled={cap >= 5} onClick={() => update({ ...draft, daily_cap: Math.min(5, cap + 1) })}>
                <Plus aria-hidden="true" />
              </button>
            </span>
          </div>
          <div className="set-row is-stack">
            <span className="set-label">
              Quiet hours
              <span className="set-sub">No plans or reminders between these times</span>
            </span>
            <span className="set-times">
              <TimeField inline label="Quiet hours start" value={draft.quiet_start} onChange={(v) => update({ ...draft, quiet_start: v })} />
              <span aria-hidden="true">to</span>
              <TimeField inline label="Quiet hours end" value={draft.quiet_end} onChange={(v) => update({ ...draft, quiet_end: v })} />
            </span>
          </div>
          <div className="set-row">
            <label htmlFor={tzId} className="set-label">
              Time zone
              <span className="set-sub">Plan times use it</span>
            </label>
            <select
              id={tzId}
              className="set-select"
              value={timezone}
              onChange={(e) => {
                setTimezone(e.target.value);
                void patch({ timezone: e.target.value });
              }}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {zoneLabel(z)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="set-group" aria-labelledby="shortcut-h">
        <h2 id="shortcut-h" className="set-head">
          Save from Instagram
        </h2>
        <details className="set-card set-more">
          <summary className="set-row">
            <span className="set-label">
              Shortcut key
              <span className="set-sub">
                {hasKey
                  ? `Ends in ${me.key_preview}. The iPhone Shortcut uses it.`
                  : "The iPhone Shortcut needs one to save reels to you."}
              </span>
            </span>
            <span className="set-chev" aria-hidden="true">
              <ChevronDown />
            </span>
          </summary>
          <div className="set-more-body">
            {shownKey && (
              <div className="set-key">
                <p className="set-key-text">{shownKey}</p>
                <button
                  type="button"
                  className="btn btn-block"
                  onClick={async () => {
                    if (await copyText(shownKey)) {
                      setShownCopied(true);
                      window.setTimeout(() => setShownCopied(false), 3000);
                    }
                  }}
                >
                  <span aria-live="polite">{shownCopied ? "Copied" : "Copy key"}</span>
                </button>
                <p className="set-sub">It&apos;s shown once. Paste it into your Shortcut now.</p>
              </div>
            )}
            {signedInWithKey && (
              <button
                type="button"
                className="btn btn-block"
                onClick={async () => {
                  const key = getKey();
                  if (key && (await copyText(key))) {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 3000);
                  }
                }}
              >
                <span aria-live="polite">{copied ? "Copied" : "Copy key"}</span>
              </button>
            )}
            {hasKey ? (
              <button type="button" className="btn btn-block" onClick={() => setConfirm("new-key")}>
                Make a new key
              </button>
            ) : (
              <button type="button" className="btn btn-block btn-primary" disabled={busy} onClick={() => void makeNewKey()}>
                Get my Shortcut key
              </button>
            )}
          </div>
        </details>
      </section>

      <section className="set-group" aria-labelledby="more-h">
        <h2 id="more-h" className="set-head">
          More
        </h2>
        <div className="set-card">
          <Link href={STORY_REPLAY_HREF} className="set-row set-link">
            <span className="set-label">
              Watch the tour again
              <span className="set-sub">Three pages on what it does</span>
            </span>
            <ChevronRight aria-hidden="true" className="set-link-chev" />
          </Link>
          <Link href="/graph" className="set-row set-link">
            <span className="set-label">
              How your saves connect
              <span className="set-sub">A 3D map of your saves</span>
            </span>
            <ChevronRight aria-hidden="true" className="set-link-chev" />
          </Link>
          {!me.is_demo && (
            <Link href="/welcome" className="set-row set-link">
              <span className="set-label">
                Change your interests
                <span className="set-sub">They decide how your saves are sorted</span>
              </span>
              <ChevronRight aria-hidden="true" className="set-link-chev" />
            </Link>
          )}
        </div>
      </section>

      <button type="button" className="set-signout" onClick={() => setConfirm("sign-out")}>
        Sign out
      </button>

      <Sheet open={confirm === "new-key"} onOpenChange={(open) => !open && setConfirm(null)}>
        <SheetContent>
          <SheetTitle>Make a new key</SheetTitle>
          <SheetDescription>
            {signedInWithKey
              ? "Your Shortcut stops working until you paste the new key."
              : "The old key stops working. Paste the new one into your Shortcut."}
          </SheetDescription>
          <button type="button" className={cn(btnPrimary, "mt-5")} disabled={busy} onClick={() => void makeNewKey()}>
            Make a new key
          </button>
          <button type="button" className={cn(btnText, "mt-1 w-full")} onClick={() => setConfirm(null)}>
            Keep this key
          </button>
        </SheetContent>
      </Sheet>

      <Sheet open={confirm === "sign-out"} onOpenChange={(open) => !open && setConfirm(null)}>
        <SheetContent>
          <SheetTitle>Sign out on this device</SheetTitle>
          <SheetDescription>
            {me.email
              ? `Sign back in any time with ${me.email}.`
              : "Copy your key first. There's no password, so without it this account is gone."}
          </SheetDescription>
          <button
            type="button"
            className={cn(btnDanger, "mt-5 w-full")}
            onClick={() => {
              setConfirm(null);
              void signOut();
            }}
          >
            Sign out
          </button>
          <button type="button" className={cn(btnText, "mt-1 w-full")} onClick={() => setConfirm(null)}>
            Stay signed in
          </button>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** A key-only account can add an email and password, to sign in anywhere without the key. */
function AddEmail() {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();
  const passwordId = useId();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>("/api/auth/credentials", { body: { email, password } });
      setKey(r.token);
      toast.show("Saved. Sign in with your email from now on.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="set-more">
      <summary className="set-row">
        <span className="set-label">
          Add an email and password
          <span className="set-sub">So you can sign in anywhere</span>
        </span>
        <span className="set-chev" aria-hidden="true">
          <ChevronDown />
        </span>
      </summary>
      <form
        className="set-more-body"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={emailId} className="set-field-label">
          Email
        </label>
        <input id={emailId} type="email" required autoComplete="email" className="set-input" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor={passwordId} className="set-field-label">
          Password <span className="set-sub">(at least 8 characters)</span>
        </label>
        <input
          id={passwordId}
          type="password"
          required
          autoComplete="new-password"
          className="set-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p role="alert" className="plan-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          Save email and password
        </button>
      </form>
    </details>
  );
}

export default function SettingsPage() {
  const { data: me, error, mutate } = useMe();

  if (error && !me) {
    return (
      <div>
        <h1 className={pageTitle}>Settings</h1>
        <div className="mt-6" role="alert">
          <p className="text-[16px] text-ink">Settings didn&apos;t load. Check your connection.</p>
          <button type="button" className={cn(btnOutline, "mt-3")} onClick={() => void mutate()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!me) {
    return (
      <div>
        <h1 className={pageTitle}>Settings</h1>
        <p className="mt-6 text-[15px] text-muted" role="status">
          Loading your settings
        </p>
      </div>
    );
  }
  // Keyed by account, so a new key or a fresh demo session starts from that account's values.
  return <SettingsForm key={me.user_id} me={me} onSaved={(next) => void mutate(next, { revalidate: false })} />;
}
