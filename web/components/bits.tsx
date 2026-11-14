"use client";

// Small shared parts in the mockup's language: the kind chip, a reel thumbnail, and a
// clock that ticks so "5 min ago" stays true while a screen is open.

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { kindOf, kindTint } from "@/lib/kinds";
import type { SaveType } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "Food" on peach. `label` is the server's label when one came with the data. */
export function KindChip({ type, label }: { type: SaveType | null | undefined; label?: string }) {
  const kind = kindOf(type);
  if (!kind) return null;
  return (
    <span className="kind" style={kindTint(type)}>
      {label || kind.label}
    </span>
  );
}

/** A reel's thumbnail, or its kind's icon on the kind's colour when there is none. */
export function ReelThumb({
  thumbUrl,
  type,
  small = false,
}: {
  thumbUrl: string | null | undefined;
  type: SaveType | null | undefined;
  small?: boolean;
}) {
  const kind = kindOf(type);
  return (
    <span className={cn("thumb", small && "sm")} style={kindTint(type)} aria-hidden="true">
      {thumbUrl ? (
        // Thumbnails are plain <img> through the /api rewrite.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl} alt="" loading="lazy" />
      ) : (
        <Icon name={kind?.icon ?? "bookmark"} />
      )}
    </span>
  );
}

/** Date.now(), refreshed on an interval. */
export function useNow(everyMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
