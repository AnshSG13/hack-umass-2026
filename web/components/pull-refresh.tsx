"use client";

// Pull down at the top of a screen to reload what's on it. A web app opened from the
// iPhone Home Screen has no browser reload button, and a reel sent from the Shortcut
// arrives while the app is in the background, so this is the way to say "check again".
//
// It looks like the app's own orb: a small pastel bead drops in, a ring fills as you pull,
// the arrow turns when letting go will refresh, the colours swirl while it loads (as the
// orb does when Ask is thinking), and a check says it's up to date. The page follows the
// finger with a little give, the way iOS lists do. Reduced motion keeps only the bead.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, Check } from "lucide-react";

const THRESHOLD = 70; // px of pull (after resistance) that commits to a refresh
const MAX = 120;
const MIN_SPIN_MS = 700; // long enough to see that something happened
const DONE_MS = 900; // how long the check stays before the bead floats away
const RING = 2 * Math.PI * 21; // the progress ring's circumference (r = 21)
const GAP = 58; // the pill sits in the space the page opens above itself

type Phase = "idle" | "pulling" | "armed" | "refreshing" | "done";

const LABEL: Record<Phase, string> = {
  idle: "",
  pulling: "Pull to refresh",
  armed: "Release to refresh",
  refreshing: "Refreshing",
  done: "Up to date",
};

const noSubscribe = () => () => {};

export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [said, setSaid] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  // The pill lives on <body>: inside the page, the page's own movement would carry a
  // position: fixed element down with it.
  const host = useSyncExternalStore(
    noSubscribe,
    () => document.body,
    () => null,
  );

  useEffect(() => {
    let alive = true;
    let tracking = false;
    let pulling = false;
    let busy = false;
    let startX = 0;
    let startY = 0;
    let dist = 0;
    let shown: Phase = "idle";
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const page = () => document.querySelector<HTMLElement>("main.screen");

    const show = (p: Phase) => {
      if (p === shown || !alive) return;
      // A tiny tap of feedback where the phone supports it, as the pull commits.
      if (p === "armed" && shown === "pulling") navigator.vibrate?.(8);
      shown = p;
      setPhase(p);
    };

    // The bead, its ring and the page follow the finger directly; React state only changes
    // at the phase edges, so a pull never re-renders the screen.
    const place = (d: number, animate: boolean) => {
      const el = wrap.current;
      if (el) {
        el.style.transition = animate ? "transform 420ms var(--ease), opacity 300ms" : "none";
        el.style.transform = `translate(-50%, ${Math.round(d - GAP)}px)`;
        el.style.opacity = String(Math.min(1, d / 36));
      }
      if (ring.current) {
        const p = Math.min(1, d / THRESHOLD);
        ring.current.style.transition = animate ? "stroke-dashoffset 300ms var(--ease)" : "none";
        ring.current.style.strokeDashoffset = String(RING * (1 - p));
      }
      const main = page();
      if (main && !still) {
        main.style.transition = animate ? "transform 520ms cubic-bezier(0.2, 1.3, 0.4, 1)" : "none";
        main.style.transform = d > 0 ? `translateY(${Math.round(d)}px)` : "";
      }
    };

    const onStart = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1) return;
      if (window.scrollY > 0) return;
      if (document.querySelector('[role="dialog"]')) return; // a sheet is open
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
      pulling = false;
      dist = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!pulling) {
        // Sideways (the rail of reels) or upward: not a pull, leave the gesture alone.
        if (dy < -4 || Math.abs(dx) > Math.max(8, dy)) {
          tracking = false;
          return;
        }
        if (dy < 8) return;
        if (window.scrollY > 0) {
          tracking = false;
          return;
        }
        pulling = true;
      }
      // Stops the browser's own overscroll (and Safari's page reload) for this pull.
      if (e.cancelable) e.preventDefault();
      // Rubber band: the further you pull, the more it resists.
      const raw = Math.max(0, dy);
      dist = Math.min(MAX, MAX * (1 - Math.exp(-raw / (MAX * 1.6))) * 1.25);
      place(dist, false);
      show(dist >= THRESHOLD ? "armed" : "pulling");
    };

    const run = async () => {
      busy = true;
      show("refreshing");
      setSaid("");
      place(GAP + 8, true); // settle in the gap it opened while it loads
      const started = Date.now();
      try {
        await refresh.current();
      } catch {
        /* each list shows its own error */
      }
      const left = MIN_SPIN_MS - (Date.now() - started);
      if (left > 0) await new Promise((r) => window.setTimeout(r, left));
      if (!alive) return;
      const online = navigator.onLine;
      show("done");
      setSaid(online ? "Updated" : "You're offline. Nothing new was loaded.");
      await new Promise((r) => window.setTimeout(r, DONE_MS));
      busy = false;
      if (!alive) return;
      place(0, true);
      show("idle");
    };

    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!pulling) return;
      pulling = false;
      if (dist >= THRESHOLD) {
        void run();
      } else {
        place(0, true);
        show("idle");
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      alive = false;
      const main = page();
      if (main) {
        main.style.transform = "";
        main.style.transition = "";
      }
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const pill = (
      <div ref={wrap} className="ptr" data-phase={phase} aria-hidden="true">
        <span className="ptr-bead">
          <span className="ptr-swirl" />
          <span className="ptr-glass" />
          <svg className="ptr-ring" viewBox="0 0 48 48" width="48" height="48">
            <defs>
              <linearGradient id="ptr-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" style={{ stopColor: "var(--orb-1)" }} />
                <stop offset="50%" style={{ stopColor: "var(--orb-3)" }} />
                <stop offset="100%" style={{ stopColor: "var(--orb-5)" }} />
              </linearGradient>
            </defs>
            <circle className="ptr-track" cx="24" cy="24" r="21" />
            <circle
              ref={ring}
              className="ptr-fill"
              cx="24"
              cy="24"
              r="21"
              stroke="url(#ptr-grad)"
              strokeDasharray={RING}
              strokeDashoffset={RING}
            />
          </svg>
          <span className="ptr-mark">
            {phase === "done" ? <Check className="ptr-check" /> : <ArrowDown className="ptr-arrow" />}
          </span>
        </span>
        <span className="ptr-label">{LABEL[phase]}</span>
      </div>
  );

  return (
    <>
      {host && createPortal(pill, host)}
      <p className="vh" role="status" aria-live="polite">
        {phase === "refreshing" ? "Refreshing" : said}
      </p>
    </>
  );
}
