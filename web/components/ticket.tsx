"use client";

// The ticket (DESIGN.md section 5): the saved reel on top, a perforated line, the plan on
// the stub. Add punches it; Done tears the stub off.

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  Bookmark,
  CalendarDays,
  Check,
  ChefHat,
  CircleCheck,
  CircleDashed,
  Dumbbell,
  Lightbulb,
  MapPin,
  MoreHorizontal,
  ShoppingBag,
  SkipForward,
  Ticket as TicketIcon,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { StepLines } from "@/components/agent-activity";
import { ChangeSheet } from "@/components/change-sheet";
import { useTrace } from "@/components/trace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KindChip } from "@/components/bits";
import { followupQuestion, ticketState, ticketTitle, type TicketState } from "@/lib/format";
import { useElapsed, useHealth } from "@/lib/hooks";
import { btnIcon, btnOutline, btnPrimary, btnText, linkInk } from "@/lib/styles";
import { useTicketActions } from "@/lib/ticket-actions";
import type { SaveType, StepLine, Ticket as TicketData } from "@/lib/types";
import { cn } from "@/lib/utils";

export const KIND_ICON: Record<SaveType, LucideIcon> = {
  recipe: ChefHat,
  event: CalendarDays,
  place: MapPin,
  workout: Dumbbell,
  product: ShoppingBag,
  tip: Lightbulb,
  other: Bookmark,
};

// ---------- small parts ----------

export function Thumb({
  ticket,
  className,
}: {
  ticket: Pick<TicketData, "thumb_url" | "title" | "url" | "type">;
  className: string;
}) {
  const Icon = KIND_ICON[ticket.type ?? "other"];
  if (!ticket.thumb_url) {
    return (
      <span
        aria-hidden="true"
        className={cn("flex shrink-0 items-center justify-center rounded-[8px] bg-paper text-muted", className)}
      >
        <Icon className="size-5" />
      </span>
    );
  }
  return (
    // Thumbnails are plain <img> through the /api rewrite (SPEC 13.1).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ticket.thumb_url}
      alt={ticket.title || "Saved reel"}
      className={cn("shrink-0 rounded-[8px] bg-paper object-cover", className)}
      loading="lazy"
    />
  );
}

export function TypeLabel({ type }: { type: SaveType | null }) {
  return <KindChip type={type} />;
}

export function SampleTag() {
  return (
    <span className="inline-flex h-[22px] items-center rounded-full border border-line-strong px-2 text-[13px] leading-none text-muted">
      Sample
    </span>
  );
}

function Notch({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden="true"
      className={cn("absolute top-0 h-5 w-[11px] overflow-hidden", side === "left" ? "-left-px" : "-right-px")}
    >
      <span
        className={cn(
          "absolute top-0 block size-5 rounded-full border border-line bg-paper",
          side === "left" ? "-left-[10px]" : "-right-[10px]",
        )}
      />
    </span>
  );
}

/** 20 px notches cut into both edges, joined by a 1.5 px dashed line (dash 6, gap 6). */
function Perforation() {
  return (
    <div aria-hidden="true" className="relative h-5 border-x border-line bg-ticket">
      <Notch side="left" />
      <Notch side="right" />
      <svg className="absolute top-1/2 left-[14px] h-0.5 w-[calc(100%-28px)] -translate-y-1/2">
        <line
          x1="0"
          y1="1"
          x2="100%"
          y2="1"
          stroke="var(--line-strong)"
          strokeWidth="1.5"
          strokeDasharray="6 6"
        />
      </svg>
    </div>
  );
}

// Torn edge: a zigzag across the top, drawn with clip-path.
const TEETH = 22;
const ZIGZAG = (() => {
  const pts = ["0 6px"];
  for (let i = 0; i < TEETH; i++) {
    pts.push(`${(((i + 0.5) / TEETH) * 100).toFixed(3)}% 0`);
    pts.push(`${(((i + 1) / TEETH) * 100).toFixed(3)}% 6px`);
  }
  pts.push("100% 100%", "0 100%");
  return `polygon(${pts.join(", ")})`;
})();

/** A stub that has been torn off: zigzag top edge, hairline outline. */
export function TornStub({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-b-[16px] bg-line px-px pb-px", className)} style={{ clipPath: ZIGZAG }}>
      <div className="mt-px rounded-b-[15px] bg-ticket px-4 pt-5 pb-4" style={{ clipPath: ZIGZAG }}>
        {children}
      </div>
    </div>
  );
}

