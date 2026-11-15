"use client";

// The mockup's rail tile: thumbnail, kind chip, when it was saved, title. While a save is
// being read it is the processing tile (stage text and four dots) and follows the save
// live; one that could not be read says why.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { KindChip } from "@/components/bits";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { inFlight, relativeTime, ticketTitle } from "@/lib/format";
import { useRefresh, useSaveDetail } from "@/lib/hooks";
import { kindOf, kindTint } from "@/lib/kinds";
import type { Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";

const STAGE: Record<string, { text: string; dots: number }> = {
  queued: { text: "Grabbing the reel", dots: 1 },
  reading: { text: "Reading the caption", dots: 2 },
  planning: { text: "Planning it", dots: 3 },
};

export function ReelTile({
  ticket,
  now,
  followed = false,
}: {
  ticket: Ticket;
  now: number;
  /** Keep the processing layer mounted so it can fade out when the save is ready. */
  followed?: boolean;
}) {
  const processing = inFlight(ticket.processing);
  const failed = ticket.processing === "failed";
  const stage = STAGE[ticket.processing];
  const kind = kindOf(ticket.type);
  const title = ticketTitle(ticket);
  const when = relativeTime(ticket.created_at, now);
  const done = !processing && ticket.plan?.status === "done";

  return (
    <Link
      href={`/s/${ticket.save_id}`}
      className={cn("tile", processing && "is-processing")}
      aria-label={processing ? `${stage?.text ?? "Reading"}. Open this save.` : `Open ${title}${done ? ", done" : ""}`}
    >
      <span className="tile-media">
        {ticket.thumb_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ticket.thumb_url} alt="" loading="lazy" />
        ) : (
          !processing &&
          !failed && (
            <span className="tile-ph" style={kindTint(ticket.type)}>
              <Icon name={kind?.icon ?? "bookmark"} />
            </span>
          )
        )}
        {done && (
          <span className="tile-done" aria-hidden="true">
            <Icon name="check" />
            Done
          </span>
        )}
        {failed && (
          <span className="tile-fail">
            <Icon name="alert" />
            {ticket.failure_message || "Couldn't read this reel yet."}
          </span>
        )}
        {!failed && (processing || followed) && (
          <span className="proc" aria-hidden={processing ? undefined : true}>
            <span className="proc-stage">{stage?.text ?? ""}</span>
            <span className="proc-dots" aria-hidden="true">
              {[1, 2, 3, 4].map((n) => (
                <span key={n} className={stage && n <= stage.dots ? "on" : undefined} />
              ))}
            </span>
          </span>
        )}
      </span>
      {processing ? (
        <span className="tile-body" aria-hidden="true">
          <span className="skel" />
          <span className="skel" />
        </span>
      ) : (
        <>
          <span className="tile-meta">
            <KindChip type={ticket.type} />
            {when}
          </span>
          <span className="tile-title">{title}</span>
        </>
      )}
    </Link>
  );
}

/** A tile that follows its save: polls GET /api/saves/{id} while it is being read. */
export function LiveReelTile({ saveId, initial, now }: { saveId: string; initial: Ticket | null; now: number }) {
  const { data } = useSaveDetail(saveId);
  const refresh = useRefresh();
  const toast = useToast();
  const ticket = data?.ticket ?? initial;
  const busy = ticket ? inFlight(ticket.processing) : false;
  const wasBusy = useRef(false);

  // The moment it stops being read: say where it was filed and bring the lists up to date.
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current || !ticket) return;
    wasBusy.current = false;
    const kind = kindOf(ticket.type);
    if (ticket.processing !== "failed" && ticket.title && kind) {
      toast.show(`${ticket.title} filed under ${kind.label}`);
    }
    refresh();
  }, [busy, ticket, refresh, toast]);

  if (!ticket) return <TilePlaceholder />;
  return <ReelTile ticket={ticket} now={now} followed />;
}

export function TilePlaceholder() {
  return (
    <span className="tile" aria-hidden="true">
      <span className="tile-media" />
      <span className="tile-body">
        <span className="skel" />
        <span className="skel" />
      </span>
    </span>
  );
}
