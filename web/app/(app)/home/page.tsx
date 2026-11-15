"use client";

// Home, after the mockup: greeting, search, the rail of recent saves, ideas to ask about,
// and the tastes grid. Everything on it comes from the API.

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { useNow } from "@/components/bits";
import { BundleCard, useBundles } from "@/components/bundle-card";
import { Icon } from "@/components/icons";
import { PullToRefresh } from "@/components/pull-refresh";
import { LiveReelTile, ReelTile, TilePlaceholder } from "@/components/reel-tile";
import { useApp, useAskStore } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { greeting, inFlight, plural } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { KINDS, tint, type KindColor } from "@/lib/kinds";
import type { SavesPage, Taste, TastesResponse } from "@/lib/types";

const IDEA_COLORS: KindColor[] = ["peach", "butter", "rose", "sky", "mint", "lavender"];

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
  const href = `/library?cat=${encodeURIComponent(label)}`;

  if (wide) {
    return (
      <Link href={href} className="taste taste-wide" style={tint(kind.color)}>
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

export default function HomePage() {
  const { openAdd, fresh } = useApp();
  const { ask } = useAskStore();
  const now = useNow();
  const { data: me } = useMe();
  const tastes = useSWR<TastesResponse>("/api/tastes", fetcher);
  const saves = useSWR<SavesPage>("/api/saves?limit=10", fetcher);
  const bundles = useBundles();
  const { data: chips } = useSWR<{ chips: string[] }>("/api/chips", fetcher, { revalidateOnFocus: false });

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
  const ideas = chips?.chips ?? [];
  const tasteList = tastes.data?.tastes ?? [];
  const readyList = bundles.data?.ready ?? [];
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
            {total !== undefined && tasteCount !== undefined && total > 0 && (
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
            <button type="button" className="add" onClick={openAdd}>
              <Icon name="plus" />
              Add
            </button>
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

      {readyList.length > 0 && !isEmpty && (
        <section className="blk" aria-labelledby="ready-h">
          <div className="gutter block-head">
            <h2 className="block-title" id="ready-h">
              Ready for you
              <span className="pill">{plural(readyList.length, "plan", "plans")}</span>
            </h2>
            <Link href="/plans" className="see-all">
              See all
              <Icon name="right" />
            </Link>
          </div>
          <div className="rail">
            {readyList.map((b) => (
              <BundleCard key={b.id} bundle={b} compact />
            ))}
          </div>
        </section>
      )}

      {ideas.length > 0 && !isEmpty && (
        <section className="blk" aria-labelledby="ideas-h">
          <div className="gutter block-head">
            <h2 className="block-title" id="ideas-h">
              Make something of it
            </h2>
          </div>
          <div className="ideas">
            {ideas.map((idea, i) => (
              <button
                key={idea}
                type="button"
                className="idea"
                style={tint(IDEA_COLORS[i % IDEA_COLORS.length])}
                onClick={() => ask(idea, true)}
              >
                <Icon name="spark" />
                {idea}
              </button>
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
              <TasteTile key={t.label} taste={t} wide={i === 0} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
