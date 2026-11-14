"use client";

// A ticket that follows its save live: polls GET /api/saves/{id} every 700 ms while it's
// being read and planned, every 3 s while the video is watched, then stops (SPEC 13.4).

import { Ticket, TicketPlaceholder, type TicketProps } from "@/components/ticket";
import { useSaveDetail } from "@/lib/hooks";
import type { Ticket as TicketData } from "@/lib/types";

export function LiveTicket({
  saveId,
  initial,
  ...rest
}: { saveId: string; initial?: TicketData | null } & Omit<TicketProps, "ticket">) {
  const { data } = useSaveDetail(saveId);
  const ticket = data?.ticket ?? initial;
  if (!ticket) return <TicketPlaceholder />;
  return <Ticket ticket={ticket} {...rest} />;
}
