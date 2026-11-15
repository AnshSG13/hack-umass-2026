"use client";

// The pieces of Folders (/library), the browsing tab: the "remember" card, the rail of
// recent saves, the folders grid (one tile per kind of save) and the questions to ask
// about them. Everything on it comes from the API.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { LiveReelTile, ReelTile, TilePlaceholder } from "@/components/reel-tile";
import { useApp, useAskStore } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { inFlight, plural } from "@/lib/format";
import { boardHref, KINDS, tint } from "@/lib/kinds";
import type { RememberItem, SaveType, SavesPage, Taste, TastesResponse } from "@/lib/types";

export const RECENT_KEY = "/api/saves?limit=10";

interface Action {
  type: SaveType;
  verb: string;
  title: string;
  detail: string;
  question: string;
}

export function sentence(tag: string): string {
  return tag ? tag[0].toUpperCase() + tag.slice(1) : tag;
}

export function Thumbs({ urls, className }: { urls: string[]; className: string }) {
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

export function TasteTile({ taste, wide }: { taste: Taste; wide: boolean }) {
  const kind = KINDS[taste.type];
  const label = taste.label || kind.label;
  const count = plural(taste.count, "save", "saves");
  const href = boardHref(taste.type, taste.category);
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

/** A just-vibes reel from before today, back for a moment: "Remember this puppy growing up".
 *  Closing it hides today's one on this device. */
export function RememberCard() {
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

/** "Recently saved": the ten newest saves as a rail, with the ones just added in this visit
 *  first (still being read, they update themselves). */
export function RecentSaves({ now }: { now: number }) {
  const { openAdd, fresh } = useApp();
  const saves = useSWR<SavesPage>(RECENT_KEY, fetcher);

  // A reel just added goes first in the rail: bring the rail, and the rail's start, into view.
  const railRef = useRef<HTMLDivElement>(null);
  const newest = fresh[0]?.save_id;
  useEffect(() => {
    if (!newest) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    railRef.current?.scrollTo({ left: 0, behavior });
    railRef.current?.scrollIntoView({ block: "nearest", behavior });
  }, [newest]);

  const freshIds = new Set(fresh.map((f) => f.save_id));
  const listed = (saves.data?.items ?? []).filter((t) => !freshIds.has(t.save_id));
  const loaded = saves.data !== undefined;
  // Still being read right now: just added in this visit, or in the list and not done.
  // The list is asked again when a new save finishes, so its status is the current one.
  const statusOf = new Map((saves.data?.items ?? []).map((t) => [t.save_id, t.processing]));
  const saving =
    fresh.filter((f) => inFlight(statusOf.get(f.save_id) ?? f.ticket?.processing ?? "queued")).length +
    listed.filter((t) => inFlight(t.processing)).length;

  return (
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
  );
}

/** "Your folders": one tile per kind of save, largest first, each opening its board. */
export function YourFolders() {
  const { data } = useSWR<TastesResponse>("/api/tastes", fetcher);
  const list = data?.tastes ?? [];
  if (list.length === 0) return null;
  return (
    <section className="blk gutter" aria-labelledby="folders-h">
      <div className="block-head">
        <h2 className="block-title" id="folders-h">
          Your folders
          <span className="pill">{list.length}</span>
        </h2>
      </div>
      <div className="tastes">
        {list.map((t, i) => (
          <TasteTile key={t.key ?? t.type} taste={t} wide={i === 0} />
        ))}
      </div>
      <Link href="/graph" className="text-btn folders-connect">
        <Icon name="spark" />
        See how they connect
      </Link>
    </section>
  );
}

/** "Ask about your saves": one question per kind, each sent to Ask straight away. */
export function AskAboutSaves() {
  const { ask } = useAskStore();
  const { data } = useSWR<{ chips: string[]; actions?: Action[] }>("/api/chips", fetcher, { revalidateOnFocus: false });
  const actions = data?.actions ?? [];
  if (actions.length === 0) return null;
  return (
    <section className="blk gutter" aria-labelledby="ask-saves-h">
      <div className="block-head">
        <h2 className="block-title" id="ask-saves-h">
          Ask about your saves
        </h2>
      </div>
      <ul className="recs">
        {actions.map((a) => {
          const kind = KINDS[a.type];
          return (
            <li key={a.type}>
              <button type="button" className="rec" style={tint(kind.color)} onClick={() => ask(a.question, true)}>
                <span className="rec-ico" aria-hidden="true">
                  <Icon name={kind.icon} />
                </span>
                <span className="rec-text">
                  <span className="rec-title">{a.title}</span>
                  <span className="rec-detail">{a.detail}</span>
                </span>
                <span className="rec-go" aria-hidden="true">
                  <Icon name="right" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="recs-note">Each one opens Ask with an answer from your saves.</p>
    </section>
  );
}
