// One table for what each save type is called and how it is coloured, used everywhere a
// type shows: chips, tiles, taste tiles, the "File under" sheet. The server sends the same
// labels in GET /api/tastes; where it does, the server's label wins.

import type { CSSProperties } from "react";
import type { IconName } from "@/components/icons";
import type { Deliver, SaveType } from "./types";

export type KindColor = "peach" | "butter" | "sky" | "mint" | "rose" | "lavender";

export interface Kind {
  label: string;
  color: KindColor;
  icon: IconName;
}

// Six colours for seven types: places share mint with fitness, so that events and places,
// which sit next to each other in Plans, stay apart.
export const KINDS: Record<SaveType, Kind> = {
  recipe: { label: "Food", color: "peach", icon: "food" },
  event: { label: "Events", color: "sky", icon: "cal" },
  place: { label: "Places", color: "mint", icon: "travel" },
  workout: { label: "Fitness", color: "mint", icon: "fit" },
  product: { label: "Products", color: "rose", icon: "scent" },
  tip: { label: "Learning", color: "lavender", icon: "learn" },
  other: { label: "Just vibes", color: "butter", icon: "spark" },
};

/** What each way of delivering an action is called on a tile, and its main button. */
export const DELIVERY: Record<Deliver, { label: string; icon: IconName; button: string }> = {
  cook: { label: "Cook mode", icon: "food", button: "Start cooking" },
  shop: { label: "Prices", icon: "tag", button: "Check prices" },
  itinerary: { label: "Itinerary", icon: "travel", button: "Build the itinerary" },
  calendar: { label: "Calendar", icon: "cal", button: "Add to calendar" },
  workout: { label: "Workout", icon: "fit", button: "Start the workout" },
  learn: { label: "Key points", icon: "learn", button: "See the key points" },
  keep: { label: "Saved", icon: "bookmark", button: "" },
};

/** Where an action opens: the reel's page, told what to do on arrival. */
export function actionHref(saveId: string, deliver: Deliver): string {
  return `/s/${saveId}?do=${deliver}`;
}

export const KIND_ORDER: SaveType[] = ["recipe", "event", "place", "workout", "product", "tip", "other"];

export function kindOf(type: SaveType | null | undefined): Kind | null {
  return type ? (KINDS[type] ?? null) : null;
}

/** The mockup's --p (pastel) and --d (ink) pair for a colour. */
export function tint(color: KindColor): CSSProperties {
  return { "--p": `var(--${color})`, "--d": `var(--${color}-ink)` } as CSSProperties;
}

export function kindTint(type: SaveType | null | undefined): CSSProperties | undefined {
  const k = kindOf(type);
  return k ? tint(k.color) : undefined;
}
