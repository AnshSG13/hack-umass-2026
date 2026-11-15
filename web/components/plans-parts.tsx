"use client";

// Pieces of the week's plans, shared by Home: the folded Missed group and the day lists.

import { useState } from "react";
import Link from "next/link";
import { ReelThumb } from "@/components/bits";
import { Icon } from "@/components/icons";
import { PlanCard } from "@/components/plan-card";
import { SaveRow } from "@/components/save-row";
import { ticketTitle } from "@/lib/format";
import { useTicketActions } from "@/lib/ticket-actions";
import type { PlansResponse, Ticket } from "@/lib/types";

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

export function MissedGroup({ items }: { items: Ticket[] }) {
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

/** One day's plans: any asking "Did you make it?" as cards, the rest as rows. */
export function DayItems({ items }: { items: Ticket[] }) {
  const due = items.filter((t) => t.plan?.followup_due);
  const rest = items.filter((t) => !t.plan?.followup_due);
  return (
    <>
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
    </>
  );
}

export function DayList({ days, headingLevel }: { days: PlansResponse["days"]; headingLevel: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <>
      {days.map((day) => (
        <section key={day.date} aria-label={day.label}>
          <Heading className="day-label">{day.label}</Heading>
          <DayItems items={day.items} />
        </section>
      ))}
    </>
  );
}
