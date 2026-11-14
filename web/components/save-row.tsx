"use client";

// A reel as a row: thumbnail, title, kind chip, and where its plan stands. Used on the
// saves list (with the search snippet) and for the days on Plans.

import Link from "next/link";
import { KindChip, ReelThumb } from "@/components/bits";
import { Icon, type IconName } from "@/components/icons";
import { followupQuestion, ticketState, ticketTitle } from "@/lib/format";
import type { Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";

function rowState(t: Ticket): { icon: IconName; text: string; good?: boolean } {
  const state = ticketState(t);
  if (state === "failed") return { icon: "alert", text: "Couldn't read this reel yet" };
  if (state === "printing") return { icon: "clock", text: "Reading" };
  if (state === "proposed" || state === "proposed_quiet") return { icon: "spark", text: "Waiting on you" };
  if (state === "followup") return { icon: "plans", text: followupQuestion(t.plan?.kind) };
  if (state === "accepted") return { icon: "plans", text: t.plan?.big_time ?? "Planned", good: true };
  if (state === "done") return { icon: "check", text: `Done${t.plan?.done_day ? ` ${t.plan.done_day}` : ""}`, good: true };
  if (state === "skipped") return { icon: "skip", text: "Skipped" };
  if (t.processing === "enriching" || t.processing === "planned") return { icon: "clock", text: "Watching the video" };
  return { icon: "bookmark", text: "No plan" };
}

export function SaveRow({
  ticket,
  when,
}: {
  ticket: Ticket;
  /** "2 days ago" or "Saved Oct 3"; left out on Plans, where the day is the heading. */
  when?: string;
}) {
  const state = rowState(ticket);
  return (
    <Link href={`/s/${ticket.save_id}`} className="row">
      <ReelThumb thumbUrl={ticket.thumb_url} type={ticket.type} />
      <span className="row-main">
        <span className="row-title">{ticketTitle(ticket)}</span>
        <span className="row-meta">
          <KindChip type={ticket.type} sub={ticket.subcategory} />
          <span className={cn("state", state.good && "good")}>
            <Icon name={state.icon} />
            {state.text}
          </span>
          {when && <span>{when}</span>}
        </span>
        {ticket.snippet && <span className="row-snip">{ticket.snippet}</span>}
      </span>
      <Icon name="right" />
    </Link>
  );
}
