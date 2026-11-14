"use client";

// The knowledge graph's canvas. Loaded only in the browser (see app/(app)/graph/page.tsx):
// react-force-graph-2d draws on a <canvas> and needs window.
//
// Kinds are big circles, sub-categories medium ones, reels small dots. A folder from the intro
// with no reels yet has a dashed outline. Hierarchy lines are hairlines; "related"
// sub-categories are dashed in the kind's colour. Selecting a node dims everything not next to it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { KINDS } from "@/lib/kinds";
import type { GraphLink, GraphNode, KnowledgeGraph } from "@/lib/types";

type N = NodeObject<GraphNode>;
type L = LinkObject<GraphNode, GraphLink>;

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function endId(end: string | number | N | undefined): string {
  return typeof end === "object" && end ? String(end.id) : String(end ?? "");
}

function radius(n: GraphNode): number {
  if (n.kind === "type") return 9 + Math.sqrt(n.count ?? 1) * 2.2;
  if (n.kind === "sub") return 4.5 + Math.sqrt(n.count ?? 1) * 1.6;
  return 2.6;
}

export interface GraphCanvasProps {
  graph: KnowledgeGraph;
  showSaves: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  height: number;
}

export default function GraphCanvas({ graph, showSaves, selected, onSelect, height }: GraphCanvasProps) {
  const fg = useRef<ForceGraphMethods<N, L> | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const fitted = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fresh objects for the simulation (it writes x, y and velocities onto them), filtered by
  // the toggles. Rebuilt only when the data or a toggle changes, so the layout holds still
  // while someone taps around.
  const data = useMemo(() => {
    const keep = (n: GraphNode) => n.kind !== "save" || showSaves;
    const nodes: N[] = graph.nodes.filter(keep).map((n) => ({ ...n }));
    const ids = new Set(nodes.map((n) => n.id));
    const links: L[] = graph.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l }));
    return { nodes, links };
  }, [graph, showSaves]);

  // New data: zoom to fit again once the layout settles.
  useEffect(() => {
    fitted.current = false;
  }, [data]);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of graph.links) {
      if (!m.has(l.source)) m.set(l.source, new Set());
      if (!m.has(l.target)) m.set(l.target, new Set());
      m.get(l.source)!.add(l.target);
      m.get(l.target)!.add(l.source);
    }
    return m;
  }, [graph]);

  const colors = useMemo(() => {
    const out: Record<string, { fill: string; ink: string }> = {};
    for (const [t, k] of Object.entries(KINDS)) {
      out[t] = { fill: cssVar(`--${k.color}`, "#eeeeee"), ink: cssVar(`--${k.color}-ink`, "#333333") };
    }
    return {
      kinds: out,
      ink: cssVar("--ink", "#1e1f24"),
      muted: cssVar("--muted", "#6e717c"),
      line: cssVar("--line-strong", "#cfcbc2"),
      bg: cssVar("--bg", "#ffffff"),
    };
  }, []);

  const lit = useCallback(
    (id: string) => !selected || id === selected || Boolean(neighbours.get(selected)?.has(id)),
    [selected, neighbours],
  );

  // Spread the layout out a little more than the library default.
  useEffect(() => {
    const f = fg.current;
    if (!f) return;
    f.d3Force("charge")?.strength(-140);
    const link = f.d3Force("link") as unknown as { distance?: (fn: (l: L) => number) => void } | undefined;
    link?.distance?.((l: L) => (l.kind === "holds" ? 22 : l.kind === "has" ? 55 : 85));
    // Kinds with no link between them would otherwise drift apart until zoom-to-fit shrinks
    // everything; a gentle pull toward the centre keeps separate clusters close.
    let pulled: N[] = [];
    const gravity = Object.assign(
      (alpha: number) => {
        for (const n of pulled) {
          n.vx = (n.vx ?? 0) - (n.x ?? 0) * 0.06 * alpha;
          n.vy = (n.vy ?? 0) - (n.y ?? 0) * 0.06 * alpha;
        }
      },
      { initialize: (ns: N[]) => void (pulled = ns) },
    );
    f.d3Force("gravity", gravity as never);
    f.d3ReheatSimulation();
  }, [data]);

  const drawNode = useCallback(
    (node: N, ctx: CanvasRenderingContext2D, scale: number) => {
      const n = node as N & GraphNode;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const on = lit(String(n.id));
      const c = n.type ? colors.kinds[n.type] : undefined;
      ctx.globalAlpha = on ? 1 : 0.18;
      const r = radius(n);

      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = n.kind === "save" ? (c?.ink ?? colors.muted) : (c?.fill ?? colors.line);
      ctx.fill();
      if (n.kind !== "save") {
        ctx.lineWidth = (String(n.id) === selected ? 2.4 : 1.2) / scale;
        ctx.strokeStyle = c?.ink ?? colors.ink;
        if (n.kind === "sub" && !n.count) ctx.setLineDash([2 / scale, 2 / scale]); // no reels yet
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const showLabel = n.kind !== "save" || String(n.id) === selected;
      if (showLabel) {
        const size = n.kind === "type" ? Math.max(12.5 / scale, 4.4) : Math.max(10 / scale, 3.2);
        ctx.font = `${n.kind === "type" ? 700 : 600} ${size}px Figtree, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
        ctx.lineWidth = 3 / scale;
        ctx.strokeStyle = colors.bg;
        ctx.strokeText(label, x, y + r + 2 / scale);
        ctx.fillStyle = n.kind === "type" ? (c?.ink ?? colors.ink) : colors.ink;
        ctx.fillText(label, x, y + r + 2 / scale);
      }
      ctx.globalAlpha = 1;
    },
    [colors, lit, selected],
  );

  const paintArea = useCallback((node: N, color: string, ctx: CanvasRenderingContext2D) => {
    const n = node as N & GraphNode;
    ctx.fillStyle = color;
    ctx.beginPath();
    // A generous tap target, at least the size of a fingertip at normal zoom.
    ctx.arc(n.x ?? 0, n.y ?? 0, Math.max(radius(n), 7) + 3, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const linkColor = useCallback(
    (l: L) => {
      const on = lit(endId(l.source)) && lit(endId(l.target)) && (!selected || endId(l.source) === selected || endId(l.target) === selected);
      const alpha = selected && !on ? "22" : "";
      if (l.kind === "related") {
        const t = (l.source as N & GraphNode).type;
        return (t ? colors.kinds[t].ink : colors.ink) + (alpha || "cc");
      }
      return colors.line + (alpha || "");
    },
    [colors, lit, selected],
  );

  return (
    <div ref={box} className="kg-canvas" style={{ height }}>
      <ForceGraph2D<GraphNode, GraphLink>
        ref={fg}
        graphData={data}
        width={width}
        height={height}
        backgroundColor="rgba(0,0,0,0)"
        nodeId="id"
        nodeLabel={(n) => (n.kind === "save" ? n.label : "")}
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={paintArea}
        linkColor={linkColor}
        linkWidth={(l) => (l.kind === "related" ? 1.6 : 0.8)}
        linkLineDash={(l) => (l.kind === "related" ? [4, 3] : null)}
        cooldownTicks={140}
        onEngineStop={() => {
          if (!fitted.current) {
            fitted.current = true;
            fg.current?.zoomToFit(400, 24);
          }
        }}
        onNodeClick={(n) => onSelect(String(n.id) === selected ? null : String(n.id))}
        onBackgroundClick={() => onSelect(null)}
        enableNodeDrag={false}
      />
    </div>
  );
}
