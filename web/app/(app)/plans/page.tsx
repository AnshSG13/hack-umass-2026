"use client";

// Plans: what is waiting on you (plan cards with the same controls as the Reel page),
// this week by day, what is done, and what is coming up later.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { PlanCard } from "@/components/plan-card";
import { SaveRow } from "@/components/save-row";
import { useApp } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import type { PlansResponse } from "@/lib/types";

function DayList({ days, headingLevel }: { days: PlansResponse["days"]; headingLevel: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <>
      {days.map((day) => {
        // A plan whose time has passed asks "Did you make it?" right here.
        const due = day.items.filter((t) => t.plan?.followup_due);
        const rest = day.items.filter((t) => !t.plan?.followup_due);
        return (
          <section key={day.date} aria-label={day.label}>
            <Heading className="day-label">{day.label}</Heading>
            {due.length > 0 && (
              <div className="stack-col">
                {due.map((t) => (
                  <PlanCard key={t.save_id} ticket={t} withReel />
                ))}
              </div>
            )}
            {rest.length > 0 && (
              <ul className="rows">
                {rest.map((t) => (
                  <li key={t.save_id}>
                    <SaveRow ticket={t} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

export default function PlansPage() {
  const { openAdd } = useApp();
  const { data: me } = useMe();
  const { data, error, isLoading, mutate } = useSWR<PlansResponse>("/api/plans?range=week", fetcher);
  const [showLater, setShowLater] = useState(false);
  const { data: later, error: laterError } = useSWR<PlansResponse>(
    showLater ? "/api/plans?range=upcoming" : null,
    fetcher,
  );

  const header = (
    <header className="page-head">
      <h1 className="page-title">Plans</h1>
      {data && <p className="page-sub">{data.week_label}</p>}
    </header>
  );

  if (error && !data) {
    return (
      <div className="gutter">
        {header}
        <div className="msg" role="alert">
          <p>Plans didn&apos;t load. Check your connection.</p>
          <button type="button" className="btn" onClick={() => void mutate()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="gutter">
        {header}
        <div className="stack-col" style={{ marginTop: 30 }} role="status">
          <span className="vh">Loading your plans</span>
          <span className="skel" style={{ height: 180, borderRadius: 24, width: "100%" }} />
          <span className="skel" style={{ height: 76, borderRadius: 20, width: "100%", marginTop: 0 }} />
        </div>
      </div>
    );
  }

  const empty =
    data.waiting.length === 0 && data.days.length === 0 && data.done.length === 0 && data.later_count === 0;

  if (empty) {
    return (
      <div className="gutter">
        {header}
        <div className="empty">
          <h2 className="empty-title">No plans yet</h2>
          <p className="empty-text">Add a reel from Instagram and its plan shows up here.</p>
          <button type="button" className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" />
            Add a reel
          </button>
          {me?.is_demo && (
            <p style={{ marginTop: 14, textAlign: "center" }}>
              <Link href="/demo" className="link">
                Try a sample reel
              </Link>
            </p>
          )}
        </div>
      </div>
    );
  }

  const hasWaiting = data.waiting.length > 0;

  return (
    <div className="gutter">
      {header}

      {hasWaiting && (
        <section className="blk" aria-labelledby="waiting-h">
          <div className="block-head">
            <h2 id="waiting-h" className="block-title">
              Waiting on you
            </h2>
            <button type="button" className="add" onClick={openAdd}>
              <Icon name="plus" />
              Add
            </button>
          </div>
          <div className="stack-col">
            {data.waiting.map((t) => (
              <PlanCard key={t.save_id} ticket={t} withReel />
            ))}
          </div>
        </section>
      )}

      {data.days.length > 0 && (
        <section className="blk" aria-labelledby="week-h">
          <div className="block-head">
            <h2 id="week-h" className="block-title">
              This week
            </h2>
            {!hasWaiting && (
              <button type="button" className="add" onClick={openAdd}>
                <Icon name="plus" />
                Add
              </button>
            )}
          </div>
          <DayList days={data.days} headingLevel="h3" />
        </section>
      )}

      {data.done.length > 0 && (
        <section className="blk" aria-labelledby="done-h">
          <div className="block-head">
            <h2 id="done-h" className="block-title">
              Done this week
            </h2>
            <span className="block-note">{data.done.length}</span>
          </div>
          <ul className="rows">
            {data.done.map((t) => (
              <li key={t.save_id}>
                <SaveRow ticket={t} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.later_count > 0 && (
        <section className="blk">
          {!showLater ? (
            <button type="button" className="btn btn-block" onClick={() => setShowLater(true)}>
              Later: {data.later_count} more
            </button>
          ) : (
            <>
              <div className="block-head">
                <h2 className="block-title">Later</h2>
              </div>
              {later ? (
                <DayList days={later.days} headingLevel="h3" />
              ) : laterError ? (
                <p className="msg">Later plans didn&apos;t load. Check your connection.</p>
              ) : (
                <p className="msg">Loading later plans</p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
