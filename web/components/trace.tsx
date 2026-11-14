"use client";

// "How it was planned" (DESIGN.md section 4): a 560 px side panel at 1100 px or wider,
// a bottom sheet below that. The app shell owns the selection; tickets ask it to show a save.

import { createContext, useContext } from "react";
import { Clock } from "lucide-react";
import { AgentTrace } from "@/components/agent-activity";
import { useSaveDetail } from "@/lib/hooks";
import { ticketTitle } from "@/lib/format";

export interface TraceApi {
  /** False outside the app shell (landing, setup, public plan page). */
  available: boolean;
  selectedId: string | null;
  /** Point the side panel at a save without opening anything (pages do this on load). */
  select: (saveId: string | null) => void;
  /** The user asked to see the trace: select it, and open the bottom sheet below 1100 px. */
  show: (saveId: string) => void;
}

export const TraceContext = createContext<TraceApi>({
  available: false,
  selectedId: null,
  select: () => {},
  show: () => {},
});

/** Demo accounts start with samples that were planned ahead of time, so they have no run to show. */
export const SEEDED_SAMPLE_NOTE =
  "This sample was planned before the demo started, so no steps were recorded. Save one from Samples to watch the steps.";

export function useTrace(): TraceApi {
  return useContext(TraceContext);
}

/** The trace for one save: both layers of agent activity plus the enriching line. */
export function TraceBody({ saveId, showTitle = true }: { saveId: string; showTitle?: boolean }) {
  const { data, error } = useSaveDetail(saveId);

  if (error && !data) {
    return <p className="text-[14px] text-muted">The steps didn&apos;t load. Check your connection.</p>;
  }
  if (!data) {
    return <p className="text-[14px] text-muted">Loading the steps</p>;
  }
  const t = data.ticket;
  const enriching = t.processing === "enriching" || t.processing === "planned";
  const working = enriching || t.processing === "queued" || t.processing === "reading" || t.processing === "planning";
  return (
    <div>
      {showTitle && <p className="mb-3 line-clamp-2 text-[15px] font-semibold text-ink">{ticketTitle(t)}</p>}
      <AgentTrace runs={data.runs} live={working} emptyText={t.is_sample ? SEEDED_SAMPLE_NOTE : undefined} />
      {enriching && (
        <p className="mt-4 flex items-center gap-2 text-[14px] text-muted">
          <Clock aria-hidden="true" className="size-4 shrink-0" />
          Watching the video for details.
        </p>
      )}
    </div>
  );
}
