"use client";

// My collection: everything saved, by taste. Each taste is a card with a real preview of its
// newest reels, how many there are, how many are new and done, and its subcategories. Search
// and the just-vibes "Remember this" live here too. Everything on it comes from the API.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { useApp } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { plural } from "@/lib/format";
import { KINDS, tint } from "@/lib/kinds";
import type { RememberItem, Taste, TastesResponse } from "@/lib/types";

const SUBS_SHOWN = 5;

function sentence(tag: string): string {
  return tag ? tag[0].toUpperCase() + tag.slice(1) : tag;
}

/** One taste: up to three of its newest covers, then its name, numbers and subcategories. */
function TasteCard({ taste }: { taste: Taste }) {
  const kind = KINDS[taste.type];
  const label = taste.label || kind.label;
  const thumbs = taste.thumbs.slice(0, 3);
  const more = Math.max(0, taste.count - thumbs.length);
  // Subcategories when the taste has them, else its most used tags.
  const subs = (taste.subcategories ?? []).length
    ? taste.subcategories.map((s) => ({ name: s.name, count: s.count }))
    : taste.tags.map((t) => ({ name: sentence(t.tag), count: t.count }));
  const extra = Math.max(0, subs.length - SUBS_SHOWN);
  const stats = [plural(taste.count, "save", "saves"), taste.done ? `${taste.done} done` : null].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/t/${taste.type}`}
      className="tcard"
      style={tint(kind.color)}
      aria-label={`${label}: ${stats}${taste.new > 0 ? `, ${taste.new} new` : ""}`}
    >
      <span className="tcard-media" data-n={thumbs.length} aria-hidden="true">
        {thumbs.length === 0 ? (
          <span className="tcard-ph">
            <Icon name={kind.icon} />
          </span>
        ) : (
          thumbs.map((u, i) => (
            <span key={u} className="tcard-shot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" loading="lazy" />
              {more > 0 && i === thumbs.length - 1 && <span className="tcard-more">+{more}</span>}
            </span>
          ))
        )}
      </span>
      <span className="tcard-body" aria-hidden="true">
        <span className="tcard-head">
          <span className="tcard-ico">
            <Icon name={kind.icon} />
          </span>
          <span className="tcard-name">{label}</span>
          {taste.new > 0 && <span className="tcard-new">{taste.new > 9 ? "9+" : taste.new} new</span>}
          <Icon name="right" className="tcard-go" />
        </span>
        <span className="tcard-stats">{stats}</span>
        {subs.length > 0 && (
          <span className="tcard-subs">
            {subs.slice(0, SUBS_SHOWN).map((s) => (
              <span key={s.name}>
                {s.name} <b>{s.count}</b>
              </span>
            ))}
            {extra > 0 && <span className="is-more">{extra} more</span>}
          </span>
        )}
      </span>
    </Link>
  );
}

function TasteCardPlaceholder() {
  return (
    <span className="tcard is-loading" aria-hidden="true">
      <span className="tcard-media" data-n={3}>
        <span className="tcard-shot skel" />
        <span className="tcard-shot skel" />
        <span className="tcard-shot skel" />
      </span>
      <span className="tcard-body">
        <span className="skel" style={{ height: 24, width: "45%" }} />
        <span className="skel" style={{ height: 14, width: "30%", marginTop: 8 }} />
      </span>
    </span>
  );
}

const REMEMBER_KEY = "rl_remember_hidden";

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

export default function CollectionPage() {
  const { openAdd } = useApp();
  const { data, error, mutate } = useSWR<TastesResponse>("/api/tastes", fetcher);
  const tastes = data?.tastes ?? [];
  const sub = data
    ? [
        plural(data.total, "save", "saves"),
        tastes.length > 0 ? `across ${plural(tastes.length, "taste", "tastes")}` : null,
      ]
        .filter(Boolean)
        .join(" ") + (data.done ? ` · ${data.done} done` : "")
    : null;
  const empty = data !== undefined && data.total === 0;

  return (
    <>
      <header className="page-head gutter">
        <h1 className="page-title">My collection</h1>
        {sub && !empty && <p className="page-sub">{sub}</p>}
      </header>

      {empty ? (
        <div className="gutter">
          <div className="empty">
            <h2 className="empty-title">Nothing saved yet</h2>
            <p className="empty-text">Add a reel from Instagram and it&apos;s filed here by taste.</p>
            <button type="button" className="btn btn-primary" onClick={openAdd}>
              <Icon name="plus" />
              Add a reel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="gutter">
            <Link href="/library?focus=1" className="search">
              <Icon name="search" />
              <span>Search your saves</span>
            </Link>
          </div>

          <RememberCard />

          <section className="blk gutter" aria-labelledby="tastes-h">
            <div className="block-head">
              <h2 className="block-title" id="tastes-h">
                Your tastes
                {tastes.length > 0 && <span className="pill">{tastes.length}</span>}
              </h2>
              <Link href="/library" className="see-all">
                Every save
                <Icon name="right" />
              </Link>
            </div>
            {error && !data ? (
              <div className="msg" role="alert">
                <p>Your collection didn&apos;t load. Check your connection.</p>
                <button type="button" className="btn" onClick={() => void mutate()}>
                  Try again
                </button>
              </div>
            ) : (
              <div className="tcards">
                {!data && (
                  <>
                    <span className="vh" role="status">
                      Loading your tastes
                    </span>
                    <TasteCardPlaceholder />
                    <TasteCardPlaceholder />
                  </>
                )}
                {tastes.map((t) => (
                  <TasteCard key={t.type} taste={t} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
