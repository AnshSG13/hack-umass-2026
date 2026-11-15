"use client";

// A Back button that stays reachable on long pages (a recipe's steps, a trip's days). The
// page's own Back sits at the top and scrolls away; once it has, this one fades in at the
// top left, over the content, and does the same thing.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { useApp } from "@/components/shell";

const SHOW_AFTER = 160; // px scrolled: about when the page's own Back has gone

export function ScrollBack() {
  const { goBack } = useApp();
  const [shown, setShown] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > SHOW_AFTER);
    // Read once after mount (a page restored mid-scroll) and then on every scroll.
    const id = window.requestAnimationFrame(() => {
      setHost(document.body);
      onScroll();
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  if (!host) return null;
  return createPortal(
    <button
      type="button"
      className="scroll-back"
      data-shown={shown ? "" : undefined}
      aria-label="Back"
      aria-hidden={!shown}
      tabIndex={shown ? 0 : -1}
      onClick={goBack}
    >
      <Icon name="back" />
    </button>,
    host,
  );
}
