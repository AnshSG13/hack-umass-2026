"use client";

// Plans, the home screen (DESIGN.md 7.4).

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CompactTicket, MiniStub, Ticket, TicketPlaceholder } from "@/components/ticket";
import { useTrace } from "@/components/trace";
import { fetcher } from "@/lib/api";
import { btnOutline, btnPrimary, btnText, pageTitle, sectionTitle } from "@/lib/styles";
import type { PlansResponse, Ticket as TicketData } from "@/lib/types";
import { cn } from "@/lib/utils";

function DayList({
  days,
  headingLevel,
  onGone,
}: {
  days: PlansResponse["days"];
  headingLevel: "h2" | "h3";
  onGone: (t: TicketData) => void;
}) {
  const Heading = headingLevel;
  return (
    <div className="flex flex-col gap-5">
      {days.map((day) => (
        <section key={day.date} aria-label={day.label}>
          <Heading className="text-[15px] font-semibold text-ink">{day.label}</Heading>
          <div className="mt-2 flex flex-col gap-3">
            {day.items.map((t) =>
              t.plan?.followup_due ? (
                // Follow-up due: the full ticket, so Done can tear the stub off right here.
                <Ticket key={t.save_id} ticket={t} href={`/s/${t.save_id}`} collapseOnDone onGone={onGone} />
              ) : (
                <CompactTicket key={t.save_id} ticket={t} />
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function PlansPage() {
  const { data, error, isLoading, mutate } = useSWR<PlansResponse>("/api/plans?range=week", fetcher);
  const [showLater, setShowLater] = useState(false);
  const { data: later, error: laterError } = useSWR<PlansResponse>(
    showLater ? "/api/plans?range=upcoming" : null,
    fetcher,
  );
  const [justDone, setJustDone] = useState<string | null>(null);
  const trace = useTrace();

  // The side panel starts on the first ticket that's waiting on you.
  const firstId = data?.waiting[0]?.save_id ?? data?.days[0]?.items[0]?.save_id ?? null;
  const { selectedId, select } = trace;
  useEffect(() => {
    if (firstId && !selectedId) select(firstId);
  }, [firstId, selectedId, select]);

  const header = (
    <header>
      <h1 className={pageTitle}>This week</h1>
      {data && <p className="text-[14px] text-muted">{data.week_label}</p>}
    </header>
  );

  if (error && !data) {
    return (
      <div>
        {header}
        <div className="mt-6" role="alert">
          <p className="text-[16px] text-ink">Plans didn&apos;t load. Check your connection.</p>
          <button type="button" className={cn(btnOutline, "mt-3")} onClick={() => void mutate()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div>
        {header}
        <div className="mt-6 flex flex-col gap-4" role="status">
          <span className="sr-only">Loading your plans</span>
          <TicketPlaceholder />
          <TicketPlaceholder />
        </div>
      </div>
    );
  }

  const empty =
    data.waiting.length === 0 && data.days.length === 0 && data.done.length === 0 && data.later_count === 0;

  if (empty) {
    return (
      <div>
        {header}
        <div className="mt-6">
          <p className="text-[17px] font-semibold text-ink">No plans yet.</p>
          <p className="mt-1 text-[16px] text-muted">Save a reel from Instagram to make your first ticket.</p>
          <Link href="/save" className={cn(btnPrimary, "mt-5")}>
            Save a reel
          </Link>
          <Link href="/demo" className={cn(btnOutline, "mt-3 w-full")}>
            Try a sample reel
          </Link>
        </div>
      </div>
    );
  }

  const hasWaiting = data.waiting.length > 0;

  return (
    <div>
      {header}

      {hasWaiting && (
        <section className="mt-6" aria-labelledby="waiting-heading">
          <h2 id="waiting-heading" className={sectionTitle}>
            Waiting on you
          </h2>
          <div className="mt-3 flex flex-col gap-4">
            {data.waiting.map((t) => (
              <Ticket key={t.save_id} ticket={t} href={`/s/${t.save_id}`} traceLink />
            ))}
          </div>
        </section>
      )}

      {data.days.length > 0 && (
        <section className="mt-6" aria-labelledby={hasWaiting ? "week-heading" : undefined}>
          {hasWaiting && (
            <h2 id="week-heading" className={cn(sectionTitle, "mb-3")}>
              This week
            </h2>
          )}
          <DayList
            days={data.days}
            headingLevel={hasWaiting ? "h3" : "h2"}
            onGone={(t) => setJustDone(t.save_id)}
          />
        </section>
      )}

      {data.done.length > 0 && (
        <section className="mt-6" aria-labelledby="done-heading">
          <h2 id="done-heading" className={sectionTitle}>
            Done this week · {data.done.length}
          </h2>
          <div className="no-scrollbar -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1">
            {data.done.map((t) => (
              <MiniStub key={t.save_id} ticket={t} fresh={t.save_id === justDone} />
            ))}
          </div>
        </section>
      )}

      {data.later_count > 0 && (
        <section className="mt-4">
          {!showLater ? (
            <button
              type="button"
              className={cn(btnText, "-ml-3 underline underline-offset-4")}
              onClick={() => setShowLater(true)}
            >
              Coming up: {data.later_count} more
            </button>
          ) : (
            <div className="mt-2">
              <h2 className={cn(sectionTitle, "mb-3")}>Coming up</h2>
              {later ? (
                <DayList days={later.days} headingLevel="h3" onGone={(t) => setJustDone(t.save_id)} />
              ) : laterError ? (
                <p className="text-[14px] text-muted">Later plans didn&apos;t load. Check your connection.</p>
              ) : (
                <p className="text-[14px] text-muted">Loading later plans</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
