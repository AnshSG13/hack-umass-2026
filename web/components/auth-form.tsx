"use client";

// Sign in and create account. Both answer with a session token, which is kept where the
// API key used to be, so every other page works unchanged.

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ToastViewport } from "@/components/toast";
import { api, ApiError, setKey } from "@/lib/api";
import { browserTimezone, useConfig, useKey, useMe } from "@/lib/hooks";
import { btnPrimary, inputBase, linkInk, pageTitle } from "@/lib/styles";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup";

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  hint,
  required = true,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: string;
  required?: boolean;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-[15px] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn(inputBase, "mt-2 w-full")}
        value={value}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-[13px] text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Where signing in lands: ?next= when it is a path on this site (/connect uses it), else Home. */
function afterSignIn(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/home";
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const key = useKey();
  const { appName } = useConfig();
  const { data: me } = useMe(Boolean(key));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = mode === "signup";

  // Already signed in to a real account: nothing to do here. A demo account can still sign
  // in or sign up; the new session replaces it.
  // Skipped once this form signs someone in: submit() picks the destination then.
  const leaving = useRef(false);
  useEffect(() => {
    if (me && !me.is_demo && !leaving.current) router.replace(afterSignIn());
  }, [me, router]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>(signup ? "/api/auth/signup" : "/api/auth/login", {
        body: signup
          ? { email, password, name: name.trim() || undefined, timezone: browserTimezone() }
          : { email, password },
      });
      leaving.current = true;
      setKey(r.token);
      router.replace(signup ? "/welcome?next=/setup" : afterSignIn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[440px] px-4 pb-10">
      <header className="flex h-14 items-center">
        <Link href="/" className="wide inline-flex min-h-11 items-center rounded-[4px] text-[20px] leading-none text-ink">
          {appName}
        </Link>
      </header>
      <main className="pt-2">
        <h1 className={pageTitle}>{signup ? "Create your account" : "Sign in"}</h1>
        <p className="mt-2 text-[15px] text-muted">
          {signup
            ? `Your saves and plans stay in your own ${appName} account.`
            : `Welcome back. Sign in to see your saves and plans.`}
        </p>
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {signup && (
            <Field label="Name (optional)" type="text" value={name} onChange={setName} autoComplete="given-name" required={false} />
          )}
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={signup ? "new-password" : "current-password"}
            hint={signup ? "At least 8 characters." : undefined}
          />
          {error && (
            <p role="alert" className="mt-3 text-[14px] text-danger-ink">
              {error}
            </p>
          )}
          <button type="submit" className={cn(btnPrimary, "mt-5")} disabled={busy}>
            {busy ? (signup ? "Creating your account" : "Signing in") : signup ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-[15px] text-ink">
          {signup ? "Already have an account? " : "New here? "}
          <Link href={signup ? "/login" : "/signup"} className={cn(linkInk, "tap-link")}>
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
        {!signup && (
          <p className="mt-3 text-[14px] text-muted">
            Made your account with a key?{" "}
            <Link href="/setup" className={cn(linkInk, "tap-link")}>
              Use your key
            </Link>
            , then add an email in Settings.
          </p>
        )}
      </main>
      <ToastViewport />
    </div>
  );
}
