"use client";

// "How your saves connect": the knowledge graph. Kinds, their sub-categories, reels and the
// interests from the intro, with "related" links between sub-categories whose reels are
// alike. Under the canvas, the same connections as text, and details for whatever is tapped.
// Tapping a reel shows its picture and title in a card over the canvas; tapping it again
// hides the card, and a double tap opens the reel's page.

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { useApp } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { plural } from "@/lib/format";
import { useMediaQuery } from "@/lib/hooks";
import { KINDS, tint, type KindColor } from "@/lib/kinds";
import type { GraphNode, KnowledgeGraph } from "@/lib/types";

const GraphCanvas = dynamic(() => import("@/components/graph-canvas-3d"), {
  ssr: false,
  loading: () => <div className="kg-canvas kg-loading" aria-hidden="true" />,
});

const SAVES_ON_BY_DEFAULT = 60; // past this many reels the dots crowd the picture
const DOUBLE_TAP_MS = 400;

export default function GraphPage() {
  const { openAdd } = useApp();
  const router = useRouter();
  const { data, error, mutate } = useSWR<KnowledgeGraph>("/api/graph", fetcher, { revalidateOnFocus: false });
  const [selected, setSelected] = useState<string | null>(null);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const [savesChoice, setSavesChoice] = useState<boolean | null>(null);
  const [showInterests, setShowInterests] = useState(true);
  const wide = useMediaQuery("(min-width: 700px)");

  const showSaves = savesChoice ?? (data ? data.counts.saves <= SAVES_ON_BY_DEFAULT : true);
  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);

  const related = useMemo(
    () => (data?.links ?? []).filter((l) => l.kind === "related").sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)),
    [data],
  );
  const likes = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of data?.links ?? []) {
      if (l.kind !== "likes") continue;
      m.set(l.source, [...(m.get(l.source) ?? []), l.target]);
    }
    return m;
  }, [data]);

  const head = (
    <header className="page-head with-back">
      <div className="block-head" style={{ minHeight: 44 }}>
        <Link href="/collection" className="back-pill">
          <Icon name="back" />
          My collection
        </Link>
      </div>
      <h1 className="page-title" style={{ marginTop: 10 }}>
        How your saves connect
      </h1>
      {data && data.counts.saves > 0 && (
        <p className="page-sub">
          {plural(data.counts.saves, "save", "saves")} in {plural(data.counts.subcategories, "sub-category", "sub-categories")},{" "}
          {plural(data.counts.related, "link", "links")} between them
        </p>
      )}
    </header>
  );

  if (error && !data) {
    return (
      <div className="gutter">
        {head}
        <div role="alert" className="msg">
          <p>The map didn&apos;t load. Check your connection.</p>
          <button type="button" className="btn" onClick={() => void mutate()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (data && data.counts.saves === 0) {
    return (
      <div className="gutter">
        {head}
        <div className="empty">
          <h2 className="empty-title">Nothing to connect yet</h2>
          <p className="empty-text">Save a few reels and they show up here, grouped and linked by what they have in common.</p>
          <button type="button" className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" />
            Add a reel
          </button>
        </div>
      </div>
    );
  }

  const sel = selected ? byId.get(selected) : undefined;

  // One tap selects a node and a second tap on it lets go. For a reel, selecting shows its
  // card over the canvas, and two taps close together open the reel's page.
  function onNodeTap(id: string | null) {
    const node = id ? byId.get(id) : undefined;
    const now = Date.now();
    const prev = lastTap.current;
    lastTap.current = id ? { id, at: now } : null;
    if (node?.kind === "save" && node.save_id && prev?.id === id && now - prev.at < DOUBLE_TAP_MS) {
      router.push(`/s/${node.save_id}`);
      return;
    }
    setSelected((cur) => (id !== null && cur === id ? null : id));
  }

  function reelCard(node: GraphNode) {
    const kind = node.type ? KINDS[node.type] : undefined;
    const folder = neighbourIds(node.id, "holds")[0];
    return (
      <div className="kg-peek" style={kind ? tint(kind.color) : undefined}>
        <Link href={`/s/${node.save_id}`} className="kg-peek-link">
          {node.thumb_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from /api/t (SPEC 13.1)
            <img src={node.thumb_url} alt="" width={48} height={64} />
          ) : (
            <span className="kg-peek-noimg" aria-hidden="true" />
          )}
          <span className="kg-peek-text">
            <span className="kg-peek-kind">
              {node.category ?? kind?.label}
              {folder ? ` · ${byId.get(folder)?.label ?? ""}` : ""}
            </span>
            <span className="kg-peek-title">{node.label}</span>
            <span className="kg-peek-hint">Double tap the dot to open</span>
          </span>
          <Icon name="right" />
        </Link>
      </div>
    );
  }
  const neighbourIds = (id: string, kind?: string) =>
    (data?.links ?? [])
      .filter((l) => (l.source === id || l.target === id) && (!kind || l.kind === kind))
      .map((l) => (l.source === id ? l.target : l.source));

  // From the text list, far below the canvas: select, then bring the canvas back into view.
  function pickFromList(id: string) {
    setSelected(id);
    document.querySelector(".kg-canvas")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function name(id: string): string {
    const n = byId.get(id);
    if (!n) return id;
    return n.kind === "sub" && n.type ? `${n.category ?? KINDS[n.type].label} › ${n.label}` : n.label;
  }

  function details(node: GraphNode) {
    const reels = neighbourIds(node.id, "holds")
      .map((id) => byId.get(id))
      .filter((n): n is GraphNode => Boolean(n && n.kind === "save"));
    // A kind lists its folders and an interest its closest folders; a folder or a reel names
    // the one thing it sits in.
    const subs =
      node.kind === "type" ? neighbourIds(node.id, "has") : node.kind === "interest" ? neighbourIds(node.id, "likes") : [];
    const rel = neighbourIds(node.id, "related");
    const fans = node.kind === "sub" ? neighbourIds(node.id, "likes") : [];
    const parent =
      node.kind === "sub" ? neighbourIds(node.id, "has")[0] : node.kind === "save" ? neighbourIds(node.id, "holds")[0] : undefined;
    return (
      <section className="kg-detail" aria-live="polite" style={node.type ? tint(KINDS[node.type].color) : undefined}>
        <p className="kg-detail-kind">
          {node.kind === "type" ? "Category" : node.kind === "sub" ? "Sub-category" : node.kind === "interest" ? "Your interest" : "Reel"}
        </p>
        <h2 className="kg-detail-title">{node.kind === "save" ? node.label : name(node.id)}</h2>
        {node.count !== undefined && <p className="kg-detail-sub">{plural(node.count, "save", "saves")}</p>}
        {parent && <p className="kg-detail-sub">In {name(parent)}</p>}
        {subs.length > 0 && (
          <div className="kg-detail-row">
            <h3>{node.kind === "interest" ? "Closest sub-categories" : "Sub-categories"}</h3>
            <div className="kg-chips">
              {subs.map((id) => (
                <button key={id} type="button" className="fchip" onClick={() => setSelected(id)}>
                  {node.kind === "interest" ? name(id) : byId.get(id)?.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {rel.length > 0 && (
          <div className="kg-detail-row">
            <h3>Sub-categories with similar reels</h3>
            <div className="kg-chips">
              {rel.map((id) => (
                <button key={id} type="button" className="fchip" onClick={() => setSelected(id)}>
                  {name(id)}
                </button>
              ))}
            </div>
          </div>
        )}
        {fans.length > 0 && (
          <div className="kg-detail-row">
            <h3>Matches your interests</h3>
            <div className="kg-chips">
              {fans.map((id) => (
                <button key={id} type="button" className="fchip" onClick={() => setSelected(id)}>
                  {byId.get(id)?.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {reels.length > 0 && (
          <div className="kg-detail-row">
            <h3>Reels</h3>
            <ul className="kg-reels">
              {reels.slice(0, 12).map((r) => (
                <li key={r.id}>
                  <Link href={`/s/${r.save_id}`}>
                    {r.thumb_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from /api/t (SPEC 13.1)
                      <img src={r.thumb_url} alt="" width={36} height={48} />
                    ) : (
                      <span className="kg-noimg" />
                    )}
                    <span>{r.label}</span>
                    <Icon name="right" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {node.kind === "save" && node.save_id && (
          <Link href={`/s/${node.save_id}`} className="btn btn-block" style={{ marginTop: 14 }}>
            Open reel
          </Link>
        )}
      </section>
    );
  }

  return (
    <>
      <div className="gutter">{head}</div>

      <div className="filters" role="group" aria-label="What to show">
        <button type="button" className="fchip" aria-pressed={showSaves} onClick={() => setSavesChoice(!showSaves)}>
          Reels
        </button>
        <button
          type="button"
          className="fchip"
          aria-pressed={showInterests}
          onClick={() => setShowInterests(!showInterests)}
          disabled={!data || data.counts.interests === 0}
        >
          Your interests
        </button>
      </div>

      <div className="gutter">
        <div className="kg-stage">
          {data ? (
            <GraphCanvas
              graph={data}
              showSaves={showSaves}
              showInterests={showInterests}
              selected={selected}
              onSelect={onNodeTap}
              height={wide ? 560 : 500}
            />
          ) : (
            <div className="kg-canvas kg-loading" aria-hidden="true" />
          )}
          <div aria-live="polite">{sel?.kind === "save" && sel.save_id ? reelCard(sel) : null}</div>
        </div>
        <GraphKey
          reels={showSaves}
          interests={showInterests && Boolean(data?.counts.interests)}
          colours={(data?.nodes ?? [])
            .filter((n) => n.kind === "type" && n.type)
            .map((n) => ({ label: n.label, color: KINDS[n.type!].color }))}
        />

        {sel && sel.kind !== "save" ? (
          details(sel)
        ) : (
          data && (
            <p className="kg-hint">
              Drag to turn it, pinch to zoom. Tap a circle to see what it holds, or a reel to see its picture and title.
            </p>
          )
        )}

        {data && (related.length > 0 || likes.size > 0) && (
          <section className="kg-list" aria-labelledby="kg-links-h">
            <h2 className="block-title" id="kg-links-h">
              Sub-categories with similar reels
            </h2>
            <ul>
              {related.map((l) => (
                <li key={`${l.source}~${l.target}`}>
                  <button type="button" onClick={() => pickFromList(l.source)}>
                    {name(l.source)}
                  </button>
                  <span className="kg-rel">has reels like</span>
                  <button type="button" onClick={() => pickFromList(l.target)}>
                    {name(l.target)}
                  </button>
                </li>
              ))}
              {[...likes.entries()].map(([interest, subs]) => (
                <li key={interest}>
                  <button type="button" onClick={() => pickFromList(interest)}>
                    {byId.get(interest)?.label}
                  </button>
                  <span className="kg-rel">fits</span>
                  {subs.map((s, i) => (
                    <span key={s}>
                      <button type="button" onClick={() => pickFromList(s)}>
                        {name(s)}
                      </button>
                      {i < subs.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

/** What each shape and line on the map means, drawn the way the map draws it. */
function GraphKey({
  reels,
  interests,
  colours,
}: {
  reels: boolean;
  interests: boolean;
  /** One per category on the map, in its colour ("Comedy" on yellow). */
  colours: { label: string; color: KindColor }[];
}) {
  const disc = (r: number, fill: string, ring: string) => (
    <svg viewBox="0 0 28 16" width="28" height="16" aria-hidden="true">
      <circle cx="14" cy="8" r={r} fill={`var(${fill})`} stroke={`var(${ring})`} strokeOpacity="0.45" strokeWidth="1.2" />
    </svg>
  );
  // The shapes are drawn in grey: colour says which category, shape says what it is.
  const ring = (
    <svg viewBox="0 0 28 16" width="28" height="16" aria-hidden="true">
      <circle cx="14" cy="8" r="6.4" fill="#fff" />
      <circle cx="14" cy="8" r="4.9" fill="none" stroke="var(--line-strong)" strokeWidth="2.6" />
      <circle cx="14" cy="8" r="6.6" fill="none" stroke="var(--muted)" strokeOpacity="0.55" strokeWidth="0.8" />
    </svg>
  );
  const line = (color: string, dot: boolean) => (
    <svg viewBox="0 0 28 16" width="28" height="16" aria-hidden="true">
      <line x1="2" y1="8" x2="26" y2="8" stroke={`var(${color})`} strokeWidth="1.4" strokeLinecap="round" />
      {dot && <circle cx="17" cy="8" r="2.2" fill={`var(${color})`} />}
    </svg>
  );
  return (
    <>
    <ul className="kg-key-list" aria-label="Key">
      <li>
        {disc(7, "--line-strong", "--muted")}
        Category
      </li>
      <li>
        {ring}
        Sub-category
      </li>
      {reels && (
        <li>
          <svg viewBox="0 0 28 16" width="28" height="16" aria-hidden="true">
            <circle cx="14" cy="8" r="6" fill="var(--line-strong)" stroke="#fff" strokeWidth="2" />
            <circle cx="14" cy="8" r="7" fill="none" stroke="var(--muted)" strokeWidth="1" />
          </svg>
          Reel
        </li>
      )}
      <li>
        {line("--line-strong", false)}
        What&apos;s inside
      </li>
      <li>
        {line("--sky-ink", true)}
        Similar reels
      </li>
      {interests && (
        <li>
          {disc(4, "--butter", "--butter-ink")}
          Your interest
        </li>
      )}
    </ul>
    {colours.length > 0 && (
      <ul className="kg-colours" aria-label="Colours">
        {colours.map((c) => (
          <li key={c.label} style={tint(c.color)}>
            <span className="kg-colour-dot" aria-hidden="true" />
            {c.label}
          </li>
        ))}
      </ul>
    )}
    </>
  );
}
