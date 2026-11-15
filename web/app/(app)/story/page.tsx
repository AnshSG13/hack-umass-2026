"use client";

// The guided first open, after "Try the demo": full-screen pages, one idea each. Any
// account can watch it again from Settings ("Watch the tour again").
// 1 The problem. 2 The moment: a saved reel becomes a plan with a time. 3 Three proofs of
// what else it does. Swipe, the arrow keys or the pinned button move between them; Skip
// goes Home. The one problem line is the only fixed copy that says anything about the
// person; everything else on screen comes from the API.

import { Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import useSWR from "swr";
import { StepLines } from "@/components/agent-activity";
import { ActionTile } from "@/components/bundle-card";
import { DeliverableCard, useDeliverables } from "@/components/deliverables";
import { Icon, type IconName } from "@/components/icons";
import { saveReel } from "@/components/paste-form";
import { useDiscussions } from "@/components/reel-chat";
import { Sheet, SheetContent, SheetDescription, SheetHead } from "@/components/ui/sheet";
import { api, ApiError, fetcher } from "@/lib/api";
import { ticketState, ticketTitle, type TicketState } from "@/lib/format";
import { useElapsed, useMe, useRefresh, useSaveDetail } from "@/lib/hooks";
import { DELIVERY, tint, type KindColor } from "@/lib/kinds";
import { markStorySeen, type DemoStory } from "@/lib/story";
import { useTicketActions } from "@/lib/ticket-actions";
import type { Deliverable, ReadyAction, SavesPage, StepLine, Ticket, TripState } from "@/lib/types";

type BeatId = "problem" | "moment" | "more";

/** ?at= keeps the page across a reload and a Back from a proof's screen. */
const AT_PARAM: Record<BeatId, string> = { problem: "start", moment: "save", more: "more" };
const ACCENT: Record<BeatId, KindColor> = { problem: "peach", moment: "lavender", more: "sky" };
const SWIPE_PX = 56;
const PILE = 8;
/** After this long reading, the button lets you go on while it finishes. */
const PATIENCE_S = 15;

// ---- one page ----

function Page({
  beat,
  dir,
  children,
}: {
  beat: BeatId;
  dir: number;
  children: React.ReactNode;
}) {
  const present = useIsPresent();
  const reduce = useReducedMotion();
  // A slide plus a fade; under reduced motion, the fade alone. The page leaving reads the
  // direction from AnimatePresence's `custom`, so going back slides the other way.
  const x = reduce ? 0 : 64;
  const variants = {
    enter: (d: number) => ({ opacity: 0, x: d * x }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: d * -x }),
  };
  return (
    <motion.section
      className="story-page"
      data-beat={beat}
      aria-labelledby={`story-h-${beat}`}
      inert={!present}
      custom={dir}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.section>
  );
}

function Heading({ beat, children }: { beat: BeatId; children: React.ReactNode }) {
  return (
    <h1 className="story-line" id={`story-h-${beat}`} tabIndex={-1}>
      {children}
    </h1>
  );
}

// ---- 1. the problem ----

function ProblemBeat({ dir, thumbs, onNext }: { dir: number; thumbs: string[]; onNext: () => void }) {
  return (
    <Page beat="problem" dir={dir}>
      <div className="story-body">
        {/* A fanned pile of this library's own reels, like prints on a table, behind the line. */}
        <div className="story-pile" aria-hidden="true">
          {Array.from({ length: PILE }, (_, i) => {
            const off = i - (PILE - 1) / 2;
            const style = {
              "--x": off.toFixed(2),
              "--y": Math.abs(off).toFixed(2),
              "--r": `${(off * 4.5).toFixed(1)}deg`,
              zIndex: 10 - Math.round(Math.abs(off) * 2),
            } as CSSProperties;
            const src = thumbs[i];
            return (
              <span key={i} className="story-pile-card" style={style}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src && <img src={src} alt="" draggable={false} />}
              </span>
            );
          })}
        </div>
        <Heading beat="problem">You&apos;ve saved hundreds of reels. You&apos;ve done almost none of them.</Heading>
      </div>
      <div className="story-foot">
        <button type="button" className="btn btn-primary story-cta" onClick={onNext}>
          Show me
        </button>
      </div>
    </Page>
  );
}

