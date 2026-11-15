"use client";

// Chat about one reel. It belongs to the Reel page, not to Ask: the server already has
// the reel in the prompt, so there is nothing to search and nothing to explain first.
// Every discussion is saved with the reel and listed on its page (<Discussions />).

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import useSWR, { useSWRConfig } from "swr";
import { useNow } from "@/components/bits";
import { CHATS_KEY } from "@/components/chat-list";
import {
  DeliverableCard,
  deliverablesKey,
  SendProgress,
  SendSuggestions,
  useDeliverables,
  useSendMaker,
} from "@/components/deliverables";
import { Icon } from "@/components/icons";
import { Streamed } from "@/components/streamed";
import { api, ApiError, fetcher } from "@/lib/api";
import { plural, relativeTime } from "@/lib/format";
import { kindTint } from "@/lib/kinds";
import type { Deliverable, Discussion, DiscussionMessage, DiscussionSummary, SaveType } from "@/lib/types";

const NO_ANSWER = "Ask didn't answer. Try again.";

/** First questions worth asking, by what the reel is. Plain strings: no model call. */
const STARTERS: Record<SaveType, string[]> = {
  recipe: ["What can I swap out?", "Can I make this ahead?", "What's the step people get wrong?"],
  workout: ["How do I make this easier?", "What should I feel working?", "How often should I do this?"],
  place: ["What should I order or see first?", "When is the best time to go?", "What did they say to skip?"],
  event: ["What do I need to book?", "What should I know before going?", "Is there anything like it later?"],
  product: ["Who is this best for?", "What's the catch?", "What did they compare it to?"],
  tip: ["Give me the short version", "What's the first step?", "What did they say not to do?"],
  other: ["What is this reel about?", "What's the main point?", "Is there anything to do with it?"],
};

export function discussionsKey(saveId: string): string {
  return `/api/saves/${saveId}/discussions`;
}

export function useDiscussions(saveId: string | null | undefined) {
  return useSWR<{ discussions: DiscussionSummary[] }>(saveId ? discussionsKey(saveId) : null, fetcher);
}

// ---- the button on the Reel page ----

export function AskAboutButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="btn btn-glow" onClick={onClick} disabled={disabled} aria-haspopup="dialog">
      <Icon name="ask" />
      <span>Ask about this</span>
    </button>
  );
}

// ---- the list on the Reel page ----

const REEL_FIRST = 3;

/** One kept chat about this reel, as a row that opens it. */
function ReelChatRow({ d, now, onOpen }: { d: DiscussionSummary; now: number; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="chat-row" onClick={() => onOpen(d.id)} aria-haspopup="dialog">
      <span className="chat-thumb is-ask" aria-hidden="true">
        <Icon name="ask" />
      </span>
      <span className="chat-text">
        <span className="chat-title">{d.title}</span>
        {d.preview && <span className="chat-preview">{d.preview}</span>}
        <span className="chat-meta">
          {plural(d.questions, "question", "questions")} · {relativeTime(d.updated_at, now)}
        </span>
      </span>
      <Icon name="right" />
    </button>
  );
}

