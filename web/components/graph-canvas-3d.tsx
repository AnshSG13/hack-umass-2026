"use client";

// The knowledge graph in 3D: drag with one finger to turn it, pinch to zoom, tap a node to
// see what it touches. Loaded only in the browser (see app/(app)/graph/page.tsx).
//
// Same picture as the flat map: kinds are big pastel spheres, sub-categories medium ones,
// reels small dots in their kind's ink, interests butter-coloured. Labels float under the
// spheres. "Related" sub-categories are joined by a coloured line with a few particles
// drifting along it. After the layout settles the graph turns slowly by itself, so it
// reads as 3D; the first touch stops that. Without WebGL the flat map is shown instead.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ForceGraph3D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-3d";
import * as THREE from "three";
import { KINDS } from "@/lib/kinds";
import type { GraphLink, GraphNode } from "@/lib/types";
import type { GraphCanvasProps } from "@/components/graph-canvas";

const GraphCanvas2D = dynamic(() => import("@/components/graph-canvas"), { ssr: false });

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
  if (n.kind === "type") return 7 + Math.sqrt(n.count ?? 1) * 1.8;
  if (n.kind === "sub") return 3.6 + Math.sqrt(n.count ?? 1) * 1.2;
  if (n.kind === "interest") return 3.2;
  return 1.8;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** A text label as a sprite: always faces the camera, crisp at phone pixel density. */
function labelSprite(text: string, color: string, weight: number, height: number): THREE.Sprite {
  const px = 56;
  const pad = 18;
  const font = `${weight} ${px}px Figtree, system-ui, sans-serif`;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  canvas.width = w;
  canvas.height = px + pad;
  ctx.font = font;
  ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, canvas.height, canvas.height / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, canvas.height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set((height * w) / canvas.height, height, 1);
  return sprite;
}

export default function GraphCanvas3D(props: GraphCanvasProps) {
  const [webgl] = useState(() => (typeof window === "undefined" ? true : hasWebGL()));
  if (!webgl) return <GraphCanvas2D {...props} />;
  return <Graph3D {...props} />;
}

