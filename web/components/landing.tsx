"use client";

// Landing. With a key this page only redirects to Home.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowDown } from "lucide-react";
import { Perforation, ReelHalf, Thumb } from "@/components/ticket";
import { ToastViewport } from "@/components/toast";
import { api, fetcher, setKey } from "@/lib/api";
import { browserTimezone, useConfig, useKey } from "@/lib/hooks";
import { btnPrimary } from "@/lib/styles";
import type { SampleCard, Ticket as TicketData } from "@/lib/types";
import { cn } from "@/lib/utils";

const PILE_SIZE = 5;

/** A hero: a reel that became something to do. The stub shows the reel's action
    (what Reelize will help with), not a time, while reminders aren't offered. */
function ActionTicket({ ticket }: { ticket: TicketData }) {
  const action = ticket.action;
  // Cooking's steps and shopping list are read from the video ("ready" comes after that pass).
  // Other actions add facts from elsewhere (a trip plan's hours and prices), so they don't say it.
  const fromVideo = action?.deliver === "cook" && ticket.processing === "ready";
  return (
    <article aria-label={ticket.title ?? "A saved reel"} className="flex h-full flex-col">
      <div className={cn("rounded-t-[16px] border border-line bg-ticket", action ? "border-b-0" : "rounded-b-[16px]")}>
        <ReelHalf ticket={ticket} />
      </div>
      {action && (
        <>
          <Perforation />
          <div className="flex-1 rounded-b-[16px] border border-t-0 border-line bg-ticket px-4 pt-2 pb-4">
            <p className="wide text-[28px] leading-[1.1] text-ink">
              <span className="relative -mx-1 inline-block px-1">
                <span aria-hidden="true" className="absolute inset-0 bg-highlighter" />
                <span className="relative">{action.cta}</span>
              </span>
            </p>
            {action.pitch && (
              <p className="mt-2 text-[13px] text-muted">
                {fromVideo ? "Every step and ingredient, read from the video" : action.pitch}
              </p>
            )}
          </div>
        </>
      )}
    </article>
  );
}

/** The examples (food, fitness, travel): full-width cards in a row to swipe through, with a dot
    per example to show where you are and to jump with a click. Full width keeps each ticket's
    lines from wrapping, and the row keeps the page inside one screen on desktop. */
function Heroes({ tickets }: { tickets: TicketData[] }) {
  const [at, setAt] = useState(0);
  const row = useRef<HTMLUListElement>(null);
  if (tickets.length === 1) return <ActionTicket ticket={tickets[0]} />;
  return (
    <div>
      <ul
        ref={row}
        aria-label="Examples"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAt(Math.round(el.scrollLeft / (el.clientWidth + 16)));
        }}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth rounded-[16px] [scrollbar-width:none] motion-reduce:scroll-auto"
      >
        {tickets.map((t) => (
          <li key={t.url} className="w-full shrink-0 snap-center">
            <ActionTicket ticket={t} />
          </li>
        ))}
      </ul>
      <div className="flex justify-center">
        {tickets.map((t, i) => (
          <button
            key={t.url}
            type="button"
            aria-label={`Example ${i + 1} of ${tickets.length}: ${t.title ?? "a saved reel"}`}
            aria-current={i === at ? "true" : undefined}
            onClick={() => {
              const el = row.current;
              if (el) el.scrollTo({ left: i * (el.clientWidth + 16) });
            }}
            className="flex size-11 items-center justify-center rounded-full"
          >
            <span className={cn("size-2 rounded-full", i === at ? "bg-ink" : "bg-line-strong")} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Saved reels that went nowhere: real sample thumbnails, faded. Decorative; the caption says it. */
function Pile({ samples }: { samples: SampleCard[] | undefined }) {
  const shown = (samples ?? []).filter((s) => s.thumb_url).slice(0, PILE_SIZE);
  return (
    <div>
      <div aria-hidden="true" className="grid grid-cols-5 gap-2">
        {samples === undefined
          ? Array.from({ length: PILE_SIZE }, (_, i) => (
              <span key={i} className="aspect-[3/4] rounded-[8px] bg-ticket" />
            ))
          : shown.map((s) => (
              <Thumb
                key={s.shortcode}
                ticket={s}
                className="aspect-[3/4] h-auto w-full opacity-45 grayscale"
              />
            ))}
      </div>
      <p className="mt-2 text-[13px] text-muted">Saved, then forgotten</p>
    </div>
  );
}

export function Landing({ hasClip }: { hasClip: boolean }) {
  const key = useKey();
  const router = useRouter();
  const { config, appName } = useConfig();
  const { data: hero } = useSWR<{ ticket: TicketData | null; tickets?: TicketData[] }>(
    hasClip ? null : "/api/demo/hero",
    fetcher,
    {
    revalidateOnFocus: false,
  });
  const { data: samples } = useSWR<SampleCard[]>(hasClip ? null : "/api/demo/samples", fetcher, {
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
  // A server from before `tickets` existed sends only `ticket`.
  const heroTickets = hero?.tickets ?? (hero?.ticket ? [hero.ticket] : []);
  const heroUrls = new Set(heroTickets.map((t) => t.url));
  // The pile leaves out the examples' own reels, and shows only while there is a ticket for it to lead to.
  const pile = samples?.filter((s) => !heroUrls.has(s.url));
  const showPile = heroTickets.length > 0 && (pile === undefined || pile.some((s) => s.thumb_url));
  const hasHero = hasClip || heroTickets.length > 0;

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
            You save reels and forget them. <strong className="font-semibold">Every save becomes a plan.</strong>{" "}
            Just share a reel to {appName}. It handles the rest.
          </p>
        </div>

        {hasHero && (
          <div className="mt-8 desk:col-start-2 desk:row-span-2 desk:row-start-1 desk:mt-0">
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
              heroTickets.length > 0 && (
                <figure aria-label="Saved reels that were forgotten, and ones that became plans">
                  {showPile && (
                    <>
                      <Pile samples={pile} />
                      <div className="my-2 flex justify-center text-ink">
                        <ArrowDown aria-hidden="true" className="size-6" strokeWidth={1.5} />
                      </div>
                    </>
                  )}
                  <Heroes tickets={heroTickets} />
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
          {/* One filled button: the demo. Signing up and signing in are quiet links next to it. */}
          {demoOn ? (
            <p className="mt-2 flex items-center justify-center gap-3 text-[15px] text-ink">
              <Link href="/signup" className="inline-flex min-h-11 items-center underline underline-offset-4">
                Create an account
              </Link>
              <span aria-hidden="true" className="text-muted">
                ·
              </span>
              <Link href="/login" className="inline-flex min-h-11 items-center underline underline-offset-4">
                Sign in
              </Link>
            </p>
          ) : (
            <>
              <Link href="/signup" className={cn(btnPrimary, "mt-3 w-full")}>
                Create an account
              </Link>
              <p className="mt-4 text-center text-[15px] text-ink">
                Have an account?{" "}
                <Link href="/login" className="inline-flex min-h-11 items-center underline underline-offset-4">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </main>

      <footer className="pb-6 text-[13px] text-muted">Built at HackUMass XIV.</footer>
      <ToastViewport />
    </div>
  );
}
