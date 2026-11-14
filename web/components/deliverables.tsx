"use client";

// Something finished to send, made from one reel: an itinerary, a grocery list, an invite.
// The chat about a reel suggests them under its newest answer; the Reel page has the same
// list behind "Send something". Making one is instant and free, except an itinerary whose
// trip plan isn't built yet: that build is paid for, so it only ever starts on the tap.
// Every label, hint, title, line and link is shown as the server sent it
// (GET and POST /api/saves/{id}/deliverables).

import { useEffect, useId, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { StepLines } from "@/components/agent-activity";
import { useNow } from "@/components/bits";
import { Icon, type IconName } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Sheet, SheetContent, SheetDescription, SheetHead } from "@/components/ui/sheet";
import { api, ApiError, fetcher } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { relativeTime } from "@/lib/format";
import type {
  Deliverable,
  DeliverableBlock,
  DeliverableKind,
  DeliverableOption,
  DeliverablesResponse,
  StepLine,
  TripState,
} from "@/lib/types";

const POLL_MS = 1500; // the trip build, as trip-plan.tsx polls it
const MAX_CHIPS = 4; // more options than this go behind "More"
const PREVIEW_ITEMS = 4; // lines a card shows before "Show all"
const TRIP_FIRST = "Builds the trip plan first";

const KIND_ICON: Record<DeliverableKind, IconName> = {
  itinerary: "travel",
  invite: "cal",
  grocery_list: "basket",
  recipe_card: "food",
  workout_card: "fit",
  shortlist: "tag",
  places_list: "pin",
  key_points: "tip",
  chat_notes: "ask",
};

function kindIcon(kind: DeliverableKind): IconName {
  return KIND_ICON[kind] ?? "share";
}

/** Only links that go somewhere on the web or on this site are drawn as links. */
export function safeHref(url: string | null | undefined): string | null {
  return url && /^(https?:\/\/|\/(?!\/))/i.test(url) ? url : null;
}

function deliverablesBase(saveId: string): string {
  return `/api/saves/${saveId}/deliverables`;
}

export function deliverablesKey(saveId: string, discussionId?: string | null): string {
  const base = deliverablesBase(saveId);
  return discussionId ? `${base}?discussion_id=${encodeURIComponent(discussionId)}` : base;
}

/** What this reel can make right now, and what was made before. */
export function useDeliverables(saveId: string | null | undefined, discussionId?: string | null) {
  return useSWR<DeliverablesResponse>(saveId ? deliverablesKey(saveId, discussionId) : null, fetcher, {
    revalidateOnFocus: false,
    // A discussion's first answer changes the key; keep the chips on screen meanwhile.
    keepPreviousData: true,
  });
}

// ---- making one ----

class Stopped extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export interface SendMaker {
  /** The kind being made now, or null. */
  busy: DeliverableKind | null;
  /** Non-null while the trip plan is being built first: its step lines so far. */
  steps: StepLine[] | null;
  problem: string | null;
  /** One line for a live region: "Made: Itinerary to send". */
  said: string;
  make: (option: DeliverableOption) => void;
}

