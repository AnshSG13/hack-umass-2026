"use client";

// Home, after the mockup: greeting, search, the rail of recent saves, 
// and the tastes grid. Everything on it comes from the API.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { useNow } from "@/components/bits";
import { ActionTile, ReadyTile, useBundles } from "@/components/bundle-card";
import { Icon } from "@/components/icons";
import { PullToRefresh } from "@/components/pull-refresh";
import { LiveReelTile, ReelTile, TilePlaceholder } from "@/components/reel-tile";
import { useApp } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { greeting, inFlight, plural } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { KIND_ORDER, KINDS, tint } from "@/lib/kinds";
import type { RememberItem, SaveType, SavesPage, Taste, TastesResponse } from "@/lib/types";

/** "4 workouts", "3 recipes" -> "You have 4 new workouts and 3 recipes". */
function newThings(parts: string[]): string {
  const [first, ...rest] = parts;
  const lead = first.replace(/^(\d+) /, "$1 new ");
  const all = [lead, ...rest];
  return all.length === 1 ? all[0] : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}

function sentence(tag: string): string {
  return tag ? tag[0].toUpperCase() + tag.slice(1) : tag;
}

function Thumbs({ urls, className }: { urls: string[]; className: string }) {
  if (urls.length === 0) return null;
  return (
    <span className={className} aria-hidden="true">
      {urls.slice(0, 3).map((u) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={u} src={u} alt="" loading="lazy" />
      ))}
    </span>
  );
}

function TasteTile({ taste, wide }: { taste: Taste; wide: boolean }) {
  const kind = KINDS[taste.type];
  const label = taste.label || kind.label;
  const count = plural(taste.count, "save", "saves");
  const href = `/t/${taste.type}`;
  const fresh = taste.new > 0 ? (
    <span className="taste-new" aria-label={`${taste.new} new`}>
      {taste.new > 9 ? "9+" : taste.new}
    </span>
  ) : null;

  if (wide) {
    return (
      <Link href={href} className="taste taste-wide" style={tint(kind.color)}>
        {fresh}
        <span className="taste-row">
          <span>
            <Icon name={kind.icon} />
            <span className="taste-name">{label}</span>
            <span className="taste-count">{count}</span>
          </span>
          <Thumbs urls={taste.thumbs} className="fan" />
        </span>
        {(taste.subcategories ?? []).length > 0 ? (
          <span className="subs">
            {(taste.subcategories ?? []).slice(0, 4).map((s) => (
              <span key={s.name}>
                {s.name} <b>{s.count}</b>
              </span>
            ))}
          </span>
        ) : (
          taste.tags.length > 0 && (
            <span className="subs">
              {taste.tags.map((t) => (
                <span key={t.tag}>
                  {sentence(t.tag)} <b>{t.count}</b>
                </span>
              ))}
            </span>
          )
        )}
      </Link>
    );
  }
  return (
    <Link href={href} className="taste" style={tint(kind.color)}>
      {fresh}
      <span className="taste-top">
        <Icon name={kind.icon} />
        <Thumbs urls={taste.thumbs} className="stack" />
      </span>
      <span>
        <span className="taste-name">{label}</span>
        <span className="taste-count">{count}</span>
      </span>
    </Link>
  );
}

const REMEMBER_KEY = "rl_remember_hidden";

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
  return (
    <div className="rfilter" role="group" aria-label="Show actions for">
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

/** A just-vibes reel from before today, back for a moment: "Remember this puppy growing up".
 *  Closing it hides today's one on this device. */
function RememberCard() {
  const { data } = useSWR<{ item: RememberItem | null }>("/api/remember", fetcher, { revalidateOnFocus: false });
  const item = data?.item ?? null;
  const [hidden, setHidden] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(REMEMBER_KEY);
    } catch {
      return null;
    }
  });
  if (!item || hidden === `${item.day}:${item.save_id}`) return null;
  function close() {
    const v = `${item!.day}:${item!.save_id}`;
    setHidden(v);
    try {
      window.localStorage.setItem(REMEMBER_KEY, v);
    } catch {
      // Private mode: it stays closed for this visit only.
    }
  }
  return (
    <div className="gutter">
      <div className="remember" style={tint("butter")}>
        <Link href={`/s/${item.save_id}`} className="remember-main">
          {item.thumb_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumb_url} alt="" className="remember-thumb" />
          ) : (
            <span className="remember-thumb" aria-hidden="true">
              <Icon name="spark" />
            </span>
          )}
          <span className="remember-text">
            <span className="remember-line">{item.line}</span>
            <span className="remember-meta">You saved this {item.saved_on}</span>
          </span>
        </Link>
        <button type="button" className="remember-x" aria-label="Close" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { openAdd, fresh } = useApp();
  const now = useNow();
  const { data: me } = useMe();
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
  const tasteList = tastes.data?.tastes ?? [];
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
          </div>
          <Link href="/settings" className="avatar" aria-label="Settings">
            {name ? name[0].toUpperCase() : <Icon name="user" />}
          </Link>
        </header>
        {!isEmpty && (
          <Link href="/library?focus=1" className="search">
            <Icon name="search" />
            <span>Search your saves</span>
          </Link>
        )}
      </div>

      {!isEmpty && <RememberCard />}

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
          <div className="rail rail-gallery" ref={readyRail} key={kindShown ?? "all"}>
            {shownBundles.map((b) => (
              <ReadyTile key={b.id} bundle={b} />
            ))}
            {shownActions.map((a) => (
              <ActionTile key={a.save_id} item={a} />
            ))}
          </div>
        </section>
      )}

      {tasteList.length > 0 && (
        <section className="blk gutter" aria-labelledby="tastes-h">
          <div className="block-head">
            <h2 className="block-title" id="tastes-h">
              Your tastes
              <span className="pill">{tasteList.length}</span>
            </h2>
          </div>
          <div className="tastes">
            {tasteList.map((t, i) => (
              <TasteTile key={t.type} taste={t} wide={i === 0} />
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
            <div className="rail" ref={railRef}>
              {fresh.map((f) => (
                <LiveReelTile key={f.save_id} saveId={f.save_id} initial={f.ticket} now={now} />
              ))}
              {!loaded && fresh.length === 0 && (
                <>
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

    </>
  );
}
