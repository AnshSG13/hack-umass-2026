"use client";

// The plan for one save, as a card in the mockup's language (the mockup has no plan card;
// this follows its .note and .tip). Same states and the same API calls as the ticket it
// replaces on the app screens: propose, confirm, change time, calendar links, done,
// skipped, undo, plan again, try again.

import { useState } from "react";
import Link from "next/link";
import { StepLines } from "@/components/agent-activity";
import { KindChip, ReelThumb } from "@/components/bits";
import { ChangeSheet } from "@/components/change-sheet";
import { Icon } from "@/components/icons";
import { followupQuestion, ticketState, ticketTitle, planLabel } from "@/lib/format";
import { useElapsed, useHealth } from "@/lib/hooks";
import { actionHref, DELIVERY, kindTint, tint } from "@/lib/kinds";
import { useTicketActions } from "@/lib/ticket-actions";
import type { Deliver, StepLine, Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";

function printingNotice(queued: boolean, elapsed: number, offline: boolean): string | null {
  if (offline) return "Live reading is offline right now. The samples still work.";
  if (queued && elapsed > 30) return "This one will finish in the background. It'll be in Waiting on you.";
  if (elapsed > 12) return "Still reading. Long reels take a moment.";
  return null;
}

/** The reel a plan belongs to: shown where the card stands alone (Plans, Ask). */
function ReelLine({ ticket }: { ticket: Ticket }) {
  return (
    <Link href={`/s/${ticket.save_id}`} className="plan-reel">
      <ReelThumb thumbUrl={ticket.thumb_url} type={ticket.type} small />
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
        <KindChip type={ticket.type} />
        <span className="plan-reel-title">{ticketTitle(ticket)}</span>
      </span>
    </Link>
  );
}

/** The web's words for an extra whose server label (shared with the Shortcut menu) says
 *  less than it does. "Just vibes" declines the plan and keeps the reel in the library. */
const EXTRA_LABEL: Record<string, string> = { "Just vibes": "Save without a plan" };

export function PlanCard({
  ticket,
  withReel = false,
  quietButton = false,
  onChange,
  onDo,
  bare = false,
}: {
  ticket: Ticket;
  /** Show the reel's thumbnail and title on top, linking to its page. */
  withReel?: boolean;
  /** Draw the main button in the plain style, for a card that isn't first in a list. */
  quietButton?: boolean;
  /** Called with the updated ticket after any change made here. */
  onChange?: (t: Ticket) => void;
  /** On the reel's own page: do the action here (open cook mode, run price research).
   *  Elsewhere the action's button opens the reel's page, which does it on arrival. */
  onDo?: (deliver: Deliver) => void;
  /** In action mode, where the page already shows the call to action: just the controls. */
  bare?: boolean;
}) {
  // After a change we show the server's reply until the parent's data catches up.
  const [override, setOverride] = useState<{ base: Ticket; t: Ticket } | null>(null);
  const t = override && override.base === ticket ? override.t : ticket;
  const state = ticketState(t);
  const plan = t.plan;
  const [changeOpen, setChangeOpen] = useState(false);

  const apply = (next: Ticket) => {
    setOverride({ base: ticket, t: next });
    onChange?.(next);
  };
  const actions = useTicketActions(t, { apply });
  const busy = actions.busy !== null;

  const printing = state === "printing";
  const elapsed = useElapsed(printing, t.created_at);
  const { data: health } = useHealth(printing && !t.is_sample);
  const offline =
    printing && !t.is_sample && health !== undefined &&
    (health.worker_last_seen_s === null || health.worker_last_seen_s > 60);

  async function pick(choice: string, startLocal?: string): Promise<boolean> {
    return (await actions.confirm(choice, startLocal)) !== null;
  }

  async function mark(status: "done" | "skipped" | "accepted") {
    const next = await actions.setStatus(status);
    if (!next) return;
    apply(next);
    actions.refresh();
  }

  const reel = withReel ? <ReelLine ticket={t} /> : null;
  const mainBtn = quietButton ? "btn" : "btn btn-primary";
  const errorLine = actions.error ? (
    <p role="alert" className="plan-error">
      {actions.error}
    </p>
  ) : null;
  const changeSheet =
    plan && (state === "proposed" || state === "accepted" || state === "followup") ? (
      <ChangeSheet
        ticket={t}
        open={changeOpen}
        onOpenChange={setChangeOpen}
        onPick={pick}
        error={actions.error}
        busy={busy}
      />
    ) : null;

  if (state === "printing") {
    const lines: StepLine[] = [{ label: "Saved", state: "done", ms: null }, ...(t.steps ?? [])];
    const notice = printingNotice(t.processing === "queued", elapsed, offline);
    return (
      <section className="plan" style={tint("lavender")} aria-label="Plan">
        {reel}
        <p className="plan-label">
          <Icon name="spark" />
          Working out a plan
        </p>
        <div className="plan-steps">
          <StepLines steps={lines} live />
        </div>
        {notice && <p className="plan-why">{notice}</p>}
      </section>
    );
  }

  // The action: what the person wants from the reel, delivered. A time shows only when the
  // action is tied to one (an event's date, or a cook the model says needs a set time).
  const action = t.action;
  if (state === "proposed" && plan && action && action.deliver !== "keep") {
    const d = DELIVERY[action.deliver];
    const first = plan.options[0];
    const dated = action.deliver === "calendar" && first?.action === "event";
    const canPickTime = action.schedule && !dated && plan.options.length > 0;
    return (
      <section className="plan action-card" style={kindTint(t.type) ?? tint("lavender")} aria-label="Action">
        {reel}
        {!bare && (
          <>
            <p className="plan-label">
              <Icon name={d.icon} />
              {d.label}
            </p>
            <p className="action-cta">{action.cta}</p>
            {action.pitch && <p className="plan-why">{action.pitch}</p>}
          </>
        )}
        {dated && (
          <p className="action-when">
            <Icon name="cal" />
            {first.big_time}
            {first.secondary && <small>{first.secondary}</small>}
          </p>
        )}
        <div className="plan-btns">
          {dated ? (
            <button type="button" className={mainBtn} disabled={busy} onClick={() => void pick(first.id)}>
              {planLabel(first.web_label)}
            </button>
          ) : onDo ? (
            <button type="button" className={mainBtn} onClick={() => onDo(action.deliver)}>
              {d.button}
            </button>
          ) : (
            <Link href={actionHref(t.save_id, action.deliver, true)} className={mainBtn}>
              {d.button}
            </Link>
          )}
        </div>
        <div className="plan-row">
          <button type="button" className="text-btn" disabled={busy} onClick={() => void mark("done")}>
            <Icon name="check" />
            Mark as done
          </button>
          {canPickTime && (
            <button type="button" className="text-btn" disabled={busy} onClick={() => setChangeOpen(true)}>
              Pick a time
            </button>
          )}
          {plan.extras.map((x) => (
            <button
              key={x.id}
              type="button"
              className="text-btn"
              disabled={busy}
              onClick={() => void actions.confirm(x.label)}
            >
              {EXTRA_LABEL[x.label] ?? x.label}
            </button>
          ))}
        </div>
        {errorLine}
        {changeSheet}
      </section>
    );
  }

  if (state === "proposed" && plan) {
    const [first, second] = plan.options;
    return (
      <section className="plan" style={tint("lavender")} aria-label="Plan">
        {reel}
        <p className="plan-label">
          <Icon name="spark" />
          {plan.confidence === "best_guess" ? "Suggested plan, a best guess" : "Suggested plan"}
        </p>
        <p className="plan-time">
          {first.big_time}
          {first.secondary && <small>{first.secondary}</small>}
        </p>
        {plan.why && <p className="plan-why">{plan.why}</p>}
        <div className="plan-btns">
          <button type="button" className={mainBtn} disabled={busy} onClick={() => void pick(first.id)}>
            {planLabel(first.web_label)}
          </button>
          {second && (
            <button type="button" className="btn" disabled={busy} onClick={() => void pick(second.id)}>
              {planLabel(second.web_label)} · {second.big_time}
            </button>
          )}
        </div>
        <div className="plan-row">
          <button type="button" className="text-btn" disabled={busy} onClick={() => setChangeOpen(true)}>
            Change time
          </button>
          {plan.extras.map((x) => (
            <button
              key={x.id}
              type="button"
              className="text-btn"
              disabled={busy}
              onClick={() => void actions.confirm(x.label)}
            >
              {EXTRA_LABEL[x.label] ?? x.label}
            </button>
          ))}
        </div>
        {errorLine}
        {changeSheet}
      </section>
    );
  }

  if (state === "proposed_quiet" && plan && action?.deliver === "keep") {
    return (
      <section className="plan action-card" style={tint("butter")} aria-label="Just vibes">
        {reel}
        <p className="plan-label">
          <Icon name="spark" />
          Just vibes
        </p>
        <p className="action-cta">{action.cta}</p>
        {action.pitch && <p className="plan-why">{action.pitch}</p>}
        {errorLine}
      </section>
    );
  }

  if (state === "proposed_quiet" && plan) {
    const first = plan.options[0];
    return (
      <section className="plan" aria-label="Plan">
        {reel}
        <p className="plan-label">
          <Icon name="bookmark" />
          No plan needed
        </p>
        {plan.why && <p className="plan-why">{plan.why}</p>}
        <div className="plan-btns">
          {first && (
            <button type="button" className={mainBtn} disabled={busy} onClick={() => void pick(first.id)}>
              {planLabel(first.web_label)}
            </button>
          )}
          {plan.extras.map((x) => (
            <button
              key={x.id}
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void actions.confirm(x.label)}
            >
              {x.label}
            </button>
          ))}
        </div>
        {errorLine}
      </section>
    );
  }

  if ((state === "accepted" || state === "followup") && plan) {
    const chosen = plan.chosen;
    const big = plan.big_time ?? chosen?.big_time ?? "";
    return (
      <section className="plan" style={tint("mint")} aria-label="Plan">
        {reel}
        <p className="plan-label">
          <Icon name="check" />
          Planned
        </p>
        {big && (
          <p className="plan-time">
            {big}
            {chosen?.secondary && <small>{chosen.secondary}</small>}
          </p>
        )}
        <p className="plan-line">Planned for {plan.long_day ?? "this week"}</p>
        {plan.confirmed_via === "shortcut" && <p className="plan-meta">On your phone&apos;s calendar</p>}
        {plan.reminders_preview.map((r) => (
          <p key={r} className="plan-meta">
            Reminder: {r}
          </p>
        ))}
        {plan.confirmed_via === "web" && (plan.ics_url || plan.gcal_url) && (
          <div className="plan-links">
            {plan.ics_url && (
              // A new tab on purpose: a Home Screen web app has no back button, so the
              // calendar file must not replace the app's own page.
              <a className="btn" href={plan.ics_url} target="_blank" rel="noopener noreferrer">
                Add to Apple Calendar
              </a>
            )}
            {plan.gcal_url && (
              <a className="btn" href={plan.gcal_url} target="_blank" rel="noopener noreferrer">
                Add to Google Calendar
              </a>
            )}
          </div>
        )}
        {state === "followup" && (
          <p className="plan-line" style={{ marginTop: 14 }}>
            {followupQuestion(plan.kind)}
          </p>
        )}
        <div className="plan-links">
          <button
            type="button"
            className={cn("btn", state === "followup" && "btn-primary")}
            style={{ gridColumn: "auto" }}
            disabled={busy}
            onClick={() => void mark("done")}
          >
            <Icon name="check" />
            Done
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void mark("skipped")}>
            Skipped it
          </button>
        </div>
        <div className="plan-row">
          <button type="button" className="text-btn" disabled={busy} onClick={() => setChangeOpen(true)}>
            Change time
          </button>
          <button type="button" className="text-btn" disabled={busy} onClick={() => void actions.undo()}>
            Undo
          </button>
        </div>
        {errorLine}
        {changeSheet}
      </section>
    );
  }

  if (state === "failed") {
    const canRetry = t.failure_reason === "processing_error" || t.failure_reason === null;
    return (
      <section className="plan" style={tint("rose")} aria-label="Plan">
        {reel}
        <p className="plan-label">
          <Icon name="alert" />
          Not read yet
        </p>
        <p className="plan-why" style={{ color: "var(--ink)" }}>
          {canRetry ? "Saved. Couldn't read this reel yet." : t.failure_message}
        </p>
        {canRetry && (
          <div className="plan-btns">
            <button type="button" className="btn" disabled={busy} onClick={() => void actions.retry()}>
              <Icon name="redo" />
              Try again
            </button>
          </div>
        )}
        {errorLine}
      </section>
    );
  }

  // Done, skipped, declined or never planned: one quiet line.
  const quiet =
    state === "done"
      ? { icon: "check" as const, text: `Done${plan?.done_on ? ` ${plan.done_on}` : plan?.done_day ? ` ${plan.done_day}` : ""}`, again: false }
      : state === "skipped"
        ? { icon: "skip" as const, text: "Skipped", again: true }
        : { icon: "bookmark" as const, text: "Saved without a plan", again: Boolean(plan) };

  return (
    <section className="plan is-quiet" style={state === "done" ? tint("mint") : undefined} aria-label="Plan">
      {reel && <div style={{ paddingTop: 10 }}>{reel}</div>}
      <div className="plan-quiet">
        <span style={state === "done" ? { color: "var(--mint-ink)" } : undefined}>
          <Icon name={quiet.icon} />
          {quiet.text}
        </span>
        {quiet.again && (
          <button type="button" className="text-btn" disabled={busy} onClick={() => void actions.replan()}>
            Plan again
          </button>
        )}
        {state === "done" && plan && (
          <button type="button" className="text-btn" disabled={busy} onClick={() => void mark("accepted")}>
            Undo
          </button>
        )}
      </div>
      {errorLine}
    </section>
  );
}