function Graph3D({ graph, showSaves, showInterests, selected, onSelect, height }: GraphCanvasProps) {
  const fg = useRef<ForceGraphMethods<N, L> | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const fitted = useRef(false);
  const touched = useRef(false);
  const still = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    const keep = (n: GraphNode) => (n.kind !== "save" || showSaves) && (n.kind !== "interest" || showInterests);
    const nodes: N[] = graph.nodes.filter(keep).map((n) => ({ ...n }));
    const ids = new Set(nodes.map((n) => n.id));
    const links: L[] = graph.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l }));
    return { nodes, links };
  }, [graph, showSaves, showInterests]);

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
      butter: cssVar("--butter", "#fff3c4"),
      butterInk: cssVar("--butter-ink", "#735700"),
    };
  }, []);

  const lit = useCallback(
    (id: string) => !selected || id === selected || Boolean(neighbours.get(selected)?.has(id)),
    [selected, neighbours],
  );

  // The same spacing as the flat map, plus a little depth.
  useEffect(() => {
    const f = fg.current;
    if (!f) return;
    // Weaker push than the flat map: in 3D the separate tastes otherwise drift far apart and
    // everything ends up tiny once the camera fits them all in.
    f.d3Force("charge")?.strength(-38);
    const link = f.d3Force("link") as unknown as { distance?: (fn: (l: L) => number) => void } | undefined;
    link?.distance?.((l: L) => (l.kind === "holds" ? 12 : l.kind === "has" ? 26 : l.kind === "likes" ? 46 : 40));
    f.d3ReheatSimulation();
  }, [data]);

  // Turn slowly once it has settled; the first touch (or reduced motion) stops it.
  useEffect(() => {
    const f = fg.current;
    if (!f) return;
    const controls = f.controls() as unknown as {
      autoRotate?: boolean;
      autoRotateSpeed?: number;
      enableDamping?: boolean;
      dampingFactor?: number;
      addEventListener?: (type: string, fn: () => void) => void;
      removeEventListener?: (type: string, fn: () => void) => void;
    };
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    const stop = () => {
      touched.current = true;
      controls.autoRotate = false;
    };
    controls.addEventListener?.("start", stop);
    return () => controls.removeEventListener?.("start", stop);
  }, []);

  const nodeObject = useCallback(
    (node: N) => {
      const n = node as N & GraphNode;
      const on = lit(String(n.id));
      const c = n.type ? colors.kinds[n.type] : undefined;
      const r = radius(n);
      const group = new THREE.Group();
      const color =
        n.kind === "interest" ? colors.butter : n.kind === "save" ? (c?.ink ?? colors.muted) : (c?.fill ?? colors.line);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.45,
        metalness: 0.05,
        emissive: new THREE.Color(color),
        emissiveIntensity: n.kind === "save" ? 0.05 : 0.22,
        transparent: !on,
        opacity: on ? 1 : 0.14,
      });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), mat);
      group.add(sphere);
      if (n.kind !== "save" && n.kind !== "interest") {
        // A thin ring in the kind's ink, like the outline on the flat map.
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(r * 1.02, Math.max(0.25, r * 0.06), 8, 48),
          new THREE.MeshBasicMaterial({ color: c?.ink ?? colors.ink, transparent: true, opacity: on ? 0.55 : 0.08 }),
        );
        group.add(ring);
      }
      // A tapped reel shows its card over the canvas (the page), so reels get no floating label.
      if (n.kind !== "save" && on) {
        const text = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
        const ink = n.kind === "interest" ? colors.butterInk : n.kind === "type" ? (c?.ink ?? colors.ink) : colors.ink;
        const h = n.kind === "type" ? 9 : 6.5;
        const sprite = labelSprite(text, ink, n.kind === "type" ? 700 : 600, h);
        sprite.position.set(0, -(r + h * 0.85), 0);
        group.add(sprite);
      }
      return group;
    },
    [colors, lit],
  );

  const linkColor = useCallback(
    (l: L) => {
      const on = !selected || endId(l.source) === selected || endId(l.target) === selected;
      if (!on) return "rgba(160,160,170,0.08)";
      if (l.kind === "related") {
        const t = (l.source as N & GraphNode).type;
        return t ? colors.kinds[t].ink : colors.ink;
      }
      if (l.kind === "likes") return colors.butterInk;
      return colors.line;
    },
    [colors, selected],
  );

  return (
    <div ref={box} className="kg-canvas kg-3d" style={{ height }}>
      <ForceGraph3D<GraphNode, GraphLink>
        ref={fg}
        graphData={data}
        width={width}
        height={height}
        backgroundColor="rgba(0,0,0,0)"
        showNavInfo={false}
        controlType="orbit"
        numDimensions={3}
        nodeId="id"
        nodeLabel={(n) => (n.kind === "save" ? n.label : "")}
        nodeThreeObject={nodeObject}
        linkColor={linkColor}
        linkOpacity={0.55}
        linkWidth={(l) => (l.kind === "related" ? 0.6 : 0)}
        linkDirectionalParticles={(l) => (l.kind === "related" && !still ? 2 : 0)}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleWidth={1.4}
        linkDirectionalParticleColor={linkColor}
        cooldownTicks={140}
        onEngineStop={() => {
          if (fitted.current) return;
          fitted.current = true;
          fg.current?.zoomToFit(600, 12);
          if (!still && !touched.current) {
            const controls = fg.current?.controls() as unknown as { autoRotate?: boolean; autoRotateSpeed?: number };
            if (controls) {
              controls.autoRotate = true;
              controls.autoRotateSpeed = 0.9;
            }
          }
        }}
        onNodeClick={(n) => onSelect(String(n.id))}
        onBackgroundClick={() => onSelect(null)}
        enableNodeDrag={false}
      />
    </div>
  );
}
