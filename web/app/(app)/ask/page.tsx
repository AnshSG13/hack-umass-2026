"use client";

// Ask: questions over your saves, answered as text plus tiles that open the Reel page,
// with plans coming back as plan cards you confirm. Home's idea chips, the orb's dictation
// and "Ask about this" hand their question over through the shell's store.

import { Suspense, useEffect, useId, useRef, useState } from "react";
import { Square } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { StepLines } from "@/components/agent-activity";
import { KindChip } from "@/components/bits";
import { CHATS_KEY, ChatList } from "@/components/chat-list";
import { Icon } from "@/components/icons";
import { PlanCard } from "@/components/plan-card";
import { Streamed } from "@/components/streamed";
import { useAskStore, type AskTurn } from "@/components/shell";
import { api, chatStream, fetcher, STOPPED } from "@/lib/api";
import { kindOf, kindTint, tint, type KindColor } from "@/lib/kinds";
import type { AskCard, ChatEvent, Discussion } from "@/lib/types";

const GENERIC_ERROR = "Ask didn't answer. Try again.";
const CHAT_GONE = "That chat isn't here any more.";

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A kept Ask chat as the page's turns: each question with the answer and reels it got. */
function toTurns(d: Discussion): AskTurn[] {
  const turns: AskTurn[] = [];
  for (const m of d.messages) {
    if (m.role === "user") {
      turns.push({ id: turns.length + 1, question: m.text, steps: [], cards: [], tickets: [], answer: null, error: null, done: true });
    } else if (turns.length > 0) {
      const t = turns[turns.length - 1];
      t.answer = {
        text: m.text,
        confidence: m.confidence ?? "high",
        followUps: m.follow_ups ?? [],
        sources: m.web ? (m.sources ?? []) : undefined,
      };
      t.cards = m.cards ?? [];
    }
  }
  return turns.filter((t) => t.answer !== null);
}
const IDEA_COLORS: KindColor[] = ["peach", "butter", "rose", "sky", "mint", "lavender"];

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
      return {
        ...turn,
        answer: {
          text: e.text,
          confidence: e.confidence,
          followUps: e.follow_ups ?? [],
          sources: e.web ? (e.sources ?? []) : undefined,
        },
      };
    case "error":
      return { ...turn, error: e.message || GENERIC_ERROR, done: true };
    case "done":
      return { ...turn, done: true, steps: turn.steps.map((s) => ({ ...s, state: "done" as const })) };
    default:
      return turn;
  }
}

function ReelCard({ card }: { card: AskCard }) {
  const kind = kindOf(card.type);
  return (
    <Link
      href={card.at_sec !== undefined ? `/s/${card.save_id}?t=${card.at_sec}` : `/s/${card.save_id}`}
      className="tile"
      aria-label={card.at_label ? `Open ${card.title} at ${card.at_label}` : `Open ${card.title}`}
    >
      <span className="tile-media">
        {card.thumb_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.thumb_url} alt="" loading="lazy" />
        ) : (
          <span className="tile-ph" style={kindTint(card.type)}>
            <Icon name={kind?.icon ?? "bookmark"} />
          </span>
        )}
      </span>
      <span className="tile-meta">
        <KindChip type={card.type} label={card.category ?? undefined} />
        Saved {card.saved_on}
      </span>
      <span className="tile-title">{card.title}</span>
      {card.snippet && <span className="tile-snip">{card.snippet}</span>}
      {card.at_label && (
        <span className="tile-at">
          <Icon name="clock" />
          Said at {card.at_label}
        </span>
      )}
    </Link>
  );
}

