"use client";

// Task completion: marking an action done (action mode, finishing cook mode or a workout),
// taking it back, and Home's list of what is done. The plan's status is the record; this
// only asks the API and shows what it says.

import { useCallback, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { Icon } from "@/components/icons";
import { fetcher } from "@/lib/api";
import { actionHref, DELIVERY, kindTint, tint } from "@/lib/kinds";
import { useTicketActions } from "@/lib/ticket-actions";
import type { DoneResponse, SaveDetail, Ticket } from "@/lib/types";

/** Done or not, and the two ways to change it, for one save's action. */
export function useDone(ticket: Ticket) {
  const { mutate } = useSWRConfig();
  const key = `/api/saves/${ticket.save_id}`;
  const apply = useCallback(
    (t: Ticket) => void mutate<SaveDetail>(key, (cur) => (cur ? { ...cur, ticket: t } : cur), { revalidate: false }),
    [key, mutate],
  );
  const actions = useTicketActions(ticket, { apply });
  const done = ticket.plan?.status === "done";
  const run = useCallback(
    async (status: "done" | "accepted") => {
      const next = await actions.setStatus(status);
      if (!next) return;
      apply(next);
      actions.refresh(key);
    },
    [actions, apply, key],
  );
  return {
    done,
    when: ticket.plan?.done_on ?? null,
    busy: actions.busy !== null,
    error: actions.error,
    // Only an open action can be finished; an answered one (planned for a time, or skipped)
    // is finished from its plan card.
    canMark: ticket.plan?.status === "proposed",
    mark: () => run("done"),
    reopen: () => run("accepted"),
  };
}

/** The foot of an action page: "Mark as done", or "Done today" with Undo. */
export function DoneBar({ ticket }: { ticket: Ticket }) {
  const d = useDone(ticket);
  if (!d.done && !d.canMark) return null;
  return (
    <div className="donebar" aria-live="polite">
      {d.done ? (
        <div className="donebar-done">
          <span className="donebar-check" aria-hidden="true">
            <Icon name="check" />
          </span>
          <span className="donebar-text">
            <b>Done{d.when ? ` ${d.when}` : ""}</b>
            <span>It&apos;s in Completed on Home.</span>
          </span>
          <button type="button" className="text-btn" disabled={d.busy} onClick={() => void d.reopen()}>
            Undo
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-block donebar-btn" disabled={d.busy} onClick={() => void d.mark()}>
          <Icon name="check" />
          Mark as done
        </button>
      )}
      {d.error && (
        <p role="alert" className="plan-error">
          {d.error}
        </p>
      )}
    </div>
  );
}

const SHOWN = 4;

/** Home's "Completed": what has been done, newest first. */
export function Completed() {
  const { data } = useSWR<DoneResponse>("/api/done?limit=20", fetcher);
  const [all, setAll] = useState(false);
  if (!data) return null;
  const items = data.items;
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <section className="blk gutter" aria-labelledby="done-h">
      <div className="block-head">
        <h2 className="block-title" id="done-h">
          Completed
          {data.week > 0 && (
            <span className="pill" style={tint("mint")}>
              {data.week} this week
            </span>
          )}
        </h2>
      </div>
      {items.length === 0 ? (
        <p className="done-empty">
          <Icon name="check" />
          <span>Nothing done yet. Open something in Ready for you and mark it done when you finish.</span>
        </p>
      ) : (
        <>
          <ul className="done-list">
            {shown.map((t) => (
              <li key={t.save_id}>
                <DoneRow ticket={t} />
              </li>
            ))}
          </ul>
          {items.length > SHOWN && (
            <button type="button" className="text-btn done-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? "Show less" : `Show all ${items.length}`}
              <Icon name="down" />
            </button>
          )}
        </>
      )}
    </section>
  );
}

function DoneRow({ ticket: t }: { ticket: Ticket }) {
  const deliver = t.action?.deliver ?? "keep";
  const label = deliver === "keep" ? null : DELIVERY[deliver].label;
  const what = t.action && deliver !== "keep" ? t.action.cta : t.title ?? "Saved reel";
  const when = t.plan?.done_on ?? t.plan?.done_day;
  return (
    <Link href={actionHref(t.save_id, deliver)} className="done-row">
      <span className="done-thumb" style={kindTint(t.type)}>
        {t.thumb_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.thumb_url} alt="" loading="lazy" />
        ) : null}
        <span className="done-tick" aria-hidden="true">
          <Icon name="check" />
        </span>
      </span>
      <span className="done-main">
        <span className="done-what">{what}</span>
        <span className="done-meta">
          {[label, when ? `Done ${when}` : "Done"].filter(Boolean).join(" · ")}
        </span>
      </span>
    </Link>
  );
}
