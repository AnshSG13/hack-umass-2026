"use client";

// The glowing button in the bottom bar. Tap: open Ask. Press and hold: dictate a question
// with the browser's speech recognition and send it to Ask on release. Where the browser
// has no speech recognition, a hold is a tap.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface SpeechResultList {
  length: number;
  [index: number]: { 0: { transcript: string } };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: SpeechResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const HOLD_MS = 250;

export function Orb({
  appName,
  onOpen,
  onHeard,
  onProblem,
}: {
  appName: string;
  /** A tap (or a hold where dictation isn't available). */
  onOpen: () => void;
  /** Dictation finished with words. */
  onHeard: (text: string) => void;
  /** Dictation ended with nothing to send; the text says why. */
  onProblem: (message: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const pressed = useRef(false);
  const holdTimer = useRef<number | null>(null);
  const rec = useRef<Recognition | null>(null);
  const heard = useRef("");
  const problem = useRef<string | null>(null);
  const cancelled = useRef(false);

  // Latest callbacks, so the recognition handlers never call a stale one.
  const cb = useRef({ onOpen, onHeard, onProblem });
  useEffect(() => {
    cb.current = { onOpen, onHeard, onProblem };
  });

  useEffect(
    () => () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      cancelled.current = true;
      rec.current?.abort();
    },
    [],
  );

  function startListening(): boolean {
    const Ctor = recognitionCtor();
    if (!Ctor) return false;
    try {
      const r = new Ctor();
      r.lang = navigator.language || "en-US";
      r.interimResults = true;
      r.continuous = true;
      heard.current = "";
      problem.current = null;
      cancelled.current = false;
      r.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        heard.current = text;
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          problem.current = "The microphone is blocked for this site. Type your question instead.";
        } else if (e.error === "audio-capture") {
          problem.current = "No microphone was found. Type your question instead.";
        } else if (e.error === "network") {
          problem.current = "Dictation needs a connection. Type your question instead.";
        }
      };
      r.onend = () => {
        rec.current = null;
        setListening(false);
        if (cancelled.current) return;
        const text = heard.current.trim();
        heard.current = "";
        if (text) cb.current.onHeard(text);
        else cb.current.onProblem(problem.current ?? "Didn't catch that. Hold the button and speak.");
      };
      r.start();
      rec.current = r;
      return true;
    } catch {
      rec.current = null;
      return false;
    }
  }

  return (
    <>
      <div className={cn("listen", listening && "is-on")} aria-hidden="true">
        <span className="wave">
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
        Listening. Release to send.
      </div>
      <span className="orb-slot">
        <button
          type="button"
          className={cn("orb", listening && "is-listening")}
          aria-label={`Ask ${appName}. Hold to speak.`}
          onPointerDown={(e) => {
            if (e.button) return;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* older browsers */
            }
            pressed.current = true;
            holdTimer.current = window.setTimeout(() => {
              holdTimer.current = null;
              if (startListening()) setListening(true);
            }, HOLD_MS);
          }}
          onPointerUp={() => {
            if (!pressed.current) return;
            pressed.current = false;
            if (holdTimer.current !== null) {
              window.clearTimeout(holdTimer.current);
              holdTimer.current = null;
              cb.current.onOpen();
              return;
            }
            // Released after a hold: send what was heard, or behave like a tap without dictation.
            if (rec.current) rec.current.stop();
            else if (!listening) cb.current.onOpen();
          }}
          onPointerCancel={() => {
            pressed.current = false;
            if (holdTimer.current !== null) {
              window.clearTimeout(holdTimer.current);
              holdTimer.current = null;
            }
            if (rec.current) {
              cancelled.current = true;
              rec.current.abort();
            }
            setListening(false);
          }}
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => {
            // Pointer taps are handled above; this is the keyboard (Enter or Space).
            if (e.detail === 0) cb.current.onOpen();
          }}
        />
      </span>
      <span className="vh" role="status">
        {listening ? "Listening. Release to send." : ""}
      </span>
    </>
  );
}
