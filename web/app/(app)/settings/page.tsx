"use client";

// Settings (DESIGN.md 7.8). Every change saves itself and answers with the toast "Saved".

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useToast } from "@/components/toast";
import { ShortcutKey } from "@/components/shortcut-key";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { api, ApiError, setKey, signOut } from "@/lib/api";
import { KINDS } from "@/lib/kinds";
import { browserTimezone, useMe } from "@/lib/hooks";
import { btnDanger, btnOutline, btnText, btnTextDanger, inputBase, pageTitle, sectionTitle } from "@/lib/styles";
import type { Me, Prefs } from "@/lib/types";
import { cn } from "@/lib/utils";

const DAYS: { id: string; short: string; long: string }[] = [
  { id: "mon", short: "Mon", long: "Monday" },
  { id: "tue", short: "Tue", long: "Tuesday" },
  { id: "wed", short: "Wed", long: "Wednesday" },
  { id: "thu", short: "Thu", long: "Thursday" },
  { id: "fri", short: "Fri", long: "Friday" },
  { id: "sat", short: "Sat", long: "Saturday" },
  { id: "sun", short: "Sun", long: "Sunday" },
];

const TYPE_SWITCHES = ["recipe", "event", "place", "workout", "product", "tip"] as const;

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

function DayChips({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="text-[15px] text-ink">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DAYS.map((d) => {
          const on = value.includes(d.id);
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={on}
              aria-label={d.long}
              className={cn(
                "inline-flex h-11 min-w-[44px] flex-1 items-center justify-center rounded-full border px-1 text-[14px]",
                on ? "border-ink bg-ink font-medium text-ticket" : "border-line-strong bg-ticket text-ink",
              )}
              onClick={() =>
                onChange(on ? value.filter((x) => x !== d.id) : DAYS.map((x) => x.id).filter((x) => x === d.id || value.includes(x)))
              }
            >
              {d.short}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
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
  const [confirm, setConfirm] = useState<"sign-out" | null>(null);
  const [name, setName] = useState(me.name ?? "");
  const [savingName, setSavingName] = useState(false);
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

  const cap = draft.daily_cap;

  return (
    <div>
      <h1 className={pageTitle}>Settings</h1>

      {me.is_demo && (
        <p className="mt-4 rounded-[12px] border border-line-strong bg-ticket px-4 py-3 text-[15px] text-ink">
          Demo account. It deletes itself in 24 hours.
        </p>
      )}

      {!me.is_demo && <AccountSection me={me} onSignOut={() => setConfirm("sign-out")} />}

      {/* The key the iPhone Shortcut needs, near the top so an email account can find it. */}
      <ShortcutKey me={me} className="mt-6" />

      <section className="mt-6" aria-labelledby="name-heading">
        <h2 id="name-heading" className={sectionTitle}>
          <label htmlFor={nameId}>Your name</label>
        </h2>
        <form
          className="name-field"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <input
            id={nameId}
            type="text"
            autoComplete="given-name"
            maxLength={40}
            placeholder="What Home should call you"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn" disabled={savingName || name.trim() === (me.name ?? "")}>
            Save
          </button>
        </form>
      </section>

      <section className="mt-8" aria-labelledby="week-heading">
        <h2 id="week-heading" className={sectionTitle}>
          Your week
        </h2>
        <div className="mt-3">
          <DayChips legend="Cook nights" value={draft.cook_days} onChange={(v) => update({ ...draft, cook_days: v })} />
          <TimeField label="Cook at" value={draft.cook_time} onChange={(v) => update({ ...draft, cook_time: v })} />
        </div>
        <div className="mt-5">
          <DayChips
            legend="Workout days"
            value={draft.workout_days}
            onChange={(v) => update({ ...draft, workout_days: v })}
          />
          <TimeField
            label="Work out at"
            value={draft.workout_time}
            onChange={(v) => update({ ...draft, workout_time: v })}
          />
        </div>
        <TimeField
          label="Weekend plans at"
          value={draft.weekend_time}
          onChange={(v) => update({ ...draft, weekend_time: v })}
        />
      </section>

      <section className="mt-8" aria-labelledby="pings-heading">
        <h2 id="pings-heading" className={sectionTitle}>
          Fewer pings
        </h2>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[15px] text-ink" aria-live="polite">
            At most <span className="tabular font-semibold">{cap}</span> {cap === 1 ? "plan" : "plans"} a day
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Fewer plans a day"
              className="inline-flex size-11 items-center justify-center rounded-[12px] border border-line-strong bg-ticket text-ink disabled:opacity-40"
              disabled={cap <= 1}
              onClick={() => update({ ...draft, daily_cap: Math.max(1, cap - 1) })}
            >
              <Minus aria-hidden="true" className="size-5" />
            </button>
            <button
              type="button"
              aria-label="More plans a day"
              className="inline-flex size-11 items-center justify-center rounded-[12px] border border-line-strong bg-ticket text-ink disabled:opacity-40"
              disabled={cap >= 5}
              onClick={() => update({ ...draft, daily_cap: Math.min(5, cap + 1) })}
            >
              <Plus aria-hidden="true" className="size-5" />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-[15px] text-ink">
          <span>No reminders between</span>
          <TimeField
            inline
            label="Quiet hours start"
            value={draft.quiet_start}
            onChange={(v) => update({ ...draft, quiet_start: v })}
          />
          <span>and</span>
          <TimeField
            inline
            label="Quiet hours end"
            value={draft.quiet_end}
            onChange={(v) => update({ ...draft, quiet_end: v })}
          />
        </div>

        <fieldset className="mt-4">
          <legend className="sr-only">Plan these types</legend>
          <ul className="divide-y divide-line border-y border-line">
            {TYPE_SWITCHES.map((t) => {
              const id = `type-${t}`;
              return (
                <li key={t} className="flex items-center justify-between gap-3">
                  <label htmlFor={id} className="flex min-h-12 flex-1 items-center text-[16px] text-ink">
                    {KINDS[t].label}
                  </label>
                  <Switch
                    id={id}
                    checked={draft.types_on[t]}
                    onCheckedChange={(on) => update({ ...draft, types_on: { ...draft.types_on, [t]: on } })}
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[13px] text-muted">Off means saves of this type go to your library with no plan.</p>
        </fieldset>
      </section>

      <section className="mt-8" aria-labelledby="tz-heading">
        <h2 id="tz-heading" className={sectionTitle}>
          <label htmlFor={tzId}>Time zone</label>
        </h2>
        <select
          id={tzId}
          className={cn(inputBase, "mt-3 w-full")}
          value={timezone}
          onChange={(e) => {
            setTimezone(e.target.value);
            void patch({ timezone: e.target.value });
          }}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </section>

      {(!me.email || me.is_demo) && (
        <section className="mt-8">
          <button type="button" className={cn(btnTextDanger, "w-full")} onClick={() => setConfirm("sign-out")}>
            Sign out on this device
          </button>
        </section>
      )}

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

/** Who is signed in, or a form that gives a key-only account an email and password. */
function AccountSection({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();
  const passwordId = useId();

  if (me.email) {
    return (
      <section className="mt-6" aria-labelledby="account-heading">
        <h2 id="account-heading" className={sectionTitle}>
          Account
        </h2>
        <p className="mt-2 text-[15px] text-ink">
          Signed in as <span className="font-semibold break-all">{me.email}</span>
        </p>
        <button type="button" className={cn(btnOutline, "mt-3 w-full")} onClick={onSignOut}>
          Sign out
        </button>
      </section>
    );
  }

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
    <section className="mt-6" aria-labelledby="account-heading">
      <h2 id="account-heading" className={sectionTitle}>
        Add an email and password
      </h2>
      <p className="mt-2 text-[14px] text-muted">So you can sign in anywhere without your key.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={emailId} className="mt-3 block text-[15px] text-ink">
          Email
        </label>
        <input
          id={emailId}
          type="email"
          required
          autoComplete="email"
          className={cn(inputBase, "mt-2 w-full")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor={passwordId} className="mt-3 block text-[15px] text-ink">
          Password
        </label>
        <input
          id={passwordId}
          type="password"
          required
          autoComplete="new-password"
          className={cn(inputBase, "mt-2 w-full")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="mt-1 text-[13px] text-muted">At least 8 characters.</p>
        {error && (
          <p role="alert" className="mt-2 text-[14px] text-danger-ink">
            {error}
          </p>
        )}
        <button type="submit" className={cn(btnOutline, "mt-3 w-full")} disabled={busy}>
          Save email and password
        </button>
      </form>
    </section>
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
