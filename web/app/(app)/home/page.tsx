"use client";

// Home: the greeting, what is ready for you (each opens its action), the rail of recent
// saves, and what you've completed. Tastes, search and "Remember this" are in My collection.
// Everything on it comes from the API.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { useNow } from "@/components/bits";
import { ActionTile, ReadyTile, useBundles } from "@/components/bundle-card";
import { Completed } from "@/components/done";
import { Icon } from "@/components/icons";
import { PullToRefresh } from "@/components/pull-refresh";
import { LiveReelTile, ReelTile, TilePlaceholder } from "@/components/reel-tile";
import { useApp } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { greeting, inFlight, plural } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { STORY_REPLAY_HREF, useStorySeen } from "@/lib/story";
import { KIND_ORDER, KINDS, tint } from "@/lib/kinds";
import type { SaveType, SavesPage, TastesResponse } from "@/lib/types";

/** "4 workouts", "3 recipes" -> "You have 4 new workouts and 3 recipes". */
function newThings(parts: string[]): string {
  const [first, ...rest] = parts;
  const lead = first.replace(/^(\d+) /, "$1 new ");
  const all = [lead, ...rest];
  return all.length === 1 ? all[0] : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}

/** Ready for you, filtered by taste: one chip per taste with actions ready, plus All. */
function ReadyFilter({
  counts,
  value,
  onChange,
}: {
  counts: Map<SaveType, number>;
  value: SaveType | null;
  onChange: (t: SaveType | null) => void;
}) {
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  const kinds = KIND_ORDER.filter((k) => counts.has(k));
  // One line if it can be: the chips get smaller step by step until they fit, and only wrap
  // when even the smallest don't. Measured, so it holds for any labels and screen width.
  const row = useRef<HTMLDivElement>(null);
  const signature = kinds.map((k) => `${k}${counts.get(k)}`).join(",");
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const fit = () => {
      const oneLine = () => {
        const chips = el.children;
        return chips.length < 2 || (chips[chips.length - 1] as HTMLElement).offsetTop === (chips[0] as HTMLElement).offsetTop;
      };
      for (const size of ["roomy", "snug", "tight"]) {
        el.dataset.fit = size;
        if (oneLine()) return;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [signature]);
  return (
    <div className="rfilter" role="group" aria-label="Show actions for" ref={row} data-fit="roomy">
      <button type="button" className="rchip is-all" aria-pressed={value === null} onClick={() => onChange(null)}>
        All <b>{total}</b>
      </button>
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          className="rchip"
          style={tint(KINDS[k].color)}
          aria-pressed={value === k}
          onClick={() => onChange(value === k ? null : k)}
        >
          <Icon name={KINDS[k].icon} />
          {KINDS[k].label} <b>{counts.get(k)}</b>
        </button>
      ))}
    </div>
  );
}

