"use client";

// Text that arrives word by word. The API answers in one piece; this only paces how the
// words appear, so a long answer reads as being written and never as a wall landing at
// once. With reduced motion, or when `live` is false, the whole text shows straight away.

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

const WORD_MS = 28;

export function Streamed({ text, live, onDone }: { text: string; live: boolean; onDone?: () => void }) {
  const reduce = useReducedMotion();
  const words = text.split(/(\s+)/);
  const animate = live && !reduce;
  const [shown, setShown] = useState(animate ? 0 : words.length);

  useEffect(() => {
    if (!animate) {
      // With reduced motion the whole answer is there at once: it is done straight away.
      if (live) onDone?.();
      return;
    }
    if (shown >= words.length) {
      onDone?.();
      return;
    }
    // Whitespace tokens ride along with the word before them.
    const id = window.setTimeout(() => setShown((n) => Math.min(words.length, n + 2)), WORD_MS);
    return () => window.clearTimeout(id);
    // onDone is read when the last word lands; a new callback must not restart the pace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, live, shown, words.length]);

  if (!animate) return <>{text}</>;
  return (
    <>
      <span aria-hidden="true">{words.slice(0, shown).join("")}</span>
      {/* Screen readers get the whole answer once, not a word at a time. */}
      <span className="vh">{text}</span>
    </>
  );
}
