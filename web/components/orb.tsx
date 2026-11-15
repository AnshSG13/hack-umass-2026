"use client";

// The glowing button in the bottom bar. Tap: open Ask. Press and hold: dictate a question
// with the browser's speech recognition and send it to Ask on release. While you hold, a
// full layer shows your words as they are heard: settled words in ink, the last ones in
// grey while they can still change. Where the browser has no speech recognition, a hold
// is a tap.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface SpeechResultList {
  length: number;
  [index: number]: { isFinal?: boolean; 0: { transcript: string } };
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
  // A tap lights the orb the way a hold does, briefly, while Ask opens.
  const [flash, setFlash] = useState(0);
  const flashTimer = useRef<number | null>(null);
  function lightUp() {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlash((n) => n + 1);
    flashTimer.current = window.setTimeout(() => setFlash(0), 1300);
    // A small tap of feedback where the phone supports it (Android; iPhone has no web vibration).
    navigator.vibrate?.(10);
  }
  // Under the finger, before it is a tap or a hold: the orb gives a little.
  const [pressing, setPressing] = useState(false);
  // What has been heard so far: words that are settled, and the tail that may still change.
  const [words, setWords] = useState({ settled: "", tail: "" });
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
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
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
        let settled = "";
        let tail = "";
        for (let i = 0; i < e.results.length; i++) {
          if (e.results[i].isFinal) settled += e.results[i][0].transcript;
          else tail += e.results[i][0].transcript;
        }
        heard.current = settled + tail;
        setWords({ settled: settled.trim(), tail: tail.trim() });
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
      setWords({ settled: "", tail: "" });
      return true;
    } catch {
      rec.current = null;
      return false;
    }
  }

  return (
    <>
      {listening &&
        createPortal(
          <div className="voice" aria-hidden="true">
            <div className="voice-glow" />
            <div className="voice-col">
              {words.settled || words.tail ? (
                <p className="voice-words">
                  {words.settled}
                  {words.settled && words.tail ? " " : ""}
                  {words.tail && <span className="tail">{words.tail}</span>}
                </p>
              ) : (
                <p className="voice-words is-waiting">Go ahead, I&apos;m listening.</p>
              )}
              <p className="voice-hint">
                <span className="wave">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                Release to send
              </p>
            </div>
          </div>,
          document.body,
        )}
      <span className="orb-slot">
        {/* On a tap: two pastel rings ripple out from the orb. */}
        {flash > 0 && !listening && (
          <span key={`r${flash}`} className="orb-ripple" aria-hidden="true">
            <span />
            <span />
          </span>
        )}
        <button
          type="button"
          key={flash ? `f${flash}` : "orb"}
          className={cn(
            "orb",
            listening && "is-listening",
            pressing && !listening && "is-pressed",
            flash > 0 && !listening && !pressing && "is-tapped",
          )}
          aria-label={`Ask ${appName}. Hold to speak.`}
          onPointerDown={(e) => {
            if (e.button) return;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* older browsers */
            }
            pressed.current = true;
            setPressing(true);
            holdTimer.current = window.setTimeout(() => {
              holdTimer.current = null;
              if (startListening()) setListening(true);
            }, HOLD_MS);
          }}
          onPointerUp={() => {
            setPressing(false);
            if (!pressed.current) return;
            pressed.current = false;
            if (holdTimer.current !== null) {
              window.clearTimeout(holdTimer.current);
              holdTimer.current = null;
              lightUp();
              cb.current.onOpen();
              return;
            }
            // Released after a hold: send what was heard, or behave like a tap without dictation.
            if (rec.current) rec.current.stop();
            else if (!listening) cb.current.onOpen();
          }}
          onPointerCancel={() => {
            setPressing(false);
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
            if (e.detail === 0) {
              lightUp();
              cb.current.onOpen();
            }
          }}
        />
      </span>
      {/* And as Ask opens, a soft glow runs around the edge of the screen, the way Siri does. */}
      {flash > 0 &&
        !listening &&
        createPortal(<div key={`g${flash}`} className="ask-glow" aria-hidden="true" />, document.body)}
      <span className="vh" role="status">
        {listening ? "Listening. Release to send." : ""}
      </span>
    </>
  );
}
