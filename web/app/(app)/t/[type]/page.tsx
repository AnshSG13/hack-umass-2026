"use client";

// A taste as a board: every save of one kind as a card, in two staggered columns. Each
// card is the reel's thumbnail, a short title and one quiet line of facts. The chips on
// top are the tags these saves share; tapping one narrows the board.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { Fan, useBundles } from "@/components/bundle-card";
import { Icon } from "@/components/icons";
import { useApp } from "@/components/shell";
import { ApiError, fetcher } from "@/lib/api";
import { plural } from "@/lib/format";
import { KIND_ORDER, KINDS, tint } from "@/lib/kinds";
import type { Board, BoardItem, SaveType } from "@/lib/types";

// Reel thumbnails all come in one shape. The board crops them to a few heights so the
// columns stagger; which height a card gets depends only on its id, so it never changes.
const SHAPES = [1.42, 1.08, 1.26, 1.6, 1.16];

function shapeOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SHAPES[h % SHAPES.length];
}

/** Two columns filled shortest first, so reading order still runs left to right, top down. */
function columns(items: BoardItem[]): [BoardItem[], BoardItem[]] {
  const cols: [BoardItem[], BoardItem[]] = [[], []];
  const height = [0, 0];
  for (const item of items) {
    const c = height[0] <= height[1] ? 0 : 1;
    cols[c].push(item);
    // The image, plus room for the title and the facts under it.
    height[c] += shapeOf(item.save_id) + 0.42;
  }
  return cols;
}

function sentence(tag: string): string {
  return tag ? tag[0].toUpperCase() + tag.slice(1) : tag;
}

function Pin({ item, type }: { item: BoardItem; type: SaveType }) {
  const kind = KINDS[type];
  return (
    <Link href={`/s/${item.save_id}`} className="pin">
      <span className="pin-media" style={{ aspectRatio: `1 / ${shapeOf(item.save_id)}`, ...tint(kind.color) }}>
        {item.thumb_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumb_url} alt="" loading="lazy" />
        ) : (
          <Icon name={kind.icon} />
        )}
        {item.is_new && <span className="pin-new">New</span>}
      </span>
      <span className="pin-title">{item.title}</span>
      {item.meta && <span className="pin-meta">{item.meta}</span>}
    </Link>
  );
}

export default function TasteBoardPage() {
  const params = useParams<{ type: string }>();
  const type = (KIND_ORDER as string[]).includes(params.type) ? (params.type as SaveType) : null;
  const { openAdd } = useApp();
  const { data, error, isLoading, mutate } = useSWR<Board>(type ? `/api/tastes/${type}` : null, fetcher);
  const [tag, setTag] = useState<string | null>(null);
  const bundles = useBundles(Boolean(type));
  const ready = bundles.data?.ready.find((b) => b.type === type);

  const kind = type ? KINDS[type] : null;
  const items = useMemo(() => data?.items ?? [], [data]);
  // A chip whose saves were all deleted stops filtering instead of emptying the board.
  const active = tag && data?.tags.some((t) => t.tag === tag) ? tag : null;
  const shown = useMemo(() => (active ? items.filter((i) => i.tags.includes(active)) : items), [items, active]);
  const [left, right] = useMemo(() => columns(shown), [shown]);

  const head = (
    <header className="page-head with-back gutter">
      <div className="block-head" style={{ minHeight: 44 }}>
        <Link href="/home" className="back-pill">
          <Icon name="back" />
          Home
        </Link>
        <span style={{ display: "inline-flex", gap: 8 }}>
          {type && (
            <Link href={`/library?type=${type}&focus=1`} className="add icon-only" aria-label={`Search ${kind?.label}`}>
              <Icon name="search" />
            </Link>
          )}
        </span>
      </div>
      <h1 className="page-title board-title" style={kind ? tint(kind.color) : undefined}>
        {kind && (
          <span className="board-ico" aria-hidden="true">
            <Icon name={kind.icon} />
          </span>
        )}
        {data?.label ?? kind?.label ?? "Taste"}
        {data && <span className="pill">{plural(data.count, "save", "saves")}</span>}
      </h1>
    </header>
  );

  if (!type || (error instanceof ApiError && error.status === 404)) {
    return (
      <>
        {head}
        <div className="gutter msg" role="alert">
          <p>That taste doesn&apos;t exist.</p>
          <Link href="/home" className="btn">
            Back to Home
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {head}

      {data && data.tags.length > 0 && data.count > 1 && (
        <div className="filters" role="group" aria-label="Filter this board">
          <button type="button" className="fchip" aria-pressed={active === null} onClick={() => setTag(null)}>
            All <b>{data.count}</b>
          </button>
          {data.tags.map((t) => (
            <button
              key={t.tag}
              type="button"
              className="fchip"
              style={kind ? tint(kind.color) : undefined}
              aria-pressed={active === t.tag}
              onClick={() => setTag(active === t.tag ? null : t.tag)}
            >
              {sentence(t.tag)} <b>{t.count}</b>
            </button>
          ))}
        </div>
      )}

      {ready && data && data.count > 0 && (
        <div className="gutter">
          <Link href={`/b/${ready.id}`} className="bstrip" style={kind ? tint(kind.color) : undefined}>
            <Fan urls={ready.thumbs} />
            <span className="bstrip-text">
              <span className="bstrip-title">{ready.title} is ready</span>
              <span className="bstrip-meta">
                {ready.count_label}
                {ready.first_when ? ` · first one ${ready.first_when}` : ""}
              </span>
            </span>
            <Icon name="right" />
          </Link>
        </div>
      )}

      {isLoading && !data && (
        <div className="board gutter" role="status">
          <span className="vh">Loading this board</span>
          <div className="board-col">
            <span className="skel pin-skel" style={{ aspectRatio: "1 / 1.42" }} />
            <span className="skel pin-skel" style={{ aspectRatio: "1 / 1.08" }} />
          </div>
          <div className="board-col">
            <span className="skel pin-skel" style={{ aspectRatio: "1 / 1.16" }} />
            <span className="skel pin-skel" style={{ aspectRatio: "1 / 1.6" }} />
          </div>
        </div>
      )}

      {error && !data && (
        <div className="gutter msg" role="alert">
          <p>This board didn&apos;t load. Check your connection.</p>
          <button type="button" className="btn" onClick={() => void mutate()}>
            Try again
          </button>
        </div>
      )}

      {data && data.count === 0 && (
        <div className="gutter">
          <div className="empty">
            <h2 className="empty-title">Nothing here yet</h2>
            <p className="empty-text">Save a reel and it&apos;s filed where it belongs.</p>
            <button type="button" className="btn btn-primary" onClick={openAdd}>
              <Icon name="plus" />
              Add a reel
            </button>
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <div className="board gutter" aria-live="polite">
          <div className="board-col">
            {left.map((item) => (
              <Pin key={item.save_id} item={item} type={type} />
            ))}
          </div>
          <div className="board-col">
            {right.map((item) => (
              <Pin key={item.save_id} item={item} type={type} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
