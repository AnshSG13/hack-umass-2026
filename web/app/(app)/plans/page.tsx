"use client";

// Every action (reached from "See all" on Ready for you; no longer a tab): the same set as
// Home's Ready for you (one per actionable reel, plus comparisons; never just-vibes reels),
// then what is coming up by day, what was started, what is done, and what is later.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ActionTile, BundleRow, ReadyTile, useBundles } from "@/components/bundle-card";
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
  const { openAdd, goBack } = useApp();
  const { data: me } = useMe();
  const { data, error, isLoading, mutate } = useSWR<PlansResponse>("/api/plans?range=week", fetcher);
  const bundles = useBundles();
  const [showLater, setShowLater] = useState(false);
  const { data: later, error: laterError } = useSWR<PlansResponse>(
    showLater ? "/api/plans?range=upcoming" : null,
    fetcher,
  );

  const header = (
    <header className="page-head with-back">
      <div className="block-head" style={{ minHeight: 44 }}>
        <button type="button" className="back-pill" onClick={goBack}>
          <Icon name="back" />
          Back
        </button>
      </div>
      <h1 className="page-title" style={{ marginTop: 10 }}>All actions</h1>
      {data && <p className="page-sub">{data.week_label}</p>}
    </header>
  );

  if (error && !data) {
    return (
      <div className="gutter">
        {header}
        <div className="msg" role="alert">
          <p>Your actions didn&apos;t load. Check your connection.</p>
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

  const ready = bundles.data?.ready ?? [];
  const actions = bundles.data?.actions ?? [];
  const started = bundles.data?.started ?? [];

  const empty =
    actions.length === 0 &&
    data.days.length === 0 &&
    data.done.length === 0 &&
    data.later_count === 0 &&
    ready.length === 0 &&
    started.length === 0;

  if (empty) {
    return (
      <div className="gutter">
        {header}
        <div className="empty">
          <h2 className="empty-title">Nothing to do yet</h2>
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


  return (
    <div className="gutter">
      {header}

      {ready.length + actions.length > 0 && (
        <section className="blk" aria-labelledby="ready-h">
          <h2 id="ready-h" className="vh">
            Ready for you
          </h2>
          <div className="agrid">
            {ready.map((b) => (
              <ReadyTile key={b.id} bundle={b} />
            ))}
            {actions.map((a) => (
              <ActionTile key={a.save_id} item={a} />
            ))}
          </div>
        </section>
      )}

      {data.days.length > 0 && (
        <section className="blk" aria-labelledby="week-h">
          <div className="block-head">
            <h2 id="week-h" className="block-title">
              Coming up
            </h2>
          </div>
          <DayList days={data.days} headingLevel="h3" />
        </section>
      )}

      {started.length > 0 && (
        <section className="blk" aria-labelledby="started-h">
          <div className="block-head">
            <h2 id="started-h" className="block-title">
              Started
            </h2>
          </div>
          <ul className="brows">
            {started.map((b) => (
              <li key={b.id}>
                <BundleRow bundle={b} />
              </li>
            ))}
          </ul>
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
