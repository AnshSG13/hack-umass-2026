"use client";

// Change sheet (DESIGN.md section 5): "Pick a time", up to 3 free slots, "Other time",
// primary "Add to {long_day}", text button "Keep it as is".

import { useId, useState } from "react";
import useSWR from "swr";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { fetcher } from "@/lib/api";
import { localInputValue, longDayFor } from "@/lib/format";
import { btnPrimary, btnText, inputBase } from "@/lib/styles";
import { cn } from "@/lib/utils";
import type { Ticket } from "@/lib/types";

interface Slot {
  start_local: string;
  big_time: string;
  long_day: string;
}

const OTHER = "other";

export function ChangeSheet({
  ticket,
  open,
  onOpenChange,
  onPick,
  error,
  busy,
}: {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** choice is an option id when the slot is one of the plan's options, else "custom" with startLocal. */
  onPick: (choice: string, startLocal?: string) => Promise<boolean>;
  error: string | null;
  busy: boolean;
}) {
  const { data, error: loadError } = useSWR<{ slots: Slot[] }>(
    open ? `/api/saves/${ticket.save_id}/slots` : null,
    fetcher,
  );
  const slots = data?.slots ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const name = useId();
  const otherId = useId();
  const errorId = useId();

  const loaded = Boolean(data) || Boolean(loadError);
  const selected = picked ?? (slots[0]?.start_local || (loaded ? OTHER : null));
  const slot = slots.find((s) => s.start_local === selected);
  const longDay = slot ? slot.long_day : selected === OTHER && other ? longDayFor(other) : null;
  const shownError = localError ?? error;

  async function submit() {
    setLocalError(null);
    if (slot) {
      const option = ticket.plan?.options.find((o) => o.start_local === slot.start_local);
      if (await onPick(option ? option.id : "custom", option ? undefined : slot.start_local)) onOpenChange(false);
      return;
    }
    if (!other) {
      setLocalError("Pick a day and time first.");
      return;
    }
    if (new Date(other).getTime() <= Date.now()) {
      setLocalError("That time has passed. Pick a later one.");
      return;
    }
    if (await onPick("custom", other)) onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <SheetTitle>Pick a time</SheetTitle>
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset>
            <legend className="sr-only">Pick a time</legend>
            {!loaded && <p className="py-3 text-[14px] text-muted">Checking your week</p>}
            {slots.map((s) => (
              <label
                key={s.start_local}
                className="flex min-h-12 items-center gap-3 border-b border-line text-[16px] text-ink"
              >
                <input
                  type="radio"
                  name={name}
                  className="size-5 accent-[var(--ink)]"
                  checked={selected === s.start_local}
                  onChange={() => {
                    setPicked(s.start_local);
                    setLocalError(null);
                  }}
                />
                <span>
                  <span className="tabular font-medium">{s.big_time}</span>
                  <span className="text-muted"> · You&apos;re free</span>
                </span>
              </label>
            ))}
            {loaded && (
              <div className="py-1">
                <label className="flex min-h-12 items-center gap-3 text-[16px] text-ink">
                  <input
                    type="radio"
                    name={name}
                    className="size-5 accent-[var(--ink)]"
                    checked={selected === OTHER}
                    onChange={() => {
                      setPicked(OTHER);
                      setLocalError(null);
                    }}
                  />
                  <span>Other time</span>
                </label>
                {selected === OTHER && (
                  <div className="pb-2 pl-8">
                    <label htmlFor={otherId} className="sr-only">
                      Day and time
                    </label>
                    <input
                      id={otherId}
                      type="datetime-local"
                      className={cn(inputBase, "w-full")}
                      value={other}
                      min={localInputValue(5)}
                      aria-invalid={shownError ? true : undefined}
                      aria-describedby={shownError ? errorId : undefined}
                      onChange={(e) => {
                        setOther(e.target.value);
                        setLocalError(null);
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </fieldset>
          {shownError && (
            <p id={errorId} role="alert" className="pb-2 text-[14px] text-danger-ink">
              {shownError}
            </p>
          )}
          <button type="submit" className={`${btnPrimary} mt-2`} disabled={busy || !loaded}>
            {longDay ? `Add to ${longDay}` : "Add to your week"}
          </button>
          <button type="button" className={`${btnText} mt-1 w-full`} onClick={() => onOpenChange(false)}>
            Keep it as is
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