function Turn({
  turn,
  live,
  onRetry,
  onFollowUp,
}: {
  turn: AskTurn;
  /** The newest turn, answered in this visit: its words arrive one by one. */
  live: boolean;
  onRetry: () => void;
  /** Set on the newest turn only: older turns don't offer next questions. */
  onFollowUp?: (text: string) => void;
}) {
  const none = turn.answer?.confidence === "none";
  const working = !turn.done && !turn.answer;
  const text = none
    ? turn.cards.length > 0
      ? "Nothing in your saves matches that. Closest ones:"
      : "Nothing in your saves matches that."
    : (turn.answer?.text ?? "");
  const followUps = turn.done && !turn.error ? (turn.answer?.followUps ?? []) : [];
  return (
    <div className="turn">
      <div className="said-wrap">
        <p className="bubble">{turn.question}</p>
        {turn.spoken && (
          <span className="said-tag">
            <span className="wave still" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            Said out loud
          </span>
        )}
      </div>

      {working && !turn.error && (
        <StepLines
          steps={turn.steps.length > 0 ? turn.steps : [{ label: "Sending your question", state: "current", ms: null }]}
          live
        />
      )}

      {turn.answer && (
        <div>
          <p className="answer">
            <Streamed text={text} live={live} />
          </p>
          {turn.answer.confidence === "low" && !turn.answer.sources && <p className="answer-note">Best match I found.</p>}
          {turn.done && turn.answer.sources && turn.answer.sources.length > 0 && (
            <div className="web-sources">
              <p className="web-label">
                <Icon name="search" />
                From the web.
              </p>
              <ol>
                {turn.answer.sources.map((s) => (
                  <li key={s.n}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      <span className="web-n">{s.n}</span>
                      {s.title || siteOf(s.url)}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {turn.cards.length > 0 && (
        <div className="rail">
          {turn.cards.map((c) => (
            <ReelCard key={c.save_id} card={c} />
          ))}
        </div>
      )}

      {turn.tickets.length > 0 && (
        <div className="stack-col" style={{ marginTop: 0 }}>
          {turn.tickets.map((t) => (
            <PlanCard key={t.save_id} ticket={t} withReel />
          ))}
        </div>
      )}

      {onFollowUp && followUps.length > 0 && (
        <div className="follow">
          {followUps.map((q) => (
            <button key={q} type="button" className="follow-chip" onClick={() => onFollowUp(q)}>
              {q}
              <Icon name="send" />
            </button>
          ))}
        </div>
      )}

      {turn.error && (
        <div role="alert" className="ask-error">
          <p>{turn.error}</p>
          {(turn.error === GENERIC_ERROR || turn.error === STOPPED) && (
            <button type="button" className="btn" onClick={onRetry}>
              <Icon name="redo" />
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// The page reads ?chat= from the router, which needs a Suspense boundary to build.
export default function AskPage() {
  return (
    <Suspense>
      <AskInner />
    </Suspense>
  );
}

function AskInner() {
  const { turns, setTurns, chatId, setChatId, handoff, clearHandoff } = useAskStore();
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const linkedChat = useSearchParams().get("chat");
  const [openError, setOpenError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: chips } = useSWR<{ chips: string[] }>("/api/chips", fetcher, { revalidateOnFocus: false });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // The answer being written, so Stop can cancel it.
  const stopper = useRef<AbortController | null>(null);
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const handled = useRef(0);
  // Turns answered during this visit; ones already there when the page opened don't replay.
  const [liveIds, setLiveIds] = useState<number[]>([]);

  // Keep the newest message in view. A jump, not a scroll animation.
  const last = turns[turns.length - 1];
  const marker = `${turns.length}:${last?.steps.length ?? 0}:${last?.answer ? 1 : 0}:${last?.cards.length ?? 0}:${last?.tickets.length ?? 0}:${last?.error ? 1 : 0}:${last?.done ? 1 : 0}`;
  useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [marker, turns.length]);

  // A link to a kept chat (?chat=<id>, from the chat list): open it here, or over its reel
  // when it's a reel chat. The address goes back to /ask once it's read.
  useEffect(() => {
    if (!linkedChat) return;
    if (linkedChat === chatId) {
      router.replace("/ask", { scroll: false });
      return;
    }
    let gone = false;
    api<{ discussion: Discussion }>(`/api/discussions/${encodeURIComponent(linkedChat)}`)
      .then(({ discussion: d }) => {
        if (gone) return;
        if (d.kind === "reel" && d.save_id) {
          router.replace(`/s/${d.save_id}?chat=${d.id}`);
          return;
        }
        setTurns(toTurns(d));
        setChatId(d.id);
        setLiveIds([]);
        setOpenError(null);
        router.replace("/ask", { scroll: false });
      })
      .catch(() => {
        if (gone) return;
        setOpenError(CHAT_GONE);
        router.replace("/ask", { scroll: false });
      });
    return () => {
      gone = true;
    };
    // Only a new link should load; the store setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedChat]);

  async function removeChat() {
    const id = chatId;
    setConfirmDelete(false);
    if (id) {
      try {
        await api<{ ok: boolean }>(`/api/discussions/${id}`, { method: "DELETE" });
      } catch {
        /* already gone is the same result */
      }
      void mutate(CHATS_KEY);
    }
    newChat();
  }

  function newChat() {
    setConfirmDelete(false);
    setTurns([]);
    setChatId(null);
    setLiveIds([]);
    setDraft("");
    setOpenError(null);
    window.scrollTo({ top: 0 });
    inputRef.current?.focus({ preventScroll: true });
  }

  async function send(text: string, replaceId?: number, spoken?: boolean, startNew = false) {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setDraft("");
    setOpenError(null);
    const prior = startNew ? [] : turns.filter((t) => t.id !== replaceId);
    const into = startNew ? null : chatId;
    const history = prior
      .flatMap((t) => [
        { role: "user" as const, text: t.question },
        ...(t.answer ? [{ role: "assistant" as const, text: t.answer.text }] : []),
      ])
      .slice(-6);
    const id = prior.reduce((m, t) => Math.max(m, t.id), 0) + 1;
    if (startNew) setChatId(null);
    const fresh: AskTurn = {
      id,
      question: message,
      steps: [],
      cards: [],
      tickets: [],
      answer: null,
      error: null,
      done: false,
      spoken,
    };
    setTurns([...prior, fresh]);
    setLiveIds((ids) => [...ids, id]);
    const update = (fn: (t: AskTurn) => AskTurn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
    const controller = new AbortController();
    stopper.current = controller;
    await chatStream({ message, history, chat_id: into ?? undefined }, (e) => {
      if (e.type === "saved") {
        // Kept: later questions go into the same chat, and the list shows it.
        setChatId(e.chat_id);
        void mutate(CHATS_KEY);
        return;
      }
      // The chat was deleted elsewhere: the next question starts a new one.
      if (e.type === "error" && e.message === CHAT_GONE) setChatId(null);
      update((t) => applyEvent(t, e));
    }, controller.signal);
    stopper.current = null;
    // Stopped: an answer that already arrived stays; otherwise it says so, with Try again.
    if (controller.signal.aborted) {
      update((t) => (t.answer ? { ...t, done: true } : { ...t, done: true, error: STOPPED }));
      setSending(false);
      return;
    }
    // The stream ended: anything without an answer by now is an error.
    update((t) => (t.answer || t.error ? { ...t, done: true } : { ...t, done: true, error: GENERIC_ERROR }));
    setSending(false);
  }

  // A question handed over from Home, the orb or a Reel page. It lives in memory and is
  // cleared as it is taken, so a reload never sends it twice.
  useEffect(() => {
    if (!handoff || handoff.id === handled.current) return;
    handled.current = handoff.id;
    const taken = handoff;
    // On the next tick, and with no cleanup: clearing the handoff re-runs this effect,
    // and that must not cancel the send or the focus.
    window.setTimeout(() => {
      clearHandoff();
      // While an answer is still streaming, a new question waits in the input instead.
      // A question from elsewhere is a new topic: it starts its own chat.
      if (taken.send && taken.text.trim() && !sending) {
        void send(taken.text, undefined, taken.spoken, true);
        return;
      }
      if (taken.text) setDraft(taken.text);
      window.requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    }, 0);
    // `send` reads the turns of this render; the handoff id is what triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff, clearHandoff]);

  const empty = turns.length === 0;
  const ideas = chips?.chips ?? [];

  return (
    <div className="gutter">
      <header className="page-head ask-head">
        <h1 className="page-title">Ask</h1>
        {!empty && (
          <span className="ask-head-btns">
            {chatId && (
              <button
                type="button"
                className="add icon-only"
                aria-label="Delete this chat"
                disabled={sending}
                onClick={() => setConfirmDelete(true)}
              >
                <Icon name="trash" />
              </button>
            )}
            <button type="button" className="add" disabled={sending} onClick={newChat}>
              <Icon name="plus" />
              New chat
            </button>
          </span>
        )}
        {confirmDelete && chatId && (
          <div className="chat-confirm" role="alertdialog" aria-label="Delete this chat?">
            <p>Delete this chat? This can&apos;t be undone.</p>
            <div>
              <button type="button" className="btn btn-danger" onClick={() => void removeChat()}>
                Delete
              </button>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}
        {empty && <p className="page-sub">Ask about anything you&apos;ve saved, or say &ldquo;search the web&rdquo; to look something up. Your chats are kept here.</p>}
      </header>

      {empty ? (
        <>
          {openError && (
            <p role="alert" className="msg" style={{ marginTop: 16 }}>
              {openError}
            </p>
          )}
          {ideas.length > 0 && (
            <div className="ideas wrap" style={{ marginTop: 22 }}>
              {ideas.slice(0, 4).map((c, i) => (
                <button
                  key={c}
                  type="button"
                  className="idea"
                  style={tint(IDEA_COLORS[i % IDEA_COLORS.length])}
                  disabled={sending}
                  onClick={() => void send(c)}
                >
                  <Icon name="spark" />
                  {c}
                </button>
              ))}
            </div>
          )}
          <ChatList />
        </>
      ) : (
        <div className="chat">
          {turns.map((t) => (
            <Turn
              key={t.id}
              turn={t}
              live={liveIds.includes(t.id)}
              onRetry={() => void send(t.question, t.id, t.spoken)}
              onFollowUp={t.id === last?.id && !sending ? (q) => void send(q) : undefined}
            />
          ))}
        </div>
      )}
      {/* Room for the composer, which floats above the bar. */}
      <div ref={endRef} style={{ height: 96, scrollMarginBottom: 150 }} />

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <label htmlFor={inputId} className="vh">
          Ask about your saves
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          rows={1}
          placeholder="Ask about your saves"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        {sending ? (
          <button type="button" className="send is-stop" aria-label="Stop the answer" onClick={() => stopper.current?.abort()}>
            <Square aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="send" aria-label="Send" disabled={draft.trim().length === 0}>
            <Icon name="send" />
          </button>
        )}
      </form>
    </div>
  );
}
