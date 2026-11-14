"use client";

// Custom toast (DESIGN.md section 5): bottom, above the tab bar, opacity 120 ms, 6 s,
// with an optional Undo button.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ToastItem {
  id: number;
  message: string;
  undo?: () => void;
}

interface ToastApi {
  show: (message: string, opts?: { undo?: () => void }) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });
const ToastStateContext = createContext<{ item: ToastItem | null; open: boolean; dismiss: () => void }>({
  item: null,
  open: false,
  dismiss: () => {},
});

const VISIBLE_MS = 6000;
const FADE_MS = 120;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<ToastItem | null>(null);
  const [open, setOpen] = useState(false);
  const timers = useRef<number[]>([]);
  const nextId = useRef(1);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setOpen(false);
    timers.current.push(window.setTimeout(() => setItem(null), FADE_MS));
  }, [clearTimers]);

  const show = useCallback<ToastApi["show"]>(
    (message, opts) => {
      clearTimers();
      setItem({ id: nextId.current++, message, undo: opts?.undo });
      // Mount at opacity 0, then fade in on the next frame.
      timers.current.push(window.setTimeout(() => setOpen(true), 20));
      timers.current.push(window.setTimeout(() => setOpen(false), VISIBLE_MS));
      timers.current.push(window.setTimeout(() => setItem(null), VISIBLE_MS + FADE_MS));
    },
    [clearTimers],
  );

  useEffect(() => clearTimers, [clearTimers]);

  const api = useMemo(() => ({ show }), [show]);
  const state = useMemo(() => ({ item, open, dismiss }), [item, open, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      <ToastStateContext.Provider value={state}>{children}</ToastStateContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/** Where the toast shows. The app shell places it above the tab bar. */
export function ToastViewport({ aboveTabBar = false }: { aboveTabBar?: boolean }) {
  const { item, open, dismiss } = useContext(ToastStateContext);
  return (
    <div
      className={cn(
        "toast-frame pointer-events-none fixed z-[60] px-4",
        aboveTabBar
          ? "bottom-[calc(76px+env(safe-area-inset-bottom))]"
          : "bottom-[calc(16px+env(safe-area-inset-bottom))]",
      )}
    >
      <div role="status" aria-live="polite">
        {item && (
          <div
            key={item.id}
            data-open={open}
            className="toast pointer-events-auto flex min-h-12 items-center justify-between gap-3 rounded-[12px] bg-ink py-1 pr-1 pl-4 text-[15px] text-ticket"
          >
            <span className="py-2">{item.message}</span>
            {item.undo && (
              <button
                type="button"
                className="min-h-11 shrink-0 rounded-[8px] px-3 font-semibold text-highlighter underline underline-offset-4 focus-visible:outline-highlighter"
                onClick={() => {
                  const undo = item.undo;
                  dismiss();
                  undo?.();
                }}
              >
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
