"use client";

// "How your saves connect": the knowledge graph. Kinds, their sub-categories (including the
// interests and hobbies from the intro, which are folders too) and reels, with "related"
// links between sub-categories whose reels are alike. Under the canvas, the same connections as text, and details for whatever is tapped.

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { useApp } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { plural } from "@/lib/format";
import { useMediaQuery } from "@/lib/hooks";
import { KINDS, tint } from "@/lib/kinds";
import type { GraphNode, KnowledgeGraph } from "@/lib/types";

const GraphCanvas = dynamic(() => import("@/components/graph-canvas"), {
  ssr: false,
  loading: () => <div className="kg-canvas kg-loading" aria-hidden="true" />,
});

const SAVES_ON_BY_DEFAULT = 60; // past this many reels the dots crowd the picture

export default function GraphPage() {
  const { openAdd } = useApp();
  const { data, error, mutate } = useSWR<KnowledgeGraph>("/api/graph", fetcher, { revalidateOnFocus: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [savesChoice, setSavesChoice] = useState<boolean | null>(null);
  const wide = useMediaQuery("(min-width: 700px)");

  const showSaves = savesChoice ?? (data ? data.counts.saves <= SAVES_ON_BY_DEFAULT : true);
  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);

  const related = useMemo(
    () => (data?.links ?? []).filter((l) => l.kind === "related").sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)),
    [data],
  );
  const head = (
    <header className="page-head with-back">
      <div className="block-head" style={{ minHeight: 44 }}>
        <Link href="/home" className="back-pill">
          <Icon name="back" />
          Home
        </Link>
      </div>
      <h1 className="page-title" style={{ marginTop: 10 }}>
        How your saves connect
      </h1>
      {data && data.counts.saves > 0 && (
        <p className="page-sub">
          {plural(data.counts.saves, "save", "saves")} in {plural(data.counts.subcategories, "folder", "folders")},{" "}
          {plural(data.counts.related, "link", "links")} between folders
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
    return n.kind === "sub" && n.type ? `${KINDS[n.type].label} › ${n.label}` : n.label;
  }

  function details(node: GraphNode) {
    const reels = neighbourIds(node.id, "holds")
      .map((id) => byId.get(id))
      .filter((n): n is GraphNode => Boolean(n && n.kind === "save"));
    // A kind lists its folders; a folder or a reel names the one thing it sits in.
    const subs = node.kind === "type" ? neighbourIds(node.id, "has") : [];
    const rel = neighbourIds(node.id, "related");
    const parent =
      node.kind === "sub" ? neighbourIds(node.id, "has")[0] : node.kind === "save" ? neighbourIds(node.id, "holds")[0] : undefined;
    return (
      <section className="kg-detail" aria-live="polite" style={node.type ? tint(KINDS[node.type].color) : undefined}>
        <p className="kg-detail-kind">
          {node.kind === "type" ? "Kind" : node.kind === "sub" ? (node.from_intro ? "Folder from your intro" : "Folder") : "Reel"}
        </p>
        <h2 className="kg-detail-title">{node.kind === "save" ? node.label : name(node.id)}</h2>
        {node.count !== undefined && (
          <p className="kg-detail-sub">
            {node.count === 0 ? "No reels yet. Saves that fit land here." : plural(node.count, "save", "saves")}
          </p>
        )}
        {parent && <p className="kg-detail-sub">In {name(parent)}</p>}
        {subs.length > 0 && (
          <div className="kg-detail-row">
            <h3>Folders</h3>
            <div className="kg-chips">
              {subs.map((id) => (
                <button key={id} type="button" className="fchip" onClick={() => setSelected(id)}>
                  {byId.get(id)?.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {rel.length > 0 && (
          <div className="kg-detail-row">
            <h3>Related folders</h3>
            <div className="kg-chips">
              {rel.map((id) => (
                <button key={id} type="button" className="fchip" onClick={() => setSelected(id)}>
                  {name(id)}
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
      </div>

      <div className="gutter">
        {data ? (
          <GraphCanvas
            graph={data}
            showSaves={showSaves}
            selected={selected}
            onSelect={setSelected}
            height={wide ? 560 : 500}
          />
        ) : (
          <div className="kg-canvas kg-loading" aria-hidden="true" />
        )}
        <p className="kg-legend" aria-hidden="true">
          <span className="kg-key kg-key-related" /> folders with alike reels
        </p>

        {sel ? (
          details(sel)
        ) : (
          data && <p className="kg-hint">Tap a circle to see what&apos;s in it and what it connects to.</p>
        )}

        {data && related.length > 0 && (
          <section className="kg-list" aria-labelledby="kg-links-h">
            <h2 className="block-title" id="kg-links-h">
              Connections
            </h2>
            <ul>
              {related.map((l) => (
                <li key={`${l.source}~${l.target}`}>
                  <button type="button" onClick={() => pickFromList(l.source)}>
                    {name(l.source)}
                  </button>
                  <span className="kg-rel">is like</span>
                  <button type="button" onClick={() => pickFromList(l.target)}>
                    {name(l.target)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
