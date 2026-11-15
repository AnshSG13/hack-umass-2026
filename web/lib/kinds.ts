// One table for what each save type is called and how it is coloured, used everywhere a
// type shows: chips, tiles, taste tiles, the "File under" sheet. The server sends the same
// labels in GET /api/tastes; where it does, the server's label wins.

import type { CSSProperties } from "react";
import type { IconName } from "@/components/icons";
import type { Deliver, SaveType } from "./types";

export type KindColor = "peach" | "butter" | "sky" | "mint" | "lime" | "rose" | "lavender";

export interface Kind {
  label: string;
  color: KindColor;
  icon: IconName;
}

// Seven colours for seven types: every taste has its own, so no two categories look alike
// side by side (filter chips, taste tiles, passes).
export const KINDS: Record<SaveType, Kind> = {
  recipe: { label: "Food", color: "peach", icon: "food" },
  event: { label: "Events", color: "sky", icon: "cal" },
  place: { label: "Places", color: "mint", icon: "travel" },
  workout: { label: "Fitness", color: "lime", icon: "fit" },
  product: { label: "Products", color: "rose", icon: "scent" },
  tip: { label: "Learning", color: "lavender", icon: "learn" },
  other: { label: "Just vibes", color: "butter", icon: "spark" },
};

/** What each way of delivering an action is called on a tile, and its main button. */
export const DELIVERY: Record<Deliver, { label: string; icon: IconName; button: string; color: KindColor }> = {
  cook: { label: "Cook mode", icon: "food", button: "Cook now", color: "peach" },
  shop: { label: "Shop and compare", icon: "tag", button: "Shop and compare", color: "rose" },
  itinerary: { label: "Itinerary", icon: "travel", button: "Build the itinerary", color: "sky" },
  calendar: { label: "Calendar", icon: "cal", button: "Add to calendar", color: "butter" },
  workout: { label: "Gym routine", icon: "fit", button: "Start the workout", color: "lime" },
  learn: { label: "Key points", icon: "learn", button: "Explore", color: "lavender" },
  keep: { label: "Saved", icon: "bookmark", button: "", color: "butter" },
};

/** Where an action opens: action mode, apart from the reel's details. */
export function actionHref(saveId: string, deliver: Deliver): string {
  return deliver === "keep" ? `/s/${saveId}` : `/a/${saveId}`;
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
