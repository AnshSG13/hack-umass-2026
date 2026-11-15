"use client";

// Home is for doing: what's due, your week, what's waiting on you, and what to buy.
// Browsing what you've saved lives in Folders (/library).

import { useCallback, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { useNow } from "@/components/bits";
import { BundleCard, BundleRow, useBundles } from "@/components/bundle-card";
import { Icon } from "@/components/icons";
import { PlanCard } from "@/components/plan-card";
import { DayList, MissedGroup } from "@/components/plans-parts";
import { PullToRefresh } from "@/components/pull-refresh";
import { LiveReelTile } from "@/components/reel-tile";
import { SaveRow } from "@/components/save-row";
import { useApp } from "@/components/shell";
import { DayPanel, PLANS_KEY, ShoppingList, useWeek, WeekStrip } from "@/components/week";
import { api, fetcher } from "@/lib/api";
import { greeting } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { STORY_REPLAY_HREF, useStorySeen } from "@/lib/story";
import type { Bundle, PlansResponse } from "@/lib/types";

export default function HomePage() {
  const { openAdd, fresh } = useApp();
  const now = useNow();
  const { data: me } = useMe();
  const storySeen = useStorySeen();
  const plans = useSWR<PlansResponse>(PLANS_KEY, fetcher);
  const week = useWeek();
  const bundles = useBundles();
  const [picked, setPicked] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);
  const later = useSWR<PlansResponse>(showLater ? "/api/plans?range=upcoming" : null, fetcher);

  const name = me?.name?.trim() ?? "";
  const hello = name ? `${greeting(new Date(now).getHours())}, ${name}` : greeting(new Date(now).getHours());

  // Pull down at the top: ask the server again for everything this screen shows.
  const { mutate } = useSWRConfig();
  const reload = useCallback(
    () =>
      mutate(
        (key) => typeof key === "string" && key.startsWith("/api/") && key !== "/api/config" && key !== "/api/health",
      ),
    [mutate],
  );

  // "Not now" on a ready bundle: it leaves at once and stays away until its saves change.
  async function dismiss(b: Bundle) {
    void bundles.mutate((cur) => (cur ? { ...cur, ready: cur.ready.filter((x) => x.id !== b.id) } : cur), {
      revalidate: false,
    });
    try {
      await api<{ ok: boolean }>(`/api/bundles/${b.id}/dismiss`, { method: "POST" });
    } catch {
      void bundles.mutate();
    }
  }

  const header = (
    <header className="home-head">
      <div style={{ minWidth: 0 }}>
        <h1 className="greet">{hello}</h1>
        {plans.data && <p className="greet-sub">This week, {plans.data.week_label}</p>}
        {me?.is_demo && storySeen && (
          <Link href={STORY_REPLAY_HREF} className="text-btn story-replay">
            <Icon name="redo" />
            Replay the story
          </Link>
        )}
      </div>
      <Link href="/settings" className="avatar" aria-label="Settings">
        {name ? name[0].toUpperCase() : <Icon name="user" />}
      </Link>
    </header>
  );

  // Just added in this visit: its progress shows here until it's read.
  const justSaved =
    fresh.length > 0 ? (
      <section className="blk" aria-labelledby="fresh-h">
        <div className="gutter block-head">
          <h2 className="block-title" id="fresh-h">
            Just saved
          </h2>
        </div>
        <div className="rail">
          {fresh.map((f) => (
            <LiveReelTile key={f.save_id} saveId={f.save_id} initial={f.ticket} now={now} />
          ))}
        </div>
      </section>
    ) : null;

  const saveButton = (
    <button type="button" className="btn btn-block home-save" onClick={openAdd}>
      <Icon name="plus" />
      Save a reel
    </button>
  );

  if (plans.error && !plans.data) {
    return (
      <div className="gutter">
        {header}
        <div className="msg" role="alert">
          <p>Your week didn&apos;t load. Check your connection.</p>
          <button type="button" className="btn" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!plans.data || !week.data) {
    return (
      <div className="gutter">
        {header}
        <div className="stack-col" style={{ marginTop: 24 }} role="status">
          <span className="vh">Loading your week</span>
          <span className="skel" style={{ height: 64, borderRadius: 16, width: "100%" }} />
          <span className="skel" style={{ height: 160, borderRadius: 24, width: "100%", marginTop: 0 }} />
        </div>
      </div>
    );
  }

  const data = plans.data;
  const wk = week.data;
  const ready = bundles.data?.ready ?? [];
  const started = bundles.data?.started ?? [];

  // Nothing saved at all: one way forward.
  if (me && me.counts.saves === 0 && fresh.length === 0) {
    return (
      <div className="gutter">
        {header}
        <div className="empty">
          <h2 className="empty-title">Nothing saved yet</h2>
          <p className="empty-text">Add a reel from Instagram and it comes back with a plan for your week.</p>
          <button type="button" className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" />
            Add a reel
          </button>
          {me.is_demo && (
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

  // Plans whose time has passed ask "Did you do it?" first, whichever day they were on.
  const allPlanned = data.days.flatMap((d) => d.items);
  const checkins = allPlanned.filter((t) => t.plan?.followup_due);
  const waiting = data.waiting.filter((t) => !t.plan?.missed);
  const missed = data.waiting.filter((t) => t.plan?.missed);
  const freeByDate = new Map(wk.free.map((f) => [f.date, f]));
  const today = wk.days.find((d) => d.today) ?? wk.days[0];
  const selected = wk.days.find((d) => d.date === picked) ?? today;
  const dayItems = (data.days.find((d) => d.date === selected.date)?.items ?? []).filter(
    (t) => !t.plan?.followup_due,
  );

  return (
    <>
      <PullToRefresh onRefresh={reload} />
      <div className="gutter">
        {header}
        {saveButton}
      </div>

      {justSaved}

      <div className="gutter">
        {checkins.length > 0 && (
          <section className="blk" aria-labelledby="check-h">
            <div className="block-head">
              <h2 id="check-h" className="block-title">
                Did you do it?
                <span className="pill">{checkins.length}</span>
              </h2>
            </div>
            <div className="stack-col">
              {checkins.map((t) => (
                <PlanCard key={t.save_id} ticket={t} withReel />
              ))}
            </div>
          </section>
        )}

        <section className="blk" aria-labelledby="week-h">
          <div className="block-head">
            <h2 id="week-h" className="block-title">
              Your week
            </h2>
          </div>
          <WeekStrip
            days={wk.days}
            selected={selected.date}
            free={new Set(freeByDate.keys())}
            onSelect={(d) => setPicked(d)}
          />
          <DayPanel
            day={selected}
            items={dayItems}
            free={freeByDate.get(selected.date)}
            nextFree={wk.free.find((f) => f.date > selected.date)}
            onPick={(d) => setPicked(d)}
          />
        </section>

        {waiting.length > 0 && (
          <section className="blk" aria-labelledby="waiting-h">
            <div className="block-head">
              <h2 id="waiting-h" className="block-title">
                Waiting on you
                <span className="pill">{waiting.length}</span>
              </h2>
            </div>
            <div className="stack-col">
              {/* Only the first card gets the loud button, so one thing stands out. */}
              {waiting.map((t, i) => (
                <PlanCard key={t.save_id} ticket={t} withReel quietButton={i > 0} />
              ))}
            </div>
          </section>
        )}

        {ready.length > 0 && (
          <section className="blk" aria-labelledby="ready-h">
            <div className="block-head">
              <h2 id="ready-h" className="block-title">
                Ready for you
                <span className="pill">{ready.length}</span>
              </h2>
            </div>
            <p className="blk-sub">Built from what you saved, ready to go.</p>
            <div className="stack-col">
              {ready.map((b) => (
                <BundleCard key={b.id} bundle={b} onDismiss={dismiss} />
              ))}
            </div>
          </section>
        )}

        {missed.length > 0 && <MissedGroup items={missed} />}

        <ShoppingList week={wk} />

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
                After this week: {data.later_count} more
              </button>
            ) : (
              <>
                <div className="block-head">
                  <h2 className="block-title">After this week</h2>
                </div>
                {later.data ? (
                  <DayList days={later.data.days} headingLevel="h3" />
                ) : later.error ? (
                  <p className="msg">Later plans didn&apos;t load. Check your connection.</p>
                ) : (
                  <p className="msg">Loading later plans</p>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}
