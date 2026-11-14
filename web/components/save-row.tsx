"use client";

// Library row (DESIGN.md 7.5): thumbnail 56x75, title, "{Type} · Saved Oct 3", plan status.

import Link from "next/link";
import {
  Bookmark,
  CalendarCheck,
  CircleCheck,
  Clock,
  SkipForward,
  Ticket as TicketIcon,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Thumb } from "@/components/ticket";
import { ticketState, ticketTitle, TYPE_LABEL } from "@/lib/format";
import type { Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";

function rowStatus(t: Ticket): { icon: LucideIcon; text: string; tone: string } {
  const state = ticketState(t);
  if (state === "failed") return { icon: TriangleAlert, text: "Couldn't read this reel yet", tone: "text-ink" };
  if (state === "printing") return { icon: Clock, text: "Reading", tone: "text-muted" };
  if (state === "proposed" || state === "proposed_quiet")
    return { icon: TicketIcon, text: "Waiting on you", tone: "text-ink" };
  if (state === "accepted" || state === "followup")
    return { icon: CalendarCheck, text: t.plan?.big_time ?? "Planned", tone: "text-ink" };
  if (state === "done") return { icon: CircleCheck, text: "Done", tone: "text-done-ink" };
  if (state === "skipped") return { icon: SkipForward, text: "Skipped", tone: "text-muted" };
  if (t.processing === "enriching" || t.processing === "planned")
    return { icon: Clock, text: "Watching the video", tone: "text-muted" };
  return { icon: Bookmark, text: "No plan", tone: "text-muted" };
}

export function SaveRow({ ticket }: { ticket: Ticket }) {
  const status = rowStatus(ticket);
  const Icon = status.icon;
  const metaLine = [ticket.type ? TYPE_LABEL[ticket.type] : null, `Saved ${ticket.saved_on}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link href={`/s/${ticket.save_id}`} className="flex gap-3 rounded-[8px] py-3">
      <Thumb ticket={ticket} className="h-[75px] w-14" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[16px] leading-[1.3] font-semibold break-words text-ink">
          {ticketTitle(ticket)}
        </span>
        <span className="mt-0.5 block text-[13px] text-muted">{metaLine}</span>
        <span className={cn("mt-0.5 flex items-center gap-1.5 text-[13px]", status.tone)}>
          <Icon aria-hidden="true" className="size-[14px] shrink-0" />
          <span className="tabular">{status.text}</span>
        </span>
        {ticket.snippet && (
          <span className="mt-1 line-clamp-2 block text-[13px] text-muted">{ticket.snippet}</span>
        )}
      </span>
    </Link>
  );
}