/** The chats kept with this reel, open on its page so they're easy to pick up again. */
export function Discussions({ saveId, onOpen }: { saveId: string; onOpen: (id: string) => void }) {
  const { data } = useDiscussions(saveId);
  const now = useNow();
  const [all, setAll] = useState(false);
  const list = data?.discussions ?? [];
  if (list.length === 0) return null;
  const shown = all ? list : list.slice(0, REEL_FIRST);
  return (
    <section className="chats reel-chats" aria-labelledby="reel-chats-h">
      <h2 className="chats-h" id="reel-chats-h">
        Your chats about this
      </h2>
      <ul className="chats-list">
        {shown.map((d) => (
          <li key={d.id}>
            <ReelChatRow d={d} now={now} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      {list.length > REEL_FIRST && (
        <button type="button" className="chats-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </section>
  );
}

// ---- the chat ----

interface Pending {
  question: string;
  error: string | null;
}

function Answer({
  message,
  live,
  onJump,
  onShown,
}: {
  message: DiscussionMessage;
  live: boolean;
  onJump: (sec: number) => void;
  onShown: () => void;
}) {
  const [settled, setSettled] = useState(!live);
  return (
    <div className="rc-answer">
      <p className="answer">
        <Streamed
          text={message.text}
          live={live}
          onDone={() => {
            setSettled(true);
            onShown();
          }}
        />
      </p>
      {settled && typeof message.at_sec === "number" && (
        <button type="button" className="at-chip" onClick={() => onJump(message.at_sec as number)}>
          <Icon name="clock" />
          Said at {message.at_label}
          <Icon name="right" />
        </button>
      )}
      {settled && message.web && message.macros && <Macros macros={message.macros} />}
      {settled && message.web && (message.sources?.length ?? 0) > 0 && (
        <div className="web-sources">
          <p className="web-label">
            <Icon name="search" />
            From the web. The reel doesn&apos;t say.
          </p>
          <ol>
            {message.sources!.map((s) => (
              <li key={s.n}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  <span className="web-n">{s.n}</span>
                  {s.title || new URL(s.url).hostname}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
      {settled && message.from_reel === false && !message.web && <p className="answer-note">Not from the reel.</p>}
    </div>
  );
}

const MACRO_ROWS: { key: keyof NonNullable<DiscussionMessage["macros"]>["values"]; label: string; unit: string }[] = [
  { key: "calories", label: "Calories", unit: "" },
  { key: "protein_g", label: "Protein", unit: " g" },
  { key: "carbs_g", label: "Carbs", unit: " g" },
  { key: "fat_g", label: "Fat", unit: " g" },
  { key: "fiber_g", label: "Fiber", unit: " g" },
  { key: "sugar_g", label: "Sugar", unit: " g" },
  { key: "sodium_mg", label: "Sodium", unit: " mg" },
];

/** A recipe's nutrition from the web: only numbers the server kept with a source. */
function Macros({ macros }: { macros: NonNullable<DiscussionMessage["macros"]> }) {
  const rows = MACRO_ROWS.filter((r) => macros.values[r.key]);
  if (rows.length === 0) return null;
  const per = macros.per === "serving" ? (macros.servings ? `Per serving, serves ${macros.servings}` : "Per serving") : "Whole recipe";
  return (
    <figure className="macros">
      <figcaption>
        {per} · {macros.basis === "published" ? "published for this recipe" : "estimated from the ingredients"}
      </figcaption>
      <dl>
        {rows.map((r) => {
          const v = macros.values[r.key]!;
          return (
            <div key={r.key}>
              <dt>{r.label}</dt>
              <dd>
                {v.value}
                {r.unit}
                {v.source > 0 && <sup aria-label={`source ${v.source}`}>{v.source}</sup>}
              </dd>
            </div>
          );
        })}
      </dl>
    </figure>
  );
}

/** An answer from the reel alone takes a few seconds. Past that, the chat has gone to the
 * web for it, so the line says so. */
function WaitingLine() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const a = window.setTimeout(() => setStage(1), 4500);
    const b = window.setTimeout(() => setStage(2), 12000);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, []);
  return <>{["Reading the reel", "The reel doesn't say. Searching the web", "Reading what the web says"][stage]}</>;
}

interface ChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saveId: string;
  title: string;
  type: SaveType | null;
  thumbUrl: string | null;
  /** null: a new discussion, created by its first question. */
  discussionId: string | null;
  onDiscussionId: (id: string | null) => void;
  /** "Said at 0:11": show that line of the transcript on the page behind. */
  onJump: (sec: number) => void;
  /** The servings picked on the Reel page, when the person changed them. */
  servings?: number | null;
}

export function ReelChat(props: ChatProps) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        {/* The panel focuses its own question box, not the close button. */}
        <Dialog.Content className="rc" aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
          <ChatPanel {...props} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Mounted only while the chat is open, so each opening starts with clean state.
function ChatPanel({
  onOpenChange,
  saveId,
  title,
  type,
  thumbUrl,
  discussionId,
  onDiscussionId,
  onJump,
  servings,
}: ChatProps) {
  const { mutate } = useSWRConfig();
  const {
    data,
    error,
    isLoading,
    mutate: mutateOne,
  } = useSWR<{ discussion: Discussion }>(discussionId ? `/api/discussions/${discussionId}` : null, fetcher, {
    revalidateOnFocus: false,
  });
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [liveAt, setLiveAt] = useState<number | null>(null); // index of the answer still being written out
  const [writing, setWriting] = useState(false); // true until that answer's last word is out
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = discussionId ? (data?.discussion.messages ?? []) : [];
  const sending = pending !== null && pending.error === null;
  const empty = messages.length === 0 && !pending && !(discussionId && isLoading);
  // Earlier chats on this reel, offered on the start screen so one can be picked up again.
  const { data: earlier } = useDiscussions(saveId);
  const now = useNow();
  const earlierChats = (earlier?.discussions ?? []).slice(0, 3);

  // Something to send: what this reel can make now, offered under the newest answer, and
  // the cards made in this sitting, each kept after the message it was made under.
  const { data: sendable } = useDeliverables(saveId, discussionId);
  const [cards, setCards] = useState<{ d: Deliverable; after: number }[]>([]);
  const count = useRef(0);
  useEffect(() => {
    count.current = messages.length;
  }, [messages.length]);
  const maker = useSendMaker({
    saveId,
    discussionId,
    servings,
    // Making the same kind again updates it: the old card gives way to the new one.
    onMade: (d) => setCards((cur) => [...cur.filter((c) => c.d.id !== d.id), { d, after: count.current }]),
  });
  const options = sendable?.options ?? [];
  const last = messages.length - 1;
  const settledAnswer = !sending && !writing && last >= 0 && messages[last].role === "assistant";
  const suggest = options.length > 0 && settledAnswer;
  // Next questions the answer suggested: one tap asks them.
  const followUps = settledAnswer ? (messages[last].follow_ups ?? []) : [];

  function newChat() {
    setCards([]);
    setLiveAt(null);
    setWriting(false);
    setPending(null);
    setConfirmDelete(false);
    setDraft("");
    onDiscussionId(null);
    inputRef.current?.focus({ preventScroll: true });
  }

  // Keep the newest message in view.
  const marker = `${messages.length}:${pending ? (pending.error ? 2 : 1) : 0}:${maker.steps ? 1 : 0}:${maker.problem ? 1 : 0}`;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [marker]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  async function send(text: string) {
    const question = text.trim().replace(/\s+/g, " ");
    if (!question || sending) return;
    setDraft("");
    setPending({ question, error: null });
    try {
      const r = await api<{ discussion: Discussion }>(discussionsKey(saveId), {
        body: { message: question, discussion_id: discussionId ?? undefined },
      });
      const d = r.discussion;
      // Seed the cache for this discussion before switching to it, so nothing flashes.
      await mutate(`/api/discussions/${d.id}`, { discussion: d }, { revalidate: false });
      setLiveAt(d.messages.length - 1);
      setWriting(true);
      setPending(null);
      if (d.id !== discussionId) onDiscussionId(d.id);
      void mutate(discussionsKey(saveId));
      void mutate(CHATS_KEY);
      // An answered question can add an option ("Notes from this chat").
      void mutate(deliverablesKey(saveId, d.id));
    } catch (e) {
      setPending({
        question,
        error: e instanceof ApiError && e.status !== 503 ? e.message : NO_ANSWER,
      });
    }
  }

  async function remove() {
    if (!discussionId) return;
    try {
      await api<{ ok: boolean }>(`/api/discussions/${discussionId}`, {
        method: "DELETE",
      });
    } catch {
      /* already gone is the same result */
    }
    void mutate(discussionsKey(saveId));
    void mutate(CHATS_KEY);
    onDiscussionId(null);
    onOpenChange(false);
  }

  return (
    <>
      <header className="rc-head">
        <Dialog.Close className="rc-btn" aria-label="Back to the reel">
          <Icon name="back" />
        </Dialog.Close>
        <span className="rc-thumb" style={kindTint(type)} aria-hidden="true">
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl} alt="" />
          ) : (
            <Icon name="bookmark" />
          )}
        </span>
        <Dialog.Title className="rc-title">{title}</Dialog.Title>
        {discussionId && (
          <>
            <button type="button" className="rc-btn" aria-label="Start a new chat" disabled={sending} onClick={newChat}>
              <Icon name="plus" />
            </button>
            <button type="button" className="rc-btn" aria-label="Delete this chat" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" />
            </button>
          </>
        )}
      </header>

      {confirmDelete && (
        <div className="rc-confirm" role="alertdialog" aria-label="Delete this chat?">
          <p>Delete this chat? This can&apos;t be undone.</p>
          <div>
            <button type="button" className="btn btn-danger" onClick={() => void remove()}>
              Delete
            </button>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {/* For screen readers: "Made: Itinerary to send", and the trip being built first. */}
      <p className="vh" role="status">
        {maker.said}
      </p>

      <div className="rc-body">
        {empty && (
          <div className="rc-empty">
            <p className="rc-lead">What do you want to know?</p>
            <p className="rc-sub">
              Answers come from this reel, or the web when it doesn&apos;t say. Say &ldquo;search the web&rdquo; to go
              straight there. Chats are kept with the reel and in Ask.
            </p>
            <div className="rc-starters">
              {(STARTERS[type ?? "other"] ?? STARTERS.other).map((q) => (
                <button key={q} type="button" className="starter" onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
            {earlierChats.length > 0 && (
              <div className="rc-earlier">
                <p className="rc-earlier-h">Pick up where you left off</p>
                <ul className="chats-list">
                  {earlierChats.map((d) => (
                    <li key={d.id}>
                      <ReelChatRow d={d} now={now} onOpen={(id) => onDiscussionId(id)} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {discussionId && isLoading && messages.length === 0 && (
          <div role="status" className="rc-loading">
            <span className="vh">Loading this discussion</span>
            <span
              className="skel"
              style={{
                height: 40,
                width: "62%",
                alignSelf: "flex-end",
                borderRadius: 20,
              }}
            />
            <span className="skel" style={{ height: 14, width: "92%" }} />
            <span className="skel" style={{ height: 14, width: "74%" }} />
          </div>
        )}

        {discussionId && error && messages.length === 0 && !pending && (
          <div role="alert" className="ask-error">
            <p>This discussion didn&apos;t load. Check your connection.</p>
            <button type="button" className="btn" onClick={() => void mutateOne()}>
              <Icon name="redo" />
              Try again
            </button>
          </div>
        )}

        {messages.map((m, i) => (
          <Fragment key={i}>
            {m.role === "user" ? (
              <p className="bubble">{m.text}</p>
            ) : (
              <Answer
                message={m}
                live={i === liveAt}
                onShown={() => {
                  setWriting(false);
                  endRef.current?.scrollIntoView({
                    block: "end",
                    behavior: "auto",
                  });
                }}
                onJump={(sec) => {
                  onOpenChange(false);
                  onJump(sec);
                }}
              />
            )}
            {i === last && followUps.length > 0 && (
              <div className="follow rc-follow">
                {followUps.map((q) => (
                  <button key={q} type="button" className="follow-chip" onClick={() => void send(q)}>
                    {q}
                    <Icon name="send" />
                  </button>
                ))}
              </div>
            )}
            {i === last && suggest && (
              <SendSuggestions options={options} busy={maker.busy !== null} onPick={maker.make} />
            )}
            {cards.map((c) =>
              // A card whose message is gone (it shouldn't be) still shows, at the end.
              Math.min(c.after, messages.length) === i + 1 ? (
                <DeliverableCard key={c.d.id} deliverable={c.d} reveal />
              ) : null,
            )}
          </Fragment>
        ))}

        {maker.steps && <SendProgress steps={maker.steps} />}
        {maker.problem && (
          <p role="alert" className="plan-error">
            {maker.problem}
          </p>
        )}

        {pending && (
          <>
            <p className="bubble">{pending.question}</p>
            {pending.error === null ? (
              <p className="thinking" role="status">
                <span className="dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <WaitingLine key={pending.question} />
              </p>
            ) : (
              <div role="alert" className="ask-error">
                <p>{pending.error}</p>
                {pending.error === NO_ANSWER && (
                  <button type="button" className="btn" onClick={() => void send(pending.question)}>
                    <Icon name="redo" />
                    Try again
                  </button>
                )}
              </div>
            )}
          </>
        )}
        <div ref={endRef} className="rc-end" />
      </div>

      <form
        className="composer rc-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <label htmlFor={inputId} className="vh">
          Ask about this reel
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          rows={1}
          placeholder="Ask about this reel"
          value={draft}
          maxLength={1000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <button type="submit" className="send" aria-label="Send" disabled={sending || draft.trim().length === 0}>
          <Icon name="send" />
        </button>
      </form>
    </>
  );
}
