"use client";

// Landing. With a key this page only redirects to Home.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Ticket } from "@/components/ticket";
import { ToastViewport } from "@/components/toast";
import { api, fetcher, setKey } from "@/lib/api";
import { browserTimezone, useConfig, useKey } from "@/lib/hooks";
import { btnOutline, btnPrimary } from "@/lib/styles";
import type { Ticket as TicketData } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Landing({ hasClip }: { hasClip: boolean }) {
  const key = useKey();
  const router = useRouter();
  const { config, appName } = useConfig();
  const { data: hero } = useSWR<{ ticket: TicketData | null }>(hasClip ? null : "/api/demo/hero", fetcher, {
    revalidateOnFocus: false,
  });
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  // A demo started here opens on the guided story; anyone already signed in goes Home.
  const startedDemo = useRef(false);
  useEffect(() => {
    if (key) router.replace(startedDemo.current ? "/story" : "/home");
  }, [key, router]);

  async function startDemo() {
    setStarting(true);
    setFailed(false);
    try {
      const r = await api<{ api_key: string }>("/api/demo/session", { body: { timezone: browserTimezone() } });
      startedDemo.current = true;
      setKey(r.api_key);
    } catch {
      setFailed(true);
      setStarting(false);
    }
  }

  // Signed in (or still finding out): nothing to show, the redirect is on its way.
  if (key !== null) return <div className="min-h-dvh bg-paper" />;

  const demoOn = config?.demo_enabled !== false;
  const heroTicket = hero?.ticket ?? null;
  const hasHero = hasClip || heroTicket !== null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-4 desk:max-w-[976px]">
      <header className="flex h-14 shrink-0 items-center">
        <span className="wide text-[20px] leading-none text-ink">{appName}</span>
      </header>

      <main
        className={cn(
          "flex-1 pt-4 pb-6 desk:grid desk:content-center desk:items-center desk:gap-x-16 desk:pb-16",
          hasHero ? "desk:grid-cols-[440px_440px]" : "desk:grid-cols-[440px]",
        )}
      >
        <div className="desk:col-start-1 desk:row-start-1 desk:self-end">
          {/* The reason the app exists, said first. "intentional" carries the same highlighter
              mark as a ticket's planned time, so the promise and the plan read as one idea. */}
          <h1 className="wide text-[36px] leading-[1.14] text-ink [text-wrap:balance] desk:text-[44px]">
            Bring back{" "}
            <span className="relative -mx-1 inline-block px-1 whitespace-nowrap">
              <span aria-hidden="true" className="absolute inset-x-0 top-[0.12em] bottom-[0.04em] bg-highlighter" />
              <span className="relative">intentional</span>
            </span>{" "}
            scrolling.
          </h1>
          <p className="mt-4 text-[16px] text-ink">
            <strong className="font-semibold">Every save becomes a plan.</strong> Share a reel from Instagram.{" "}
            {appName} reads it, checks your week, and asks before it adds anything.
          </p>
        </div>

        {hasHero && (
          <div className="mt-6 desk:col-start-2 desk:row-span-2 desk:row-start-1 desk:mt-0">
            {hasClip ? (
              <video
                className="w-full rounded-[16px] border border-line bg-ticket"
                src="/landing.mp4"
                poster="/landing-poster.jpg"
                muted
                loop
                autoPlay
                playsInline
                aria-label={`A reel being shared to ${appName} and coming back as a plan`}
              />
            ) : (
              heroTicket && (
                <figure aria-label="A saved reel and the plan made from it">
                  <Ticket ticket={heroTicket} preview />
                </figure>
              )
            )}
          </div>
        )}

        <div className="mt-6 desk:col-start-1 desk:row-start-2 desk:self-start">
          {demoOn && (
            <button type="button" className={btnPrimary} disabled={starting} onClick={() => void startDemo()}>
              {starting ? "Starting the demo" : "Try the demo"}
            </button>
          )}
          {failed && (
            <p role="alert" className="mt-2 text-[14px] text-danger-ink">
              The demo didn&apos;t start. Try again.
            </p>
          )}
          <Link href="/signup" className={cn(demoOn ? btnOutline : btnPrimary, "mt-3 w-full")}>
            Use it for real
          </Link>
          <p className="mt-4 text-center text-[15px] text-ink">
            Have an account?{" "}
            <Link href="/login" className="inline-flex min-h-11 items-center underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </div>
      </main>

      <footer className="pb-6 text-[13px] text-muted">Built at HackUMass XIV.</footer>
      <ToastViewport />
    </div>
  );
}
