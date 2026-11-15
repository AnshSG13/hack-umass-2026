"use client";

// My collection: everything saved, by taste. Each taste is a tile with prints of its newest
// reels, how many there are (new and done), and for the largest its subcategories. Search
// and the just-vibes "Remember this" live here too. Everything on it comes from the API.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { useApp } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { plural } from "@/lib/format";
import { boardHref, KINDS, tint } from "@/lib/kinds";
import type { RememberItem, Taste, TastesResponse } from "@/lib/types";

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

/** The largest taste is wide (its prints fanned beside the name, then its subcategories);
 *  the rest sit two by two (the icon, its prints underneath, then the name). */
function TasteTile({ taste, wide }: { taste: Taste; wide: boolean }) {
  const kind = KINDS[taste.type];
  const label = taste.label || kind.label;
  const count = [plural(taste.count, "save", "saves"), taste.done ? `${taste.done} done` : null].filter(Boolean).join(" · ");
  const href = boardHref(taste.type, taste.category);
  // New reels since the last look: a bright pill on the corner, and the tile itself glows.
  const fresh = taste.new > 0 ? (
    <span className="taste-new" aria-label={`${taste.new} new ${taste.new === 1 ? "reel" : "reels"}`}>
      <span className="taste-new-dot" aria-hidden="true" />
      {taste.new > 9 ? "9+" : taste.new} new
    </span>
  ) : null;
  const tileClass = taste.new > 0 ? " has-new" : "";

  if (wide) {
    return (
      <Link href={href} className={`taste taste-wide${tileClass}`} style={tint(kind.color)}>
        {fresh}
        <span className="taste-row">
          <span className="taste-text">
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
    <Link href={href} className={`taste${tileClass}`} style={tint(kind.color)}>
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
  const asked = /[?!.]$/.test(item.line) ? item.line : `${item.line}?`;
  return (
    <div className="gutter">
      {/* A memory, not a notice: the reel as a print with tape on it, and when it was. */}
      <div className="remember" style={tint("butter")}>
        <Link href={`/s/${item.save_id}`} className="remember-main">
          <span className="remember-print" aria-hidden="true">
            <span className="remember-tape" />
            {item.thumb_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumb_url} alt="" />
            ) : (
              <span className="remember-blank">
                <Icon name="spark" />
              </span>
            )}
          </span>
          <span className="remember-text">
            <span className="remember-when">
              <Icon name="clock" />
              {item.ago ? `From ${item.ago}` : "From a while back"}
            </span>
            <span className="remember-line">{asked}</span>
            {/* A line that doesn't name the reel gets the reel's own name under it. */}
            {/^remember this one/i.test(item.line) && <span className="remember-title">{item.title}</span>}
            <span className="remember-meta">
              You saved it {item.weekday ? `on a ${item.weekday}, ` : ""}
              {item.saved_on}
            </span>
            <span className="remember-go">
              Look again
              <Icon name="right" />
            </span>
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
  // What is new since the last look, across tastes: said once at the top of the page.
  const newTastes = tastes.filter((t) => t.new > 0);
  const newTotal = newTastes.reduce((n, t) => n + t.new, 0);

  return (
    <>
      <header className="page-head gutter">
        <h1 className="page-title">My collection</h1>
        {sub && !empty && <p className="page-sub">{sub}</p>}
        {newTotal > 0 && (
          <p className="collection-new" role="status">
            <span className="collection-new-dot" aria-hidden="true" />
            <span>
              <b>{plural(newTotal, "new reel", "new reels")}</b> since you last looked
              {" "}
              <span className="collection-new-where">
                in {newTastes.map((t) => t.label || KINDS[t.type].label).join(", ")}
              </span>
            </span>
          </p>
        )}
        {!empty && (
          <Link href="/graph" className="text-btn collection-map">
            <Icon name="spark" />
            See how they connect
          </Link>
        )}
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
                Your saves
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
              <div className="tastes">
                {!data && (
                  <>
                    <span className="vh" role="status">
                      Loading your tastes
                    </span>
                    <span className="skel taste-wide" style={{ height: 196, borderRadius: 24, marginTop: 0 }} />
                    <span className="skel" style={{ height: 196, borderRadius: 24, marginTop: 0 }} />
                    <span className="skel" style={{ height: 196, borderRadius: 24, marginTop: 0 }} />
                  </>
                )}
                {tastes.map((t, i) => (
                  <TasteTile key={t.key ?? t.type} taste={t} wide={i === 0} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