export default function HomePage() {
  const { openAdd, fresh } = useApp();
  const now = useNow();
  const { data: me } = useMe();
  const storySeen = useStorySeen();
  const tastes = useSWR<TastesResponse>("/api/tastes", fetcher);
  const saves = useSWR<SavesPage>("/api/saves?limit=10", fetcher);
  const bundles = useBundles();
  
  // A reel just added goes first in the rail: bring the rail and the page back to it.
  const railRef = useRef<HTMLDivElement>(null);
  const newest = fresh[0]?.save_id;
  useEffect(() => {
    if (!newest) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    railRef.current?.scrollTo({ left: 0, behavior });
    window.scrollTo({ top: 0, behavior });
  }, [newest]);

  const name = me?.name?.trim() ?? "";
  const hour = new Date(now).getHours();
  const hello = name ? `${greeting(hour)}, ${name}` : greeting(hour);

  // "{total} saves across {n} tastes": from /api/tastes, or from the account's own counts
  // while that hasn't answered.
  const total = tastes.data?.total ?? me?.counts.saves;
  const tasteCount =
    tastes.data?.tastes.length ?? (me ? Object.values(me.counts.by_type).filter((n) => n > 0).length : undefined);

  const freshIds = new Set(fresh.map((f) => f.save_id));
  const listed = (saves.data?.items ?? []).filter((t) => !freshIds.has(t.save_id));
  const loaded = saves.data !== undefined;
  const isEmpty = loaded && listed.length === 0 && fresh.length === 0;
  const readyList = bundles.data?.ready ?? [];
  const readyActions = bundles.data?.actions ?? [];
  const readyCount = readyList.length + readyActions.length;
  // Filter by taste: counts per type across comparisons and single actions.
  const [readyKind, setReadyKind] = useState<SaveType | null>(null);
  const readyCounts = new Map<SaveType, number>();
  for (const t of [...readyList.map((b) => b.type), ...readyActions.map((a) => a.type)]) {
    readyCounts.set(t, (readyCounts.get(t) ?? 0) + 1);
  }
  const kindShown = readyKind && readyCounts.has(readyKind) ? readyKind : null;
  const shownBundles = readyList.filter((b) => !kindShown || b.type === kindShown);
  const shownActions = readyActions.filter((a) => !kindShown || a.type === kindShown);
  const readyRail = useRef<HTMLDivElement>(null);
  function pickKind(t: SaveType | null) {
    setReadyKind(t);
    readyRail.current?.scrollTo({ left: 0 });
  }
  const recap = tastes.data?.recap ?? null;
  // Still being read right now: just added in this visit, or in the list and not done.
  // The list is asked again when a new save finishes, so its status is the current one.
  const statusOf = new Map((saves.data?.items ?? []).map((t) => [t.save_id, t.processing]));
  const saving =
    fresh.filter((f) => inFlight(statusOf.get(f.save_id) ?? f.ticket?.processing ?? "queued")).length +
    listed.filter((t) => inFlight(t.processing)).length;

  // Pull down at the top: ask the server again for everything this screen shows.
  const { mutate } = useSWRConfig();
  const reload = useCallback(
    () =>
      mutate(
        (key) => typeof key === "string" && key.startsWith("/api/") && key !== "/api/config" && key !== "/api/health",
      ),
    [mutate],
  );

  return (
    <>
      <PullToRefresh onRefresh={reload} />
      <div className="gutter">
        <header className="home-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="greet">{hello}</h1>
            {recap ? (
              recap.window === "new" ? (
                <p className="greet-sub recap">
                  You have <b>{newThings(recap.parts)}</b>
                </p>
              ) : (
                <p className="greet-sub recap">
                  This week: <b>{recap.text}</b>
                </p>
              )
            ) : total !== undefined && tasteCount !== undefined && total > 0 && (
              <p className="greet-sub">
                {plural(total, "save", "saves")}
                {/* A save that is still being read, or could not be, has no taste yet. */}
                {tasteCount > 0 && ` across ${plural(tasteCount, "taste", "tastes")}`}
              </p>
            )}
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
      </div>

      {readyCount > 0 && !isEmpty && (
        <section className="blk" aria-labelledby="ready-h">
          <div className="gutter block-head">
            <h2 className="block-title" id="ready-h">
              Ready for you
              <span className="pill">{readyCount}</span>
            </h2>
            <Link href="/plans" className="see-all">
              See all
              <Icon name="right" />
            </Link>
          </div>
          {readyCounts.size > 1 && <ReadyFilter counts={readyCounts} value={kindShown} onChange={pickKind} />}
          <p className="vh" aria-live="polite">
            {kindShown ? `Showing ${shownBundles.length + shownActions.length} ${KINDS[kindShown].label} actions` : ""}
          </p>
          <div className="rail rail-gallery rail-2x2" ref={readyRail} key={kindShown ?? "all"}>
            {shownBundles.map((b) => (
              <ReadyTile key={b.id} bundle={b} />
            ))}
            {shownActions.map((a) => (
              <ActionTile key={a.save_id} item={a} />
            ))}
          </div>
        </section>
      )}

      {isEmpty ? (
        <div className="gutter">
          <div className="empty">
            <h2 className="empty-title">Nothing saved yet</h2>
            <p className="empty-text">Add a reel from Instagram and it comes back with a plan.</p>
            <button type="button" className="btn btn-primary" onClick={openAdd}>
              <Icon name="plus" />
              Add a reel
            </button>
          </div>
        </div>
      ) : (
        <section className="blk" aria-labelledby="recent-h">
          <div className="gutter block-head">
            <h2 className="block-title" id="recent-h">
              Recently saved
              {saving > 0 ? (
                <span className="pill" style={tint("lavender")}>
                  <span className="dot" aria-hidden="true" />
                  {saving} saving
                </span>
              ) : (
                fresh.length > 0 && (
                  <span className="pill" style={tint("mint")}>
                    {fresh.length} new
                  </span>
                )
              )}
            </h2>
          </div>
          {saves.error && !loaded && fresh.length === 0 ? (
            <div className="gutter msg" role="alert">
              <p>Your saves didn&apos;t load. Check your connection.</p>
              <button type="button" className="btn" onClick={() => void saves.mutate()}>
                Try again
              </button>
            </div>
          ) : (
            <div className="rail rail-2x2" ref={railRef}>
              {fresh.map((f) => (
                <LiveReelTile key={f.save_id} saveId={f.save_id} initial={f.ticket} now={now} />
              ))}
              {!loaded && fresh.length === 0 && (
                <>
                  <TilePlaceholder />
                  <TilePlaceholder />
                  <TilePlaceholder />
                  <TilePlaceholder />
                </>
              )}
              {listed.map((t) =>
                inFlight(t.processing) ? (
                  <LiveReelTile key={t.save_id} saveId={t.save_id} initial={t} now={now} />
                ) : (
                  <ReelTile key={t.save_id} ticket={t} now={now} />
                ),
              )}
            </div>
          )}
        </section>
      )}

      {!isEmpty && loaded && <Completed />}
    </>
  );
}
