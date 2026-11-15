"use client";

// The knowledge graph in 3D: drag with one finger to turn it, pinch to zoom, tap a node to
// see what it touches. Loaded only in the browser (see app/(app)/graph/page.tsx).
//
// Flat and light, like the rest of the app (DESIGN.md: no gradients, no shadows). Every
// node is a sprite, so it always faces the camera and stays crisp: kinds and folders are
// flat discs in their kind's pastel with a thin ink ring and a name chip under them, reels
// are round thumbnails of the reel, interests are butter discs. Lines are hairlines;
// "related" folders get a hairline in a softened kind ink with a few particles drifting
// along it. A gentle pull toward the centre keeps separate tastes from drifting apart, so the
// whole picture fills the frame. After the layout settles the graph turns slowly by itself
// so it reads as 3D; the first touch stops that. Without WebGL the flat map is shown.

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

const FADED = 0.14; // what isn't touching the selected node
const PULL = 0.09; // strength of the pull toward the centre

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** A colour mixed toward white, for lines that should stay quiet. */
function soften(color: string, amount: number): string {
  return `#${new THREE.Color(color).lerp(new THREE.Color("#ffffff"), amount).getHexString()}`;
}

function endId(end: string | number | N | undefined): string {
  return typeof end === "object" && end ? String(end.id) : String(end ?? "");
}

/** Diameter in scene units. */
function size(n: GraphNode): number {
  if (n.kind === "type") return 15 + Math.sqrt(n.count ?? 1) * 2.4;
  if (n.kind === "sub") return 8 + Math.sqrt(n.count ?? 1) * 1.4;
  if (n.kind === "interest") return 7;
  return 10;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function spriteFrom(tex: THREE.Texture, diameter: number, opacity: number): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false }),
  );
  sprite.scale.set(diameter, diameter, 1);
  return sprite;
}

/** A flat disc: the kind's pastel with a thin ring in its ink. */
function discTexture(fill: string, ring: string): THREE.CanvasTexture {
  const px = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, px / 2 - 8, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = ring;
  ctx.globalAlpha = 0.45;
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A reel as a round thumbnail with a white edge and a thin ring in its kind's ink. Until the
 * picture arrives (or if there is none) it is a flat dot in the kind's pastel.
 */
function thumbTexture(url: string | null | undefined, fill: string, ring: string): THREE.CanvasTexture {
  const px = 192;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  const r = px / 2 - 6;
  const edge = () => {
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, r, 0, Math.PI * 2);
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, r + 3, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = ring;
    ctx.stroke();
  };
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  edge();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (url) {
    const img = new Image();
    img.onload = () => {
      // Cover the circle with the middle of the picture.
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.save();
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, px, px);
      ctx.restore();
      edge();
      tex.needsUpdate = true;
    };
    img.src = url;
  }
  return tex;
}