/** The plan time, printed large. The highlighter mark fades out over 160 ms once it's added. */
function BigTime({ text, marked, size = 28 }: { text: string; marked: boolean; size?: 28 | 20 }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative -ml-1 inline-block px-1">
      <motion.span
        aria-hidden="true"
        className="absolute inset-0 bg-highlighter"
        initial={false}
        animate={{ opacity: marked ? 1 : 0 }}
        transition={{ duration: reduce ? 0.12 : 0.16, ease: "linear" }}
      />
      <span
        className={cn(
          "wide tabular relative whitespace-nowrap text-ink",
          size === 28 ? "text-[28px] leading-[1.1]" : "text-[20px] leading-[1.2]",
        )}
      >
        {text}
      </span>
    </span>
  );
}

/** The hole Add punches: scales 0 to 1.15 to 1 over 220 ms when it has just been punched. */
export function PunchHole({ fresh }: { fresh: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden="true"
      className="absolute top-3 right-4 block size-5 rounded-full border border-line bg-paper"
      initial={fresh ? (reduce ? { opacity: 0 } : { scale: 0 }) : false}
      animate={reduce ? { opacity: 1 } : { scale: [0, 1.15, 1] }}
      transition={reduce ? { duration: 0.12 } : { duration: 0.22, times: [0, 0.65, 1], ease: "easeOut" }}
    />
  );
}

function Confidence({ value }: { value: "sure" | "best_guess" }) {
  const Icon = value === "sure" ? CircleCheck : CircleDashed;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink">
      <Icon aria-hidden="true" className="size-4" />
      {value === "sure" ? "Sure" : "Best guess"}
    </span>
  );
}

function ReelHalf({
  ticket,
  href,
  footer,
}: {
  ticket: TicketData;
  href?: string;
  footer?: React.ReactNode;
}) {
  const title = ticketTitle(ticket);
  const metaLine = [ticket.creator, `Saved ${ticket.saved_on}`].filter(Boolean).join(" · ");
  return (
    <div className="relative p-4">
      <div className="flex gap-3">
        <Thumb ticket={ticket} className="h-24 w-[72px]" />
        <div className="min-w-0 flex-1">
          {(ticket.type || ticket.is_sample) && (
            <div className="mb-1 flex min-h-[22px] items-center justify-between gap-2">
              <TypeLabel type={ticket.type} />
              {ticket.is_sample && <SampleTag />}
            </div>
          )}
          <h3 className="line-clamp-2 text-[17px] leading-[1.3] font-semibold break-words text-ink">
            {href ? (
              <Link href={href} className="rounded-[4px] after:absolute after:inset-0 after:content-['']">
                {title}
              </Link>
            ) : (
              title
            )}
          </h3>
          <p className="mt-1 text-[13px] text-muted">{metaLine}</p>
        </div>
      </div>
      {footer}
    </div>
  );
}

function printingNotice(queued: boolean, elapsed: number, offline: boolean): string | null {
  if (offline) return "Live reading is offline right now. The samples still work.";
  if (queued && elapsed > 30) return "This one will finish in the background. It'll be in Waiting on you.";
  if (elapsed > 12) return "Still reading. Long reels take a moment.";
  return null;
}

// ---------- the full ticket ----------

export interface TicketProps {
  ticket: TicketData;
  /** Link the title to the save detail. */
  href?: string;
  /** /p/[id]: act through the share token, and always offer Done and Skipped it. */
  publicToken?: string;
  /** Landing hero: the proposed ticket as a picture of the product, with no controls. */
  preview?: boolean;
  /** Show the "How it was planned" link (inside the app shell only). */
  traceLink?: boolean;
  /** On Done, collapse the ticket after the tear and call onGone (Plans). */
  collapseOnDone?: boolean;
  onGone?: (t: TicketData) => void;
  /** Called with the updated ticket after any change made here. */
  onChange?: (t: TicketData) => void;
}

