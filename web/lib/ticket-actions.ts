"use client";

// Every change a ticket can make, against the live API. Toast text is the server's message.

import { useCallback, useState } from "react";
import { api, ApiError } from "./api";
import { useRefresh } from "./hooks";
import { useToast } from "@/components/toast";
import type { ConfirmResponse, Ticket } from "./types";

interface TicketReply {
  message?: string;
  ticket: Ticket;
}

function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Try again.";
}

/** Long enough for the punch (220 ms) to finish before lists re-sort around the ticket. */
const AFTER_PUNCH_MS = 600;

export function useTicketActions(
  ticket: Ticket,
  opts: { publicToken?: string; apply: (t: Ticket) => void },
) {
  const { publicToken, apply } = opts;
  const toast = useToast();
  const refresh = useRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveId = ticket.save_id;
  const planId = ticket.plan_id;

  const undo = useCallback(async () => {
    try {
      const r = await api<TicketReply>(`/api/saves/${saveId}/unconfirm`, { method: "POST" });
      apply(r.ticket);
      toast.show(r.message || "Undone.");
    } catch (e) {
      toast.show(messageOf(e));
    }
    refresh();
  }, [apply, refresh, saveId, toast]);

  /** Returns "accepted" | "later" | "declined" on success, null on failure. */
  const confirm = useCallback(
    async (choice: string, startLocal?: string): Promise<ConfirmResponse["status"] | null> => {
      setBusy(choice);
      setError(null);
      try {
        const body: Record<string, string> = { choice, source: "web" };
        if (startLocal) body.start_local = startLocal;
        const r = await api<ConfirmResponse>(`/api/saves/${saveId}/confirm`, { body });
        if (r.status === "error" || !r.ticket) {
          setError(r.message || "That choice expired. Pick again.");
          // The server sends the ticket back with fresh options when a time was taken.
          if (r.ticket) {
            apply(r.ticket);
            refresh();
          }
          return null;
        }
        apply(r.ticket);
        if (r.status === "accepted") {
          toast.show(r.message, { undo: () => void undo() });
          window.setTimeout(refresh, AFTER_PUNCH_MS);
        } else {
          toast.show(r.message);
          refresh();
        }
        return r.status;
      } catch (e) {
        setError(messageOf(e));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [apply, refresh, saveId, toast, undo],
  );

  /** Done, skipped, or "accepted" to take a done or skipped back (it returns to where it
   *  was). Returns the updated ticket; the caller applies it (Done tears first). Done can be
   *  undone from its toast. */
  const setStatus = useCallback(
    async (status: "done" | "skipped" | "accepted"): Promise<Ticket | null> => {
      if (!planId) return null;
      setBusy(status);
      setError(null);
      const path = publicToken
        ? `/api/public/plans/${planId}/status?t=${encodeURIComponent(publicToken)}`
        : `/api/plans/${planId}/status`;
      try {
        const r = await api<TicketReply>(path, { body: { status } });
        // The public plan page says it in the page itself ("Nice. Marked done.").
        if (!publicToken) {
          const message = r.message || (status === "done" ? "Marked done." : status === "skipped" ? "Marked skipped." : "Undone.");
          const takeBack =
            status === "done"
              ? async () => {
                  try {
                    const back = await api<TicketReply>(path, { body: { status: "accepted" } });
                    apply(back.ticket);
                    toast.show(back.message || "Undone.");
                  } catch (e) {
                    toast.show(messageOf(e));
                  }
                  refresh();
                }
              : undefined;
          toast.show(message, takeBack ? { undo: () => void takeBack() } : undefined);
        }
        return r.ticket;
      } catch (e) {
        setError(messageOf(e));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [apply, planId, publicToken, refresh, toast],
  );

  const post = useCallback(
    async (action: "replan" | "retry"): Promise<boolean> => {
      setBusy(action);
      setError(null);
      try {
        const r = await api<TicketReply>(`/api/saves/${saveId}/${action}`, { method: "POST" });
        apply(r.ticket);
        refresh();
        return true;
      } catch (e) {
        setError(messageOf(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [apply, refresh, saveId],
  );

  const replan = useCallback(() => post("replan"), [post]);
  const retry = useCallback(() => post("retry"), [post]);

  return { busy, error, confirm, undo, setStatus, replan, retry, refresh };
}