/** A name chip: white pill with a hairline border, always facing the camera. */
function labelTexture(text: string, color: string, border: string, weight: number): { tex: THREE.CanvasTexture; aspect: number } {
  const px = 60;
  const padX = 26;
  const padY = 16;
  const font = `${weight} ${px}px Figtree, system-ui, sans-serif`;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = px + padY * 2;
  canvas.width = w + 6;
  canvas.height = h + 6;
  ctx.font = font;
  ctx.beginPath();
  ctx.roundRect(3, 3, w, h, h / 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 3 + padX, 3 + h / 2 + 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: canvas.width / canvas.height };
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
  // Textures are drawn once per node look and reused, so a tap (which rebuilds the nodes to
  // fade the rest) doesn't reload every thumbnail.
  const textures = useRef(new Map<string, THREE.CanvasTexture>());
  const labels = useRef(new Map<string, { tex: THREE.CanvasTexture; aspect: number }>());
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

  // Free the GPU copies when the graph goes away.
  useEffect(() => {
    const tex = textures.current;
    const lab = labels.current;
    return () => {
      tex.forEach((t) => t.dispose());
      lab.forEach((l) => l.tex.dispose());
      tex.clear();
      lab.clear();
    };
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
      line: cssVar("--line", "#ece9e3"),
      lineStrong: cssVar("--line-strong", "#cfcbc2"),
      butter: cssVar("--butter", "#fff3c4"),
      butterInk: cssVar("--butter-ink", "#735700"),
    };
  }, []);

  const lit = useCallback(
    (id: string) => !selected || id === selected || Boolean(neighbours.get(selected)?.has(id)),
    [selected, neighbours],
  );

  const texture = useCallback((key: string, make: () => THREE.CanvasTexture) => {
    let t = textures.current.get(key);
    if (!t) {
      t = make();
      textures.current.set(key, t);
    }
    return t;
  }, []);

  const label = useCallback((key: string, make: () => { tex: THREE.CanvasTexture; aspect: number }) => {
    let l = labels.current.get(key);
    if (!l) {
      l = make();
      labels.current.set(key, l);
    }
    return l;
  }, []);

  // Spacing, plus a gentle pull toward the centre so separate tastes stay in one picture.
  useEffect(() => {
    const f = fg.current;
    if (!f) return;
    f.d3Force("charge")?.strength(-42);
    const link = f.d3Force("link") as unknown as { distance?: (fn: (l: L) => number) => void } | undefined;
    link?.distance?.((l: L) => (l.kind === "holds" ? 14 : l.kind === "has" ? 26 : l.kind === "likes" ? 34 : 36));
    let nodes: N[] = [];
    const pull = Object.assign(
      (alpha: number) => {
        for (const n of nodes) {
          n.vx = (n.vx ?? 0) - (n.x ?? 0) * PULL * alpha;
          n.vy = (n.vy ?? 0) - (n.y ?? 0) * PULL * alpha;
          n.vz = (n.vz ?? 0) - (n.z ?? 0) * PULL * alpha;
        }
      },
      { initialize: (ns: N[]) => (nodes = ns) },
    );
    (f.d3Force as unknown as (name: string, force: unknown) => void)("pull", pull);
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
      const id = String(n.id);
      const on = lit(id);
      const opacity = on ? 1 : FADED;
      const c = n.type ? colors.kinds[n.type] : undefined;
      const fill = n.kind === "interest" ? colors.butter : (c?.fill ?? colors.line);
      const ink = n.kind === "interest" ? colors.butterInk : (c?.ink ?? colors.ink);
      const d = size(n) * (n.kind === "save" && id === selected ? 1.35 : 1);
      const group = new THREE.Group();

      const tex =
        n.kind === "save"
          ? texture(`thumb:${n.thumb_url ?? id}:${fill}`, () => thumbTexture(n.thumb_url, fill, ink))
          : texture(`disc:${fill}:${ink}`, () => discTexture(fill, ink));
      group.add(spriteFrom(tex, d, opacity));

      // Kinds, folders and interests carry a name chip; a reel shows its card when tapped.
      if (n.kind !== "save" && on) {
        const text = n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label;
        const weight = n.kind === "type" ? 700 : 600;
        const color = n.kind === "type" ? ink : colors.ink;
        const chip = label(`${text}:${color}:${weight}`, () => labelTexture(text, color, colors.line, weight));
        const h = n.kind === "type" ? 6.4 : 4.6;
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: chip.tex, transparent: true, depthWrite: false, depthTest: false }),
        );
        sprite.scale.set(h * chip.aspect, h, 1);
        sprite.position.set(0, -(d / 2 + h * 0.7), 0);
        sprite.renderOrder = 2;
        group.add(sprite);
      }
      return group;
    },
    [colors, lit, selected, texture, label],
  );

  const touches = useCallback(
    (l: L) => !selected || endId(l.source) === selected || endId(l.target) === selected,
    [selected],
  );

  // The kind's ink, at full strength for the drifting particles and softened for the line.
  const inkOf = useCallback(
    (l: L) => {
      if (l.kind === "likes") return colors.butterInk;
      const t = (l.source as N & GraphNode).type;
      return t ? colors.kinds[t].ink : colors.ink;
    },
    [colors],
  );

  const linkColor = useCallback(
    (l: L) => {
      if (!touches(l)) return colors.line;
      if (l.kind === "related" || l.kind === "likes") return soften(inkOf(l), 0.35);
      return colors.lineStrong;
    },
    [colors, touches, inkOf],
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
        nodeThreeObjectExtend={false}
        nodeRelSize={1}
        nodeVal={(n) => (size(n) / 2) ** 3}
        linkColor={linkColor}
        linkOpacity={0.7}
        linkWidth={0}
        linkDirectionalParticles={(l) => (l.kind === "related" && !still && touches(l) ? 2 : 0)}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleWidth={1.6}
        linkDirectionalParticleColor={inkOf}
        cooldownTicks={160}
        onEngineStop={() => {
          if (fitted.current) return;
          fitted.current = true;
          fg.current?.zoomToFit(600, 36);
          if (!still && !touched.current) {
            const controls = fg.current?.controls() as unknown as { autoRotate?: boolean; autoRotateSpeed?: number };
            if (controls) {
              controls.autoRotate = true;
              controls.autoRotateSpeed = 0.6;
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
