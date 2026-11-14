"use client";

// Ask (DESIGN.md 7.6, SPEC 12): questions over your saves, answered as text plus cards,
// with plans coming back as tickets you confirm.

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Send } from "lucide-react";
import { StepLines } from "@/components/agent-activity";
import { useAskStore, type AskTurn } from "@/components/shell";
import { CompactTicket, Thumb } from "@/components/ticket";
import { chatStream, fetcher } from "@/lib/api";
import { btnOutline, pageTitle } from "@/lib/styles";
import type { AskCard, ChatEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const GENERIC_ERROR = "Ask didn't answer. Try again.";

function applyEvent(turn: AskTurn, e: ChatEvent): AskTurn {
  switch (e.type) {
    case "step":
      return {
        ...turn,
        steps: [
          ...turn.steps.map((s) => ({ ...s, state: "done" as const })),
          { label: e.label, state: "current" as const, ms: null },
        ],
      };
    case "cards":
      return { ...turn, cards: e.cards };
    case "plans":
      return { ...turn, tickets: e.tickets };
    case "answer":
      return { ...turn, answer: { text: e.text, confidence: e.confidence } };
    case "error":
      return { ...turn, error: e.message || GENERIC_ERROR, done: true };
    case "done":
      return { ...turn, done: true, steps: turn.steps.map((s) => ({ ...s, state: "done" as const })) };
    default:
      return turn;
  }
}

function ReelCard({ card }: { card: AskCard }) {
  return (
    <Link
      href={`/s/${card.save_id}`}
      className="block w-[244px] shrink-0 rounded-[12px] border border-line bg-ticket p-3"
    >
      <span className="flex gap-3">
        <Thumb ticket={{ thumb_url: card.thumb_url, title: card.title, url: card.url, type: card.type }} className="h-[75px] w-14" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] leading-[1.3] font-semibold break-words text-ink">{card.title}</span>
          <span className="mt-1 block text-[13px] text-muted">Saved {card.saved_on}</span>
        </span>
      </span>
      {card.snippet && <span className="mt-2 line-clamp-2 block text-[13px] leading-[1.45] text-muted">{card.snippet}</span>}
    </Link>
  );
}

function Turn({ turn, onRetry }: { turn: AskTurn; onRetry: () => void }) {
  const none = turn.answer?.confidence === "none";
  const working = !turn.done && !turn.answer;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[12px] border border-line bg-ticket px-3 py-2 text-[16px] break-words text-ink">
          {turn.question}
        </p>
      </div>

      {working && !turn.error && (
        <div>
          <StepLines steps={turn.steps.length > 0 ? turn.steps : [{ label: "Sending your question", state: "current", ms: null }]} live />
        </div>
      )}

      {turn.answer && (
        <div>
          <p className="text-[16px] whitespace-pre-line text-ink">
            {none
              ? turn.cards.length > 0
                ? "Nothing in your saves matches that. Closest ones:"
                : "Nothing in your saves matches that."
              : turn.answer.text}
          </p>
          {turn.answer.confidence === "low" && <p className="mt-1 text-[14px] text-muted">Best match I found.</p>}
        </div>
      )}

      {turn.tickets.length > 0 && (
        <div className="flex flex-col gap-3">
          {turn.tickets.map((t) => (
            <CompactTicket key={t.save_id} ticket={t} withAction />
          ))}
        </div>
      )}

      {turn.cards.length > 0 && (
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
          {turn.cards.map((c) => (
            <ReelCard key={c.save_id} card={c} />
          ))}
        </div>
      )}

      {turn.error && (
        <div role="alert">
          <p className="text-[16px] text-ink">{turn.error}</p>
          {turn.error === GENERIC_ERROR && (
            <button type="button" className={cn(btnOutline, "mt-2")} onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function AskPage() {
  const { turns, setTurns } = useAskStore();
  const { data: chips } = useSWR<{ chips: string[] }>("/api/chips", fetcher, { revalidateOnFocus: false });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const inputId = useId();
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view. A jump, not a scroll animation.
  const last = turns[turns.length - 1];
  const marker = `${turns.length}:${last?.steps.length ?? 0}:${last?.answer ? 1 : 0}:${last?.cards.length ?? 0}:${last?.tickets.length ?? 0}:${last?.error ? 1 : 0}`;
  useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [marker, turns.length]);

  async function send(text: string, replaceId?: number) {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setDraft("");
    const prior = turns.filter((t) => t.id !== replaceId);
    const history = prior
      .flatMap((t) => [
        { role: "user" as const, text: t.question },
        ...(t.answer ? [{ role: "assistant" as const, text: t.answer.text }] : []),
      ])
      .slice(-6);
    const id = turns.reduce((m, t) => Math.max(m, t.id), 0) + 1;
    const fresh: AskTurn = { id, question: message, steps: [], cards: [], tickets: [], answer: null, error: null, done: false };
    setTurns([...prior, fresh]);
    const update = (fn: (t: AskTurn) => AskTurn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
    await chatStream({ message, history }, (e) => update((t) => applyEvent(t, e)));
    // The stream ended: anything without an answer by now is an error.
    update((t) => (t.answer || t.error ? { ...t, done: true } : { ...t, done: true, error: GENERIC_ERROR }));
    setSending(false);
  }

  const empty = turns.length === 0;

  return (
    <div className="pb-24">
      <h1 className={pageTitle}>Ask</h1>

      {empty ? (
        <div className="mt-4">
          <p className="text-[16px] text-ink">Ask about anything you&apos;ve saved.</p>
          {chips && chips.chips.length > 0 && (
            <ul className="mt-4 flex flex-col items-start gap-2">
              {chips.chips.slice(0, 4).map((c) => (
                <li key={c} className="max-w-full">
                  <button
                    type="button"
                    className="inline-flex min-h-11 max-w-full items-center rounded-[22px] border border-line-strong bg-ticket px-4 py-2 text-left text-[15px] text-ink"
                    disabled={sending}
                    onClick={() => void send(c)}
                  >
                    <span className="line-clamp-2">{c}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          {turns.map((t) => (
            <Turn key={t.id} turn={t} onRetry={() => void send(t.question, t.id)} />
          ))}
        </div>
      )}
      <div ref={endRef} className="h-px scroll-mb-40" />

      <form
        className="sheet-frame fixed bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 flex items-end gap-2 border-t border-line bg-paper px-4 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Ask about your saves
        </label>
        <textarea
          id={inputId}
          rows={1}
          placeholder="Ask about your saves"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-[12px] border border-line-strong bg-ticket px-3 py-[9px] text-[16px] leading-[1.5] text-ink [field-sizing:content] placeholder:text-muted"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <button
          type="submit"
          aria-label="Send"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] border-2 border-ink bg-highlighter text-ink disabled:opacity-60"
          disabled={sending || draft.trim().length === 0}
        >
          <Send aria-hidden="true" className="size-5" />
        </button>
      </form>
    </div>
  );
}
