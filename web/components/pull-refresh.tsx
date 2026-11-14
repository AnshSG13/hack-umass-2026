"use client";

// Pull down at the top of a screen to reload what's on it. A web app opened from the
// iPhone Home Screen has no browser reload button, and a reel sent from the Shortcut
// arrives while the app is in the background, so this is the way to say "check again".

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const THRESHOLD = 64; // px of pull (after resistance) that commits to a refresh
const MAX = 96;
const MIN_SPIN_MS = 500; // long enough to see that something happened

type Phase = "idle" | "pulling" | "armed" | "refreshing";

export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [said, setSaid] = useState("");
  const dot = useRef<HTMLDivElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let alive = true;
    let tracking = false;
    let pulling = false;
    let busy = false;
    let startX = 0;
    let startY = 0;
    let dist = 0;
    let shown: Phase = "idle";

    const show = (p: Phase) => {
      if (p === shown || !alive) return;
      shown = p;
      setPhase(p);
    };

    // The dot follows the finger directly; React state only changes at the phase edges.
    const place = (d: number, animate: boolean) => {
      const el = dot.current;
      if (!el) return;
      el.style.transition = animate ? "transform 220ms var(--ease), opacity 220ms" : "none";
      el.style.transform = `translate(-50%, ${d - 52}px)`;
      el.style.opacity = String(Math.min(1, d / 40));
      if (icon.current) icon.current.style.transform = `rotate(${Math.round(d * 3)}deg)`;
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
      dist = Math.min(MAX, Math.max(0, dy) * 0.5);
      place(dist, false);
      show(dist >= THRESHOLD ? "armed" : "pulling");
    };

    const run = async () => {
      busy = true;
      show("refreshing");
      setSaid("");
      const el = dot.current;
      if (el) {
        el.style.transition = "transform 220ms var(--ease)";
        el.style.transform = "translate(-50%, 12px)";
        el.style.opacity = "1";
      }
      if (icon.current) icon.current.style.transform = "";
      const started = Date.now();
      try {
        await refresh.current();
      } catch {
        /* each list shows its own error */
      }
      const left = MIN_SPIN_MS - (Date.now() - started);
      if (left > 0) await new Promise((r) => window.setTimeout(r, left));
      busy = false;
      if (!alive) return;
      place(0, true);
      show("idle");
      setSaid(navigator.onLine ? "Updated" : "You're offline. Nothing new was loaded.");
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
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return (
    <>
      <div ref={dot} className="ptr" data-phase={phase} aria-hidden="true">
        <span ref={icon} className="ptr-icon">
          <RefreshCw />
        </span>
      </div>
      <p className="vh" role="status" aria-live="polite">
        {phase === "refreshing" ? "Refreshing" : said}
      </p>
    </>
  );
}
