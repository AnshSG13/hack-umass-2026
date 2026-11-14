"use client";

// "How it was planned" is a disclosure on the Reel page now. This context is what is left
// of the old side panel: tickets on the earlier screens still ask whether one is around
// (it never is), so they show no link to it.

import { createContext, useContext } from "react";

export interface TraceApi {
  available: boolean;
  selectedId: string | null;
  select: (saveId: string | null) => void;
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