// ---- 2. the moment ----

type Recipe = NonNullable<DemoStory["recipe"]>;

function momentHeading(saved: boolean, state: TicketState | null): string {
  if (!saved) return "Say you just saved this reel.";
  if (state === null || state === "printing") return "Watch it read the reel.";
  if (state === "proposed" || state === "accepted" || state === "followup" || state === "done")
    return "It's ready for you.";
  if (state === "proposed_quiet" || state === "declined") return "Not every reel needs a plan.";
  if (state === "failed") return "That one didn't read.";
  return "It's ready for you.";
}

/** The reel, large: before the save, and while it is being read. */
function ReelFace({
  recipe,
  steps,
  failed,
}: {
  recipe: Recipe;
  /** Non-null once saved: the step lines printing over the reel. */
  steps: StepLine[] | null;
  failed: string | null;
}) {
  return (
    <div className="story-reel">
      <div className="story-media">
        <div className="story-frame">
          {recipe.thumb_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={recipe.thumb_url} alt={recipe.title ? `Thumbnail of ${recipe.title}` : "Reel thumbnail"} draggable={false} />
          ) : (
            <span className="story-frame-ph" style={tint("peach")} aria-hidden="true">
              <Icon name="food" />
            </span>
          )}
          {/* The creator's credit, the way a reel shows it: a quiet chip that opens the original. */}
          {recipe.url && (
            <a
              className="story-src"
              href={recipe.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Watch the original reel${recipe.creator ? ` by ${recipe.creator}` : ""} on Instagram`}
            >
              <span className="story-src-pill">
                {recipe.creator ?? "Watch the reel"}
                <Icon name="out" />
              </span>
            </a>
          )}
        </div>
        {steps && (
          <div className="story-steps">
            <StepLines steps={steps} live />
          </div>
        )}
        {failed && (
          <p className="story-steps is-failed" role="alert">
            {failed}
          </p>
        )}
      </div>
      <div className="story-cap">
        <p className="story-cap-title">{recipe.title ?? "A reel from the demo library"}</p>
        {recipe.creator && <p className="story-cap-by">{recipe.creator} on Instagram</p>}
      </div>
    </div>
  );
}

/** What the reel became: its card from Home's Ready for you, rising into the reel's place.
 *  The same card, the same button (Cook now for a recipe); a tap opens the action. */
function ReadyFace({ item }: { item: ReadyAction }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="story-plan story-ready"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 28 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <p className="story-ready-label">Ready for you</p>
      <ActionTile item={item} />
    </motion.div>
  );
}

/** The ticket as one of Home's Ready for you items, once the reel has an action. */
function readyItem(ticket: Ticket | null): ReadyAction | null {
  const action = ticket?.action;
  if (!ticket || !action || action.deliver === "keep" || !ticket.type) return null;
  return {
    ...action,
    save_id: ticket.save_id,
    type: ticket.type,
    title: ticketTitle(ticket),
    thumb_url: ticket.thumb_url,
    meta: "",
  };
}

/** The pinned button once the reel is saved: wait while it reads, try again, or go on. */
function MomentAction({
  ticket,
  apply,
  onNext,
}: {
  ticket: Ticket;
  apply: (t: Ticket) => void;
  onNext: () => void;
}) {
  const actions = useTicketActions(ticket, { apply });
  const state = ticketState(ticket);
  const elapsed = useElapsed(state === "printing", ticket.created_at);
  const busy = actions.busy !== null;

  let button: React.ReactNode;
  if (state === "printing" && elapsed < PATIENCE_S) {
    button = (
      <button type="button" className="btn btn-primary story-cta" disabled>
        Reading the reel
      </button>
    );
  } else if (state === "failed" && (ticket.failure_reason === "processing_error" || ticket.failure_reason === null)) {
    button = (
      <button type="button" className="btn btn-primary story-cta" disabled={busy} onClick={() => void actions.retry()}>
        <Icon name="redo" />
        Try again
      </button>
    );
  } else {
    button = (
      <button type="button" className="btn btn-primary story-cta" onClick={onNext}>
        Next
      </button>
    );
  }

  return (
    <>
      {actions.error && (
        <p role="alert" className="plan-error story-error">
          {actions.error}
        </p>
      )}
      {button}
    </>
  );
}

function MomentBeat({
  dir,
  recipe,
  saveId,
  onSaved,
  onNext,
}: {
  dir: number;
  recipe: Recipe;
  saveId: string | null;
  onSaved: (saveId: string) => void;
  onNext: () => void;
}) {
  const refresh = useRefresh();
  const reduce = useReducedMotion();
  const { data, mutate } = useSaveDetail(saveId);
  const [initial, setInitial] = useState<Ticket | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticket = data?.ticket ?? initial;
  const state = ticket ? ticketState(ticket) : null;

  const apply = useCallback(
    (next: Ticket) => {
      setInitial(next);
      void mutate((cur) => (cur ? { ...cur, ticket: { ...next, steps: next.steps ?? cur.ticket.steps } } : cur), {
        revalidate: false,
      });
    },
    [mutate],
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await saveReel(recipe.url, "sample");
      if (r.status === "error" || !r.save_id) {
        setError(r.message || "That reel didn't save. Try again.");
        return;
      }
      setInitial(r.ticket);
      setJustSaved(true);
      onSaved(r.save_id);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That reel didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const saved = saveId !== null;
  // Saved in an earlier visit and still loading: show the reel quietly until its plan is here.
  const reading = saved && (state === null ? justSaved : state === "printing");
  const steps: StepLine[] | null = reading ? [{ label: "Saved", state: "done", ms: null }, ...(ticket?.steps ?? [])] : null;
  const failed = state === "failed" ? (ticket?.failure_message ?? "Saved. Couldn't read this reel yet.") : null;
  const ready = state !== null && state !== "printing" && state !== "failed" ? readyItem(ticket) : null;
  const said = ready ? `Ready for you: ${DELIVERY[ready.deliver].button}` : "";

  return (
    <Page beat="moment" dir={dir}>
      <div className="story-body">
        <Heading beat="moment">{momentHeading(saved && (ticket !== null || justSaved), state)}</Heading>
        <p className="vh" role="status">
          {said}
        </p>
        <div className="story-area">
          <AnimatePresence initial={false} mode="wait">
            {ready ? (
              <ReadyFace key="ready" item={ready} />
            ) : (
              <motion.div
                key="reel"
                className="story-fill"
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.97 }}
                transition={{ duration: 0.2 }}
              >
                <ReelFace recipe={recipe} steps={steps} failed={failed} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="story-foot">
        {saved && ticket ? (
          <MomentAction ticket={ticket} apply={apply} onNext={onNext} />
        ) : (
          <>
            {error && (
              <p role="alert" className="plan-error story-error">
                {error}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary story-cta"
              disabled={saving || saved}
              onClick={() => void save()}
            >
              {saving || saved ? "Saving" : "Save this reel"}
            </button>
          </>
        )}
      </div>
    </Page>
  );
}

// ---- 3. the payoff ----

function Proof({
  icon,
  title,
  hint,
  href,
  onClick,
  busy,
  color,
}: {
  icon: IconName;
  /** The tint the app gives the same thing, so the tile looks like where it leads. */
  color?: KindColor;
  title: string;
  /** null while it loads: a skeleton holds the line. */
  hint: string | null;
  href?: string | null;
  onClick?: () => void;
  busy?: boolean;
}) {
  const body = (
    <>
      <span className="story-proof-ico" aria-hidden="true" style={color ? tint(color) : undefined}>
        <Icon name={icon} />
      </span>
      <span className="story-proof-text">
        <span className="story-proof-title">{title}</span>
        {hint === null ? (
          <span className="skel story-proof-skel" aria-hidden="true" />
        ) : (
          <span className="story-proof-hint">{hint}</span>
        )}
      </span>
      <Icon name="right" className="story-proof-go" />
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="story-proof" aria-disabled={busy} aria-haspopup="dialog" onClick={onClick}>
        {body}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} className="story-proof">
        {body}
      </Link>
    );
  }
  // Still finding out where it goes.
  return (
    <span className="story-proof is-waiting" aria-hidden="true">
      {body}
    </span>
  );
}

function MoreBeat({
  dir,
  recipe,
  saveId,
  tripSaveId,
  demo,
}: {
  dir: number;
  recipe: Recipe | null;
  saveId: string | null;
  tripSaveId: string | null;
  /** A demo session ends the story in the demo; a real account goes back Home. */
  demo: boolean;
}) {
  const canAsk = Boolean(saveId && recipe?.has_answer);
  const { data: disc } = useDiscussions(canAsk ? saveId : null);
  const discussion = disc?.discussions[0] ?? null;
  const askReady = disc !== undefined;
  const showAsk = canAsk && (!askReady || discussion !== null);

  const { data: trip } = useSWR<TripState>(tripSaveId ? `/api/saves/${tripSaveId}/trip` : null, fetcher, {
    revalidateOnFocus: false,
  });
  const tripHint = trip
    ? trip.trip
      ? [trip.trip.city, trip.trip.date_label].filter(Boolean).join(" · ") || "A day-by-day trip plan"
      : "A day-by-day trip plan"
    : null;

  const { data: sendable } = useDeliverables(saveId);
  const invite = sendable?.options.find((o) => o.kind === "invite") ?? null;
  const [made, setMade] = useState<Deliverable | null>(null);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  async function makeInvite() {
    if (!saveId || making) return;
    if (made) {
      setSheetOpen(true);
      return;
    }
    setMaking(true);
    setProblem(null);
    try {
      const r = await api<{ deliverable: Deliverable }>(`/api/saves/${saveId}/deliverables`, {
        body: { kind: "invite" },
      });
      setMade(r.deliverable);
      setSheetOpen(true);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "The invite didn't get made. Try again.");
    } finally {
      setMaking(false);
    }
  }

  return (
    <Page beat="more" dir={dir}>
      <div className="story-body">
        <Heading beat="more">And it doesn&apos;t stop there.</Heading>
        <ul className="story-proofs">
          {showAsk && saveId && (
            <li>
              <Proof
                icon="sparkles"
                color="lavender"
                title="AI insights"
                hint={askReady ? (discussion?.title ?? "Ask the reel anything") : null}
                href={discussion ? `/s/${saveId}?chat=${encodeURIComponent(discussion.id)}` : null}
              />
            </li>
          )}
          {tripSaveId && (
            <li>
              <Proof
                icon="travel"
                color="sky"
                title="Make it a trip"
                hint={tripHint}
                href={`/s/${tripSaveId}?show=trip`}
              />
            </li>
          )}
          {saveId && (
            <li>
              <Proof
                icon="share"
                color="rose"
                title="Send something"
                hint={making ? "Making the invite" : sendable ? (invite?.hint ?? "An invite, ready to message") : null}
                busy={making}
                onClick={() => void makeInvite()}
              />
            </li>
          )}
          <li>
            <Proof
              icon="spark"
              color="mint"
              title="How your saves connect"
              hint="A 3D map you can turn"
              href="/graph"
            />
          </li>
        </ul>
        {problem && (
          <p role="alert" className="plan-error">
            {problem}
          </p>
        )}
      </div>
      <div className="story-foot">
        <Link href="/home" className="btn btn-primary story-cta" onClick={markStorySeen}>
          {demo ? "Explore the demo" : "Back to Home"}
        </Link>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHead>Send something</SheetHead>
          <SheetDescription>Made from the reel, ready to message to someone.</SheetDescription>
          {made && <DeliverableCard deliverable={made} />}
        </SheetContent>
      </Sheet>
    </Page>
  );
}

// ---- the story ----

// useSearchParams needs a Suspense boundary on a page that is otherwise static.
export default function StoryPage() {
  return (
    <Suspense fallback={<div className="story" />}>
      <Story />
    </Suspense>
  );
}

function Story() {
  const router = useRouter();
  // From the router, not window.location: after a client-side move (Replay the story) the
  // address changes only after the first render.
  const search = useSearchParams();
  const { data: me } = useMe();
  const demo = me?.is_demo === true;
  const story = useSWR<DemoStory>(me ? "/api/demo/story" : null, fetcher, { revalidateOnFocus: false });
  const saves = useSWR<SavesPage>(me ? `/api/saves?limit=${PILE}` : null, fetcher, { revalidateOnFocus: false });
  const [asked] = useState(() => search.get("at"));
  const [savedId, setSavedId] = useState<string | null>(null);
  const [at, setAt] = useState<BeatId | null>(null);
  const [dir, setDir] = useState(1);

  const settled = story.data !== undefined || story.error !== undefined;
  const recipe = story.data?.recipe ?? null;
  const tripSaveId = story.data?.trip_save_id ?? null;
  const saveId = savedId ?? recipe?.save_id ?? null;
  const beats: BeatId[] = recipe ? ["problem", "moment", "more"] : ["problem", "more"];

  // The first page, once it is known whether this reel was saved before (they came back).
  if (at === null && settled) {
    const wanted =
      asked === "start"
        ? "problem"
        : asked === "more"
          ? "more"
          : recipe && (asked === "save" || recipe.save_id)
            ? "moment"
            : "problem";
    setAt(wanted);
  }

  const index = at ? beats.indexOf(at) : 0;

  function go(step: 1 | -1) {
    if (at === null) return;
    const next = beats[beats.indexOf(at) + step];
    if (!next) return;
    setDir(step);
    setAt(next);
  }

  function jump(to: BeatId) {
    if (at === null || to === at) return;
    setDir(beats.indexOf(to) > beats.indexOf(at) ? 1 : -1);
    setAt(to);
  }

  // Keep the page in the address, so Back from a proof lands on it again.
  useEffect(() => {
    if (!at) return;
    try {
      window.history.replaceState(window.history.state, "", `/story?at=${AT_PARAM[at]}`);
    } catch {
      /* the page still works without it */
    }
    if (at === "more") markStorySeen();
  }, [at]);

  // A page change moves focus to its line, so a screen reader reads the new page.
  const firstAt = useRef(true);
  useEffect(() => {
    if (!at) return;
    if (firstAt.current) {
      firstAt.current = false;
      return;
    }
    const id = window.requestAnimationFrame(() => {
      document.getElementById(`story-h-${at}`)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [at]);

  // Arrow keys on a laptop.
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const el = e.target;
      if (el instanceof Element && el.closest("input, textarea, select, [contenteditable], [role='dialog']")) return;
      if (document.querySelector("[data-slot='sheet-content']")) return;
      e.preventDefault();
      goRef.current(e.key === "ArrowRight" ? 1 : -1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Swipe between pages. A swipe that ends on a button doesn't also press it.
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const stage = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      swiped.current = false;
      if (!e.currentTarget.contains(e.target as Node)) return; // a sheet, portalled
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      swiped.current = true;
      window.setTimeout(() => {
        swiped.current = false;
      }, 0);
      go(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onClickCapture: (e: React.MouseEvent<HTMLDivElement>) => {
      if (!swiped.current) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };

  function skip() {
    markStorySeen();
    router.replace("/home");
  }

  const accent = ACCENT[at ?? "problem"];
  const thumbs = (saves.data?.items ?? []).map((t) => t.thumb_url).filter((u): u is string => Boolean(u));

  return (
    <div className="story" style={tint(accent)}>
      <header className="story-top">
        {/* Each segment is also a way back (or ahead) without swiping. */}
        <ol className="story-progress" aria-label="Pages">
          {beats.map((b, i) => (
            <li key={b}>
              <button
                type="button"
                className="story-seg"
                data-on={i <= index ? "" : undefined}
                aria-current={i === index ? "step" : undefined}
                aria-label={`Page ${i + 1} of ${beats.length}`}
                disabled={at === null}
                onClick={() => jump(b)}
              />
            </li>
          ))}
        </ol>
        <button type="button" className="text-btn story-skip" onClick={skip}>
          Skip
        </button>
      </header>
      <p className="vh" role="status">
        {at ? `Page ${index + 1} of ${beats.length}` : ""}
      </p>

      <div className="story-stage" {...stage}>
        <AnimatePresence initial={false} custom={dir}>
          {at === "problem" && (
            <ProblemBeat key="problem" dir={dir} thumbs={thumbs} onNext={() => go(1)} />
          )}
          {at === "moment" && recipe && (
            <MomentBeat
              key="moment"
              dir={dir}
              recipe={recipe}
              saveId={saveId}
              onSaved={setSavedId}
              onNext={() => go(1)}
            />
          )}
          {at === "more" && (
            <MoreBeat key="more" dir={dir} recipe={recipe} saveId={saveId} tripSaveId={tripSaveId} demo={demo} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
