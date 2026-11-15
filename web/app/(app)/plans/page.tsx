"use client";

// Actions (the route is still /plans): what is ready for you (plans built from several
// saves, one tap to start), what is waiting on you (plan cards with the same controls as
// the Reel page), what is coming up by day, what is done, and what is later.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ReelThumb } from "@/components/bits";
import { BundleCard, BundleRow, useBundles } from "@/components/bundle-card";
import { Icon } from "@/components/icons";
import { PlanCard } from "@/components/plan-card";
import { SaveRow } from "@/components/save-row";
import { useApp } from "@/components/shell";
import { api, fetcher } from "@/lib/api";
import { ticketTitle } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { useTicketActions } from "@/lib/ticket-actions";
import type { Bundle, PlansResponse, Ticket } from "@/lib/types";

/** A waiting event whose dates have passed: one compact line that still opens the reel,
 *  and the card's own way out ("Just save": no plan, the reel stays in the library). */
function MissedRow({ ticket }: { ticket: Ticket }) {
  const [gone, setGone] = useState(false);
  const actions = useTicketActions(ticket, { apply: () => undefined });
  const clear = ticket.plan?.extras.find((x) => x.id === "none");
  const when = (ticket.plan?.why ?? "").replace(/\s*It's passed\.$/, "");
  if (gone) return null;
  return (
    <li className="missed-row">
      <Link href={`/s/${ticket.save_id}`} className="row">
        <ReelThumb thumbUrl={ticket.thumb_url} type={ticket.type} small />
        <span className="row-main">
          <span className="row-title">{ticketTitle(ticket)}</span>
          {when && <span className="row-meta">{when}</span>}
        </span>
      </Link>
      {clear && (
        <button
          type="button"
          className="text-btn"
          disabled={actions.busy !== null}
          aria-label={`Clear ${ticketTitle(ticket)}, keep it in your library`}
          onClick={async () => {
            if ((await actions.confirm(clear.label)) !== null) setGone(true);
          }}
        >
          Clear
        </button>
      )}
    </li>
  );
}

function MissedGroup({ items }: { items: Ticket[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="blk missed" aria-label="Missed">
      <button
        type="button"
        className="missed-toggle"
        aria-expanded={open}
        aria-controls="missed-list"
        onClick={() => setOpen((v) => !v)}
      >
        <span>Missed</span>
        <span className="missed-count">{items.length}</span>
        <span className="missed-hint">{items.length === 1 ? "Its date has passed" : "Their dates have passed"}</span>
        <Icon name="down" />
      </button>
      {open && (
        <ul id="missed-list" className="rows">
          {items.map((t) => (
            <MissedRow key={t.save_id} ticket={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DayList({ days, headingLevel }: { days: PlansResponse["days"]; headingLevel: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <>
      {days.map((day) => {
        // A plan whose time has passed asks "Did you make it?" right here.
        const due = day.items.filter((t) => t.plan?.followup_due);
        const rest = day.items.filter((t) => !t.plan?.followup_due);
        return (
          <section key={day.date} aria-label={day.label}>
            <Heading className="day-label">{day.label}</Heading>
            {due.length > 0 && (
              <div className="stack-col">
                {due.map((t) => (
                  <PlanCard key={t.save_id} ticket={t} withReel />
                ))}
              </div>
            )}
            {rest.length > 0 && (
              <ul className="rows">
                {rest.map((t) => (
                  <li key={t.save_id}>
                    <SaveRow ticket={t} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

export default function PlansPage() {
  const { openAdd } = useApp();
  const { data: me } = useMe();
  const { data, error, isLoading, mutate } = useSWR<PlansResponse>("/api/plans?range=week", fetcher);
  const bundles = useBundles();
  const [showLater, setShowLater] = useState(false);
  const { data: later, error: laterError } = useSWR<PlansResponse>(
    showLater ? "/api/plans?range=upcoming" : null,
    fetcher,
  );

  const header = (
    <header className="page-head">
      <h1 className="page-title">Actions</h1>
      {data && <p className="page-sub">{data.week_label}</p>}
    </header>
  );

  if (error && !data) {
    return (
      <div className="gutter">
        {header}
        <div className="msg" role="alert">
          <p>Your actions didn&apos;t load. Check your connection.</p>
          <button type="button" className="btn" onClick={() => void mutate()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="gutter">
        {header}
        <div className="stack-col" style={{ marginTop: 30 }} role="status">
          <span className="vh">Loading your plans</span>
          <span className="skel" style={{ height: 180, borderRadius: 24, width: "100%" }} />
          <span className="skel" style={{ height: 76, borderRadius: 20, width: "100%", marginTop: 0 }} />
        </div>
      </div>
    );
  }

  const ready = bundles.data?.ready ?? [];
  const started = bundles.data?.started ?? [];

  // "Not now": it leaves at once and stays away until the saves in it change.
  async function dismiss(b: Bundle) {
    void bundles.mutate(
      (cur) => (cur ? { ...cur, ready: cur.ready.filter((x) => x.id !== b.id) } : cur),
      { revalidate: false },
    );
    try {
      await api<{ ok: boolean }>(`/api/bundles/${b.id}/dismiss`, { method: "POST" });
    } catch {
      void bundles.mutate();
    }
  }

  const empty =
    data.waiting.length === 0 &&
    data.days.length === 0 &&
    data.done.length === 0 &&
    data.later_count === 0 &&
    ready.length === 0 &&
    started.length === 0;

  if (empty) {
    return (
      <div className="gutter">
        {header}
        <div className="empty">
          <h2 className="empty-title">Nothing to do yet</h2>
          <p className="empty-text">Add a reel from Instagram and its plan shows up here.</p>
          <button type="button" className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" />
            Add a reel
          </button>
          {me?.is_demo && (
            <p style={{ marginTop: 14, textAlign: "center" }}>
              <Link href="/demo" className="link">
                Try a sample reel
              </Link>
            </p>
          )}
        </div>
      </div>
    );
  }

  // An event whose dates have passed has nothing left to plan: it sits under Missed.
  const waiting = data.waiting.filter((t) => !t.plan?.missed);
  const missed = data.waiting.filter((t) => t.plan?.missed);
  const hasWaiting = waiting.length > 0;

  return (
    <div className="gutter">
      {header}

      {ready.length > 0 && (
        <section className="blk" aria-labelledby="ready-h">
          <div className="block-head">
            <h2 id="ready-h" className="block-title">
              Ready for you
              <span className="pill">{ready.length}</span>
            </h2>
          </div>
          <p className="blk-sub">Built from what you saved, ready to go.</p>
          <div className="stack-col">
            {ready.map((b) => (
              <BundleCard key={b.id} bundle={b} onDismiss={dismiss} />
            ))}
          </div>
        </section>
      )}

      {hasWaiting && (
        <section className="blk" aria-labelledby="waiting-h">
          <div className="block-head">
            <h2 id="waiting-h" className="block-title">
              Waiting on you
              <span className="pill">{waiting.length}</span>
            </h2>
            <button type="button" className="add" onClick={openAdd}>
              <Icon name="plus" />
              Add
            </button>
          </div>
          <div className="stack-col">
            {/* Only the first card gets the loud button, so one thing stands out. */}
            {waiting.map((t, i) => (
              <PlanCard key={t.save_id} ticket={t} withReel quietButton={i > 0} />
            ))}
          </div>
        </section>
      )}

      {missed.length > 0 && <MissedGroup items={missed} />}

      {data.days.length > 0 && (
        <section className="blk" aria-labelledby="week-h">
          <div className="block-head">
            <h2 id="week-h" className="block-title">
              Coming up
            </h2>
            {!hasWaiting && (
              <button type="button" className="add" onClick={openAdd}>
                <Icon name="plus" />
                Add
              </button>
            )}
          </div>
          <DayList days={data.days} headingLevel="h3" />
        </section>
      )}

      {started.length > 0 && (
        <section className="blk" aria-labelledby="started-h">
          <div className="block-head">
            <h2 id="started-h" className="block-title">
              Started
            </h2>
          </div>
          <ul className="brows">
            {started.map((b) => (
              <li key={b.id}>
                <BundleRow bundle={b} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.done.length > 0 && (
        <section className="blk" aria-labelledby="done-h">
          <div className="block-head">
            <h2 id="done-h" className="block-title">
              Done this week
            </h2>
            <span className="block-note">{data.done.length}</span>
          </div>
          <ul className="rows">
            {data.done.map((t) => (
              <li key={t.save_id}>
                <SaveRow ticket={t} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.later_count > 0 && (
        <section className="blk">
          {!showLater ? (
            <button type="button" className="btn btn-block" onClick={() => setShowLater(true)}>
              Later: {data.later_count} more
            </button>
          ) : (
            <>
              <div className="block-head">
                <h2 className="block-title">Later</h2>
              </div>
              {later ? (
                <DayList days={later.days} headingLevel="h3" />
              ) : laterError ? (
                <p className="msg">Later plans didn&apos;t load. Check your connection.</p>
              ) : (
                <p className="msg">Loading later plans</p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