export function Ticket({
  ticket,
  href,
  publicToken,
  preview = false,
  traceLink = false,
  collapseOnDone = false,
  onGone,
  onChange,
}: TicketProps) {
  const reduce = useReducedMotion();
  const trace = useTrace();

  // After a change we show the server's reply until the parent's data catches up.
  const [override, setOverride] = useState<{ base: TicketData; t: TicketData } | null>(null);
  const t = override && override.base === ticket ? override.t : ticket;
  const state = ticketState(t);
  const plan = t.plan;

  const [punched, setPunched] = useState(false);
  const [tear, setTear] = useState<{ phase: "tearing" | "collapsing" | "gone"; next: TicketData } | null>(null);
  const [fresh, setFresh] = useState<"done" | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);

  const apply = (next: TicketData) => {
    setOverride({ base: ticket, t: next });
    onChange?.(next);
  };
  const actions = useTicketActions(t, { publicToken, apply });
  const busy = actions.busy !== null;

  // "Plan ready" for screen readers once a printing ticket gets its plan (DESIGN.md section 6).
  const [sawPrinting, setSawPrinting] = useState(state === "printing");
  if (state === "printing" && !sawPrinting) setSawPrinting(true);
  const announce =
    sawPrinting && state === "proposed" && plan
      ? `Plan ready: ${plan.options[0]?.label ?? ""}`
      : sawPrinting && state === "proposed_quiet"
        ? "Plan ready: No plan needed"
        : "";

  const printing = state === "printing";
  const elapsed = useElapsed(printing && !preview, t.created_at);
  const { data: health } = useHealth(printing && !t.is_sample && !preview);
  const offline =
    printing && !t.is_sample && health !== undefined &&
    (health.worker_last_seen_s === null || health.worker_last_seen_s > 60);

  async function add(choice: string, startLocal?: string): Promise<boolean> {
    const was = state;
    const status = await actions.confirm(choice, startLocal);
    if (status === "accepted" && was !== "accepted") setPunched(true);
    return status !== null;
  }

  async function markDone() {
    const next = await actions.setStatus("done");
    if (!next) return;
    setTear({ phase: "tearing", next });
  }

  async function markSkipped() {
    const next = await actions.setStatus("skipped");
    if (!next) return;
    apply(next);
    actions.refresh();
  }

  function afterTear() {
    if (!tear || tear.phase !== "tearing") return;
    if (collapseOnDone) {
      setTear({ phase: "collapsing", next: tear.next });
      return;
    }
    setFresh("done");
    apply(tear.next);
    setTear(null);
    actions.refresh();
  }

  function afterCollapse() {
    if (!tear || tear.phase !== "collapsing") return;
    const next = tear.next;
    setTear({ phase: "gone", next });
    onGone?.(next);
    actions.refresh();
  }

  if (tear?.phase === "gone") return null;

  const tearing = tear !== null;
  const split = state === "done" || tearing;
  const hasStub = state !== "declined";
  const showTrace = traceLink && trace.available && !preview && !publicToken;
  const traceButtonAt = (side: "left" | "right") =>
    showTrace ? (
      <button
        type="button"
        className={cn(
          "inline-flex min-h-11 items-center rounded-[12px] px-1 text-[14px] text-ink underline underline-offset-4",
          side === "left" ? "-ml-1" : "-mr-1",
        )}
        onClick={() => trace.show(t.save_id)}
      >
        How it was planned
      </button>
    ) : null;
  const traceButton = traceButtonAt("right");

  const errorLine = actions.error ? (
    <p role="alert" className="mt-2 text-[14px] text-danger-ink">
      {actions.error}
    </p>
  ) : null;

  // ----- stub contents by state -----
  let stub: React.ReactNode = null;

  if (state === "printing") {
    const lines: StepLine[] = [{ label: "Saved", state: "done", ms: null }, ...(t.steps ?? [])];
    const notice = printingNotice(t.processing === "queued", elapsed, offline);
    stub = (
      <div>
        <StepLines steps={lines} live />
        {notice && <p className="mt-3 text-[14px] text-muted">{notice}</p>}
      </div>
    );
  } else if (state === "proposed" && plan) {
    const first = plan.options[0];
    stub = (
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <BigTime text={first.big_time} marked />
          {first.secondary && <span className="text-[14px] text-muted">{first.secondary}</span>}
        </div>
        {plan.why && <p className="mt-2 text-[14px] text-muted">{plan.why}</p>}
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Confidence value={plan.confidence} />
          {traceButton}
        </div>
        {preview ? null : (
          <>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void add(first.id)}>
              {first.web_label}
            </button>
            <div className="mt-1 grid grid-cols-3 gap-1">
              <button type="button" className={btnText} disabled={busy} onClick={() => setChangeOpen(true)}>
                Change
              </button>
              {plan.extras.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className={btnText}
                  disabled={busy}
                  onClick={() => void actions.confirm(x.id)}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </>
        )}
        {errorLine}
      </div>
    );
  } else if (state === "proposed_quiet" && plan) {
    const first = plan.options[0];
    stub = (
      <div>
        <p className="wide text-[22px] leading-[1.2] text-ink">No plan needed</p>
        {plan.why && <p className="mt-2 text-[14px] text-muted">{plan.why}</p>}
        {!preview && (
          <div className="mt-3">
            {first && (
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void add(first.id)}>
                {first.web_label}
              </button>
            )}
            <div className={cn("flex flex-wrap items-center justify-between gap-x-3", first && "mt-1")}>
              <div className="flex flex-wrap gap-1">
                {plan.extras.map((x) =>
                  first ? (
                    <button
                      key={x.id}
                      type="button"
                      className={cn(btnText, "-ml-3")}
                      disabled={busy}
                      onClick={() => void actions.confirm(x.id)}
                    >
                      {x.label}
                    </button>
                  ) : (
                    // With nothing to schedule, saving is the one next step.
                    <button
                      key={x.id}
                      type="button"
                      className={btnOutline}
                      disabled={busy}
                      onClick={() => void actions.confirm(x.id)}
                    >
                      {x.label}
                    </button>
                  ),
                )}
              </div>
              {traceButton}
            </div>
          </div>
        )}
        {errorLine}
      </div>
    );
  } else if ((state === "accepted" || state === "followup") && plan) {
    const chosen = plan.chosen;
    const big = plan.big_time ?? chosen?.big_time ?? "";
    const askFollowup = state === "followup" || Boolean(publicToken);
    stub = (
      <div>
        <PunchHole fresh={punched} />
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pr-8">
          {big && <BigTime text={big} marked={false} />}
          {chosen?.secondary && <span className="text-[14px] text-muted">{chosen.secondary}</span>}
        </div>
        {state === "accepted" && (
          <>
            <div className="mt-1 flex min-h-11 items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[15px] font-medium text-done-ink">
                <Check aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.5} />
                Added to {plan.long_day ?? "your week"}
              </p>
              {!publicToken && (
                <DropdownMenu>
                  <DropdownMenuTrigger className={cn(btnIcon, "-mr-2")} aria-label="More" disabled={busy}>
                    <MoreHorizontal aria-hidden="true" className="size-5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setChangeOpen(true)}>Change time</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void actions.undo()}>Undo</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {plan.confirmed_via === "shortcut" && (
              <p className="text-[14px] text-muted">On your phone&apos;s calendar</p>
            )}
            {plan.reminders_preview.map((r) => (
              <p key={r} className="text-[14px] text-muted">
                Reminder: {r}
              </p>
            ))}
            {plan.confirmed_via === "web" && (plan.gcal_url || plan.ics_url) && (
              <div className="mt-1 flex flex-wrap gap-x-5">
                {plan.gcal_url && (
                  <a
                    className={cn(linkInk, "inline-flex min-h-11 items-center text-[14px]")}
                    href={plan.gcal_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Add to Google Calendar
                  </a>
                )}
                {plan.ics_url && (
                  // A new tab on purpose: a Home Screen web app has no back button, so the
                  // calendar file must not replace the app's own page.
                  <a
                    className={cn(linkInk, "inline-flex min-h-11 items-center text-[14px]")}
                    href={plan.ics_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Add to Apple Calendar
                  </a>
                )}
              </div>
            )}
            {showTrace && <div className="flex min-h-11 items-center">{traceButtonAt("left")}</div>}
          </>
        )}
        {askFollowup && (
          <div className="mt-3">
            {state === "followup" && (
              <p className="mb-3 text-[17px] leading-[1.3] font-semibold text-ink">{followupQuestion(plan.kind)}</p>
            )}
            <button type="button" className={btnPrimary} disabled={busy || tearing} onClick={() => void markDone()}>
              Done
            </button>
            <button
              type="button"
              className={cn(btnText, "mt-1 w-full")}
              disabled={busy || tearing}
              onClick={() => void markSkipped()}
            >
              Skipped it
            </button>
          </div>
        )}
        {errorLine}
      </div>
    );
  } else if (state === "skipped") {
    stub = (
      <div>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[15px] text-muted">
            <SkipForward aria-hidden="true" className="size-4 shrink-0" />
            Skipped
          </p>
          {!publicToken && !preview && (
            <button type="button" className={cn(btnText, "-mr-3")} disabled={busy} onClick={() => void actions.replan()}>
              Plan again
            </button>
          )}
        </div>
        {errorLine}
      </div>
    );
  } else if (state === "failed") {
    const canRetry = t.failure_reason === "processing_error" || t.failure_reason === null;
    stub = (
      <div>
        <p className="flex items-start gap-2 text-[15px] text-ink">
          <TriangleAlert aria-hidden="true" className="mt-[3px] size-4 shrink-0" />
          <span>{canRetry ? "Saved. Couldn't read this reel yet." : t.failure_message}</span>
        </p>
        {canRetry && !publicToken && !preview && (
          <button type="button" className={cn(btnOutline, "mt-3")} disabled={busy} onClick={() => void actions.retry()}>
            Try again
          </button>
        )}
        {errorLine}
      </div>
    );
  }

  const doneStub =
    state === "done" && plan ? (
      <motion.div
        className="mt-1.5"
        initial={fresh === "done" ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0.12 : 0.16, ease: "linear" }}
      >
        <TornStub>
          <p className="flex items-center gap-1.5 text-[15px] font-medium text-done-ink">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-done" />
            Done{plan.done_day ? ` ${plan.done_day}` : ""}
          </p>
        </TornStub>
      </motion.div>
    ) : null;

  return (
    <motion.article
      aria-label={ticketTitle(t)}
      className={tear?.phase === "collapsing" ? "overflow-hidden" : undefined}
      initial={false}
      animate={tear?.phase === "collapsing" ? { height: 0, opacity: 0 } : { height: "auto", opacity: 1 }}
      transition={{ duration: reduce ? 0.12 : 0.2, ease: "easeInOut" }}
      onAnimationComplete={afterCollapse}
    >
      <div
        className={cn(
          "rounded-t-[16px] border border-line bg-ticket",
          split ? "rounded-b-[6px]" : hasStub ? "border-b-0" : "rounded-b-[16px]",
        )}
      >
        <ReelHalf
          ticket={t}
          href={href}
          footer={
            state === "declined" ? (
              <p className="mt-3 flex items-center gap-1.5 text-[14px] text-muted">
                <Bookmark aria-hidden="true" className="size-4 shrink-0" />
                In your library
              </p>
            ) : null
          }
        />
      </div>

      {state === "done"
        ? doneStub
        : hasStub && (
            <motion.div
              initial={false}
              animate={
                tear?.phase === "tearing" || tear?.phase === "collapsing"
                  ? reduce
                    ? { opacity: 0 }
                    : { rotate: -4, y: 12, opacity: 0 }
                  : { rotate: 0, y: 0, opacity: 1 }
              }
              transition={reduce ? { duration: 0.12 } : { duration: 0.32, ease: "easeIn" }}
              onAnimationComplete={afterTear}
              style={{ transformOrigin: "top left" }}
            >
              {tearing ? <div className="h-1.5" aria-hidden="true" /> : <Perforation />}
              <div
                className={cn(
                  "relative rounded-b-[16px] border border-line bg-ticket px-4 pb-4",
                  tearing ? "rounded-t-[6px] pt-4" : "border-t-0 pt-2",
                )}
              >
                {stub}
              </div>
            </motion.div>
          )}

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {!preview && !publicToken && plan && (state === "proposed" || state === "accepted") && (
        <ChangeSheet
          ticket={t}
          open={changeOpen}
          onOpenChange={setChangeOpen}
          onPick={add}
          error={actions.error}
          busy={busy}
        />
      )}
    </motion.article>
  );
}

