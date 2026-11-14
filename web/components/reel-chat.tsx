"use client";

// Chat about one reel. It belongs to the Reel page, not to Ask: the server already has
// the reel in the prompt, so there is nothing to search and nothing to explain first.
// Every discussion is saved with the reel and listed on its page (<Discussions />).

import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import useSWR, { useSWRConfig } from "swr";
import { useNow } from "@/components/bits";
import { Icon } from "@/components/icons";
import { Streamed } from "@/components/streamed";
import { api, ApiError, fetcher } from "@/lib/api";
import { plural, relativeTime } from "@/lib/format";
import { kindTint } from "@/lib/kinds";
import type { Discussion, DiscussionMessage, DiscussionSummary, SaveType } from "@/lib/types";

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

export function Discussions({ saveId, onOpen }: { saveId: string; onOpen: (id: string) => void }) {
  const { data } = useDiscussions(saveId);
  const now = useNow();
  const list = data?.discussions ?? [];
  if (list.length === 0) return null;
  return (
    <details className="said disc">
      <summary>
        <span className="disc-head">
          Discussions
          <span className="pill">{list.length}</span>
        </span>
        <Icon name="down" />
      </summary>
      <ul className="disc-list">
        {list.map((d) => (
          <li key={d.id}>
            <button type="button" className="disc-row" onClick={() => onOpen(d.id)} aria-haspopup="dialog">
              <span className="disc-ico" aria-hidden="true">
                <Icon name="ask" />
              </span>
              <span className="disc-text">
                <span className="disc-title">{d.title}</span>
                <span className="disc-meta">
                  {plural(d.questions, "question", "questions")} · {relativeTime(d.updated_at, now)}
                </span>
              </span>
              <Icon name="right" />
            </button>
          </li>
        ))}
      </ul>
    </details>
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
      {settled && message.from_reel === false && <p className="answer-note">Not from the reel.</p>}
    </div>
  );
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
function ChatPanel({ onOpenChange, saveId, title, type, thumbUrl, discussionId, onDiscussionId, onJump }: ChatProps) {
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = discussionId ? (data?.discussion.messages ?? []) : [];
  const sending = pending !== null && pending.error === null;
  const empty = messages.length === 0 && !pending && !(discussionId && isLoading);

  // Keep the newest message in view.
  const marker = `${messages.length}:${pending ? (pending.error ? 2 : 1) : 0}`;
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
      setPending(null);
      if (d.id !== discussionId) onDiscussionId(d.id);
      void mutate(discussionsKey(saveId));
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
          <button
            type="button"
            className="rc-btn"
            aria-label="Delete this discussion"
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="trash" />
          </button>
        )}
      </header>

      {confirmDelete && (
        <div className="rc-confirm" role="alertdialog" aria-label="Delete this discussion?">
          <p>Delete this discussion? This can&apos;t be undone.</p>
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

      <div className="rc-body">
        {empty && (
          <div className="rc-empty">
            <p className="rc-lead">What do you want to know?</p>
            <p className="rc-sub">Answers come from this reel. It&apos;s saved here when you&apos;re done.</p>
            <div className="rc-starters">
              {(STARTERS[type ?? "other"] ?? STARTERS.other).map((q) => (
                <button key={q} type="button" className="starter" onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
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

        {messages.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="bubble">
              {m.text}
            </p>
          ) : (
            <Answer
              key={i}
              message={m}
              live={i === liveAt}
              onShown={() =>
                endRef.current?.scrollIntoView({
                  block: "end",
                  behavior: "auto",
                })
              }
              onJump={(sec) => {
                onOpenChange(false);
                onJump(sec);
              }}
            />
          ),
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
                Reading the reel
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
