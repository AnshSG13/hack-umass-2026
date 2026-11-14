"use client";

// Actions (the route is still /plans): what is ready for you (plans built from several
// saves, one tap to start), what is waiting on you (plan cards with the same controls as
// the Reel page), what is coming up by day, what is done, and what is later.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { BundleCard, BundleRow, useBundles } from "@/components/bundle-card";
import { Icon } from "@/components/icons";
import { PlanCard } from "@/components/plan-card";
import { SaveRow } from "@/components/save-row";
import { useApp } from "@/components/shell";
import { api, fetcher } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import type { Bundle, PlansResponse } from "@/lib/types";

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
  const bundles = useBundles();
  const [showLater, setShowLater] = useState(false);
  const { data: later, error: laterError } = useSWR<PlansResponse>(
    showLater ? "/api/plans?range=upcoming" : null,
    fetcher,
  );

  const header = (
    <header className="page-head">
      <h1 className="page-title">Actions</h1>
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
  const started = bundles.data?.started ?? [];

  // "Not now": it leaves at once and stays away until the saves in it change.
  async function dismiss(b: Bundle) {
    void bundles.mutate(
      (cur) => (cur ? { ...cur, ready: cur.ready.filter((x) => x.id !== b.id) } : cur),
      { revalidate: false },
    );
    try {
      await api<{ ok: boolean }>(`/api/bundles/${b.id}/dismiss`, { method: "POST" });
    } catch {
      void bundles.mutate();
    }
  }

  const empty =
    data.waiting.length === 0 &&
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

  const hasWaiting = data.waiting.length > 0;

  return (
    <div className="gutter">
      {header}

      {ready.length > 0 && (
        <section className="blk" aria-labelledby="ready-h">
          <div className="block-head">
            <h2 id="ready-h" className="block-title">
              Ready for you
              <span className="pill">{ready.length}</span>
            </h2>
          </div>
          <p className="blk-sub">Built from what you saved. One tap puts it on your week.</p>
          <div className="stack-col">
            {ready.map((b) => (
              <BundleCard key={b.id} bundle={b} onDismiss={dismiss} />
            ))}
          </div>
        </section>
      )}

      {hasWaiting && (
        <section className="blk" aria-labelledby="waiting-h">
          <div className="block-head">
            <h2 id="waiting-h" className="block-title">
              Waiting on you
              <span className="pill">{data.waiting.length}</span>
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
              Coming up
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