// ---------- compact variant (lists on Plans, plans in Ask) ----------

function statusLine(t: TicketData, state: TicketState): { icon: LucideIcon; text: string; tone: string } {
  const plan = t.plan;
  switch (state) {
    case "accepted":
      return { icon: Check, text: `Added to ${plan?.long_day ?? "your week"}`, tone: "text-done-ink" };
    case "followup":
      return { icon: CircleDashed, text: followupQuestion(plan?.kind), tone: "text-ink" };
    case "proposed":
    case "proposed_quiet":
      return { icon: TicketIcon, text: "Waiting on you", tone: "text-ink" };
    case "done":
      return { icon: CircleCheck, text: `Done${plan?.done_day ? ` ${plan.done_day}` : ""}`, tone: "text-done-ink" };
    case "skipped":
      return { icon: SkipForward, text: "Skipped", tone: "text-muted" };
    case "failed":
      return { icon: TriangleAlert, text: "Couldn't read this reel yet", tone: "text-ink" };
    case "printing":
      return { icon: CircleDashed, text: "Reading", tone: "text-muted" };
    default:
      return { icon: Bookmark, text: "In your library", tone: "text-muted" };
  }
}

export function CompactTicket({
  ticket,
  withAction = false,
}: {
  ticket: TicketData;
  /** Show the plan's primary button under the row (plans proposed by Ask). */
  withAction?: boolean;
}) {
  const [override, setOverride] = useState<{ base: TicketData; t: TicketData } | null>(null);
  const t = override && override.base === ticket ? override.t : ticket;
  const state = ticketState(t);
  const plan = t.plan;
  const actions = useTicketActions(t, { apply: (next) => setOverride({ base: ticket, t: next }) });
  const status = statusLine(t, state);
  const StatusIcon = status.icon;
  const big =
    state === "proposed" ? plan?.options[0]?.big_time : state === "accepted" || state === "followup" ? plan?.big_time : null;
  const first = plan?.options[0];

  return (
    <article className="rounded-[16px] border border-line bg-ticket">
      <Link href={`/s/${t.save_id}`} className="flex gap-3 rounded-[16px] p-3">
        <Thumb ticket={t} className="h-16 w-12" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-[15px] leading-[1.35] font-semibold break-words text-ink">
            {ticketTitle(t)}
          </span>
          {big && (
            <span className="mt-0.5 block">
              <BigTime text={big} marked={state === "proposed"} size={20} />
            </span>
          )}
          <span className={cn("mt-0.5 flex items-center gap-1.5 text-[13px]", status.tone)}>
            <StatusIcon aria-hidden="true" className="size-[14px] shrink-0" />
            {status.text}
          </span>
        </span>
      </Link>
      {withAction && state === "proposed" && first && (
        <div className="px-3 pb-3">
          <button
            type="button"
            className={btnPrimary}
            disabled={actions.busy !== null}
            onClick={() => void actions.confirm(first.id)}
          >
            {first.web_label}
          </button>
          {actions.error && (
            <p role="alert" className="mt-2 text-[14px] text-danger-ink">
              {actions.error}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

// ---------- mini torn stub ("Done this week") ----------

export function MiniStub({ ticket, fresh = false }: { ticket: TicketData; fresh?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="w-[148px] shrink-0"
      initial={fresh ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0.12 : 0.16, ease: "linear" }}
    >
      <Link href={`/s/${ticket.save_id}`} className="block rounded-b-[16px]">
        <TornStub className="[&>div]:px-3 [&>div]:pt-4 [&>div]:pb-3">
          <span className="line-clamp-2 min-h-[38px] text-[14px] leading-[1.35] font-medium break-words text-ink">
            {ticketTitle(ticket)}
          </span>
          <span className="mt-1.5 flex items-center gap-1.5 text-[13px] text-done-ink">
            <CircleCheck aria-hidden="true" className="size-[14px] shrink-0 text-done" />
            {ticket.plan?.done_day ?? "Done"}
          </span>
        </TornStub>
      </Link>
    </motion.div>
  );
}

// ---------- loading placeholder: ticket-shaped, static ----------

export function TicketPlaceholder() {
  return (
    <div aria-hidden="true">
      <div className="rounded-t-[16px] border border-b-0 border-line bg-ticket p-4">
        <div className="flex gap-3">
          <span className="block h-24 w-[72px] shrink-0 rounded-[8px] bg-paper" />
          <span className="flex-1">
            <span className="block h-3 w-16 rounded-full bg-paper" />
            <span className="mt-3 block h-4 w-full rounded-full bg-paper" />
            <span className="mt-2 block h-4 w-2/3 rounded-full bg-paper" />
          </span>
        </div>
      </div>
      <Perforation />
      <div className="rounded-b-[16px] border border-t-0 border-line bg-ticket px-4 pt-2 pb-4">
        <span className="block h-7 w-40 rounded-[4px] bg-paper" />
        <span className="mt-3 block h-3 w-3/4 rounded-full bg-paper" />
      </div>
    </div>
  );
}