export function useSendMaker({
  saveId,
  discussionId,
  servings,
  onMade,
}: {
  saveId: string;
  discussionId?: string | null;
  /** Sent only when the person changed the servings on the Reel page. */
  servings?: number | null;
  onMade: (deliverable: Deliverable) => void;
}): SendMaker {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState<DeliverableKind | null>(null);
  const [steps, setSteps] = useState<StepLine[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Returns once the trip plan is ready. Throws with the reason when it can't be. */
  async function tripFirst(): Promise<void> {
    const path = `/api/saves/${saveId}/trip`;
    let state = await api<TripState>(path);
    if (state.status === "ready") return;
    setSteps(state.steps);
    setSaid("Building the trip plan first.");
    // A build costs money: start one only when none is running or done already.
    if (state.status !== "building") state = await api<TripState>(path, { body: {} });
    let misses = 0;
    for (;;) {
      if (!alive.current) throw new Stopped();
      // The Reel page behind reads the same key, so its trip section follows along.
      void mutate(path, state, { revalidate: false });
      setSteps(state.steps);
      if (state.status === "ready") return;
      if (state.status !== "building") {
        throw new ApiError(0, state.error || "The trip plan didn't get built. Try again.");
      }
      await sleep(POLL_MS);
      try {
        state = await api<TripState>(path);
        misses = 0;
      } catch (e) {
        // One dropped poll is not the end of the build.
        if (++misses >= 4) throw e;
      }
    }
  }

  async function run(option: DeliverableOption) {
    setBusy(option.kind);
    setProblem(null);
    setSaid("");
    try {
      if (option.needs === "trip") await tripFirst();
      const r = await api<{ deliverable: Deliverable }>(deliverablesBase(saveId), {
        body: {
          kind: option.kind,
          discussion_id: discussionId ?? undefined,
          servings: servings ?? undefined,
        },
      });
      if (!alive.current) return;
      setSaid(`Made: ${r.deliverable.label}`);
      onMade(r.deliverable);
      // The options (an itinerary no longer waits on its trip) and the "made before" list.
      const base = deliverablesBase(saveId);
      void mutate((key) => typeof key === "string" && key.startsWith(base));
    } catch (e) {
      if (e instanceof Stopped || !alive.current) return;
      setSaid("");
      setProblem(e instanceof ApiError ? e.message : "That didn't get made. Try again.");
    } finally {
      setBusy(null);
      setSteps(null);
    }
  }

  return {
    busy,
    steps,
    problem,
    said,
    make: (option) => {
      if (busy === null) void run(option);
    },
  };
}

/** The line and steps shown while an itinerary waits for its trip plan. */
export function SendProgress({ steps }: { steps: StepLine[] }) {
  return (
    <div className="send-progress">
      <p className="trip-progress">
        <Icon name="spark" />
        Building the trip plan first
      </p>
      {steps.length > 0 && (
        <div className="send-steps">
          <StepLines steps={steps} live />
        </div>
      )}
      <p className="send-note">This takes a moment. The itinerary follows once the plan is ready.</p>
    </div>
  );
}

// ---- the suggestions under an answer ----

export function SendSuggestions({
  options,
  busy,
  onPick,
}: {
  options: DeliverableOption[];
  busy: boolean;
  onPick: (option: DeliverableOption) => void;
}) {
  const uid = useId();
  const list = useRef<HTMLUListElement>(null);
  const [all, setAll] = useState(false);
  if (options.length === 0) return null;
  const shown = all ? options : options.slice(0, MAX_CHIPS);

  return (
    <div className="send-row" role="group" aria-labelledby={`${uid}-h`}>
      <p className="send-head" id={`${uid}-h`}>
        Make something to send
      </p>
      <ul className="send-chips" ref={list}>
        {shown.map((o) => (
          <li key={o.kind}>
            <button
              type="button"
              className="send-chip"
              aria-disabled={busy}
              aria-describedby={`${uid}-${o.kind}`}
              onClick={() => onPick(o)}
            >
              <Icon name={kindIcon(o.kind)} />
              <span className="send-chip-text">
                {o.label}
                {o.needs === "trip" && <small>{TRIP_FIRST}</small>}
              </span>
            </button>
            <span className="vh" id={`${uid}-${o.kind}`}>
              {o.hint}
            </span>
          </li>
        ))}
        {!all && options.length > MAX_CHIPS && (
          <li>
            <button
              type="button"
              className="send-chip is-more"
              aria-expanded="false"
              onClick={() => {
                setAll(true);
                // This chip is gone once the rest show: hand focus to the first of them.
                window.requestAnimationFrame(() => {
                  list.current?.querySelectorAll<HTMLButtonElement>(".send-chip")[MAX_CHIPS]?.focus();
                });
              }}
            >
              More
              <Icon name="down" />
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

// ---- what a deliverable says: its blocks, as lists ----

function firstItems(blocks: DeliverableBlock[], limit: number): DeliverableBlock[] {
  const out: DeliverableBlock[] = [];
  let left = limit;
  for (const b of blocks) {
    if (left <= 0) break;
    const items = b.items.slice(0, left);
    left -= items.length;
    if (items.length > 0) out.push({ ...b, items });
  }
  return out;
}

export function DeliverableBlocks({
  blocks,
  heading: Heading = "h4",
}: {
  blocks: DeliverableBlock[];
  /** h4 inside a card, h2 on the public page. */
  heading?: "h2" | "h4";
}) {
  if (blocks.length === 0) return null;
  return (
    <div className="dblocks">
      {blocks.map((b, i) => {
        const List = b.numbered ? "ol" : "ul";
        return (
          <div key={i} className="dblock">
            {b.heading && <Heading className="dblock-head">{b.heading}</Heading>}
            <List className={b.numbered ? "ditems is-numbered" : "ditems"}>
              {b.items.map((it, j) => {
                const href = safeHref(it.url);
                return (
                  <li key={j}>
                    <span className="ditem-text">{it.text}</span>
                    {it.sub && <span className="ditem-sub">{it.sub}</span>}
                    {href && (
                      <a className="trip-link" href={href} target="_blank" rel="noopener noreferrer">
                        <span>
                          {it.url_label || it.url}
                          <span className="vh">: {it.text} (opens in a new tab)</span>
                        </span>
                        <Icon name="out" />
                      </a>
                    )}
                  </li>
                );
              })}
            </List>
          </div>
        );
      })}
    </div>
  );
}

// ---- the card: what was made, and the ways to send it ----

export function DeliverableCard({
  deliverable: d,
  reveal = false,
}: {
  deliverable: Deliverable;
  /** Scroll the card into view when it appears (the chat thread). */
  reveal?: boolean;
}) {
  const toast = useToast();
  const uid = useId();
  const card = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  // The card only ever renders in the browser, after a tap, so this can be read directly.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const total = d.blocks.reduce((n, b) => n + b.items.length, 0);
  const long = total > PREVIEW_ITEMS;
  const blocks = open || !long ? d.blocks : firstItems(d.blocks, PREVIEW_ITEMS);

  useEffect(() => {
    // "start" scrolls as far as the thread allows: a short card ends up whole at the
    // bottom, a long one with its top in view.
    if (reveal) card.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [reveal, d.updated_at]);

  async function copy() {
    if (await copyText(d.text)) {
      toast.show("Copied.");
      setNote({ text: "Copied.", failed: false });
    } else {
      setNote({ text: "Copying didn't work here. Try Message or Open instead.", failed: true });
    }
  }

  async function share() {
    try {
      // The text already ends with the link.
      await navigator.share({ title: d.title, text: d.text });
    } catch (e) {
      // Closing the share sheet rejects with AbortError; that isn't a failure.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setNote({ text: "Sharing didn't work here. Try Copy instead.", failed: true });
    }
  }

  return (
    <article className="dcard" ref={card} aria-labelledby={`${uid}-t`}>
      <p className="dcard-label">
        <Icon name={kindIcon(d.kind)} />
        {d.label}
      </p>
      <h3 className="dcard-title" id={`${uid}-t`}>
        {d.title}
      </h3>
      {d.lede.map((line, i) => (
        <p key={i} className="dcard-line">
          {line}
        </p>
      ))}

      <div id={`${uid}-b`}>
        <DeliverableBlocks blocks={blocks} />
      </div>
      {long && (
        <button
          type="button"
          className="text-btn dcard-more"
          aria-expanded={open}
          aria-controls={`${uid}-b`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : "Show all"}
          <Icon name="down" />
        </button>
      )}

      {d.closing.map((line, i) => (
        <p key={i} className="dcard-line is-closing">
          {line}
        </p>
      ))}

      <div className="dsend">
        <a className="btn btn-primary" href={`sms:?&body=${encodeURIComponent(d.text)}`}>
          <Icon name="ask" />
          Message
        </a>
        <div className="dsend-row">
          {canShare && (
            <button type="button" className="btn" onClick={() => void share()}>
              <Icon name="share" />
              Share
            </button>
          )}
          <button type="button" className="btn" onClick={() => void copy()}>
            <Icon name="copy" />
            Copy
          </button>
          <a className="btn" href={d.share_path} target="_blank" rel="noopener noreferrer">
            <Icon name="out" />
            <span>
              Open<span className="vh"> what they will see, in a new tab</span>
            </span>
          </a>
        </div>
      </div>
      {/* Read out by screen readers either way; shown only when something didn't work. */}
      <p className={note?.failed ? "dcard-note" : "vh"} role="status">
        {note?.text ?? ""}
      </p>
    </article>
  );
}

// ---- the Reel page: "Send something" and its sheet ----

function SendList({
  options,
  made,
  maker,
  onView,
}: {
  options: DeliverableOption[];
  made: Deliverable[];
  maker: SendMaker;
  onView: (d: Deliverable) => void;
}) {
  const now = useNow();
  const busy = maker.busy !== null;
  return (
    <>
      {options.length > 0 && (
        <ul className="opts" aria-label="Make something to send">
          {options.map((o) => (
            <li key={o.kind}>
              <button type="button" className="opt send-opt" aria-disabled={busy} onClick={() => maker.make(o)}>
                <span className="opt-ico">
                  <Icon name={kindIcon(o.kind)} />
                </span>
                <span className="opt-name">
                  {o.label}
                  <small>{o.hint}</small>
                  {o.needs === "trip" && <small>{TRIP_FIRST}</small>}
                </span>
                <Icon name="right" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {maker.steps && <SendProgress steps={maker.steps} />}
      {maker.problem && (
        <p role="alert" className="plan-error">
          {maker.problem}
        </p>
      )}

      {made.length > 0 && (
        <>
          <h3 className="sheet-sub">Made before</h3>
          <ul className="opts">
            {made.map((d) => (
              <li key={d.id}>
                <button type="button" className="opt send-opt" onClick={() => onView(d)}>
                  <span className="opt-ico">
                    <Icon name={kindIcon(d.kind)} />
                  </span>
                  <span className="opt-name">
                    {d.label}
                    <small>
                      {[d.title, relativeTime(d.updated_at, now)].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                  <Icon name="right" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// Mounted while the sheet is open. Swapping the list for a card (and back) removes the
// control that was pressed, so focus goes to the first control of what replaced it.
function SendSheetBody({
  options,
  made,
  maker,
  view,
  onView,
}: {
  options: DeliverableOption[];
  made: Deliverable[];
  maker: SendMaker;
  view: Deliverable | null;
  onView: (d: Deliverable | null) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const viewId = view?.id ?? null;
  const shown = useRef(viewId);
  useEffect(() => {
    // Not on opening: the sheet places focus itself then.
    if (shown.current === viewId) return;
    shown.current = viewId;
    body.current?.querySelector<HTMLElement>("button, a[href]")?.focus({ preventScroll: true });
    body.current?.scrollIntoView({ block: "nearest" });
  }, [viewId]);

  return (
    <div ref={body} className="send-body">
      <p className="vh" role="status">
        {maker.said}
      </p>
      {view ? (
        <>
          <button type="button" className="text-btn send-back" onClick={() => onView(null)}>
            <Icon name="back" />
            Everything to send
          </button>
          <DeliverableCard deliverable={view} />
        </>
      ) : (
        <SendList options={options} made={made} maker={maker} onView={onView} />
      )}
    </div>
  );
}

/** One quiet control under the Reel page's buttons, for people who never open the chat. */
export function SendSomething({ saveId, servings }: { saveId: string; servings?: number | null }) {
  const toast = useToast();
  const { data } = useDeliverables(saveId);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Deliverable | null>(null);
  // A trip build can outlast the sheet: when it ends with the sheet closed, say so, and
  // have the card waiting the next time the sheet opens.
  const isOpen = useRef(false);
  const waiting = useRef(false);
  useEffect(() => {
    isOpen.current = open;
  }, [open]);
  const maker = useSendMaker({
    saveId,
    servings,
    onMade: (d) => {
      setView(d);
      if (!isOpen.current) {
        waiting.current = true;
        toast.show(`Made: ${d.label}`);
      }
    },
  });

  const options = data?.options ?? [];
  const made = data?.made ?? [];
  if (options.length === 0 && made.length === 0 && !view) return null;

  return (
    <>
      <div className="send-open">
        <button
          type="button"
          className="text-btn"
          aria-haspopup="dialog"
          onClick={() => {
            // Start at the list, unless a card was made while the sheet was closed.
            if (!waiting.current) setView(null);
            waiting.current = false;
            setOpen(true);
          }}
        >
          <Icon name="share" />
          Send something
        </button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHead>Send something</SheetHead>
          <SheetDescription>Something finished from this reel, ready to message to someone.</SheetDescription>
          <SendSheetBody options={options} made={made} maker={maker} view={view} onView={setView} />
        </SheetContent>
      </Sheet>
    </>
  );
}
