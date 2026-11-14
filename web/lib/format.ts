// Labels and small formatters. No numbers are invented here: everything formats API data.

import type { Ingredient, SaveType, Ticket } from "./types";

export const TYPE_LABEL: Record<SaveType, string> = {
  recipe: "Recipe",
  event: "Event",
  place: "Place",
  workout: "Workout",
  product: "Product",
  tip: "Tip",
  other: "Other",
};

export const TYPE_PLURAL: Record<SaveType, string> = {
  recipe: "Recipes",
  event: "Events",
  place: "Places",
  workout: "Workouts",
  product: "Products",
  tip: "Tips",
  other: "Other",
};

export const TYPE_ORDER: SaveType[] = ["recipe", "event", "place", "workout", "product", "tip", "other"];

/** "0.4 s" for a measured step time in milliseconds. */
export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** "0:12" for a transcript offset. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "instagram.com/reel/Abc123" when a save has no title yet. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

export function ticketTitle(t: Ticket): string {
  return t.title || shortUrl(t.url);
}

export type TicketState =
  | "printing"
  | "proposed"
  | "proposed_quiet"
  | "accepted"
  | "followup"
  | "done"
  | "skipped"
  | "declined"
  | "failed";

export function ticketState(t: Ticket): TicketState {
  if (t.processing === "failed") return "failed";
  const p = t.plan;
  if (!p) {
    return t.processing === "queued" || t.processing === "reading" || t.processing === "planning"
      ? "printing"
      : "declined";
  }
  switch (p.status) {
    case "proposed":
      return p.actionable && p.options.length > 0 ? "proposed" : "proposed_quiet";
    case "accepted":
      return p.followup_due ? "followup" : "accepted";
    case "done":
      return "done";
    case "skipped":
      return "skipped";
    default:
      return "declined";
  }
}

export function followupQuestion(kind: SaveType | undefined): string {
  if (kind === "recipe") return "Did you make it?";
  if (kind === "workout") return "Did you do it?";
  if (kind === "place") return "Did you go?";
  return "Did it happen?";
}

const FRACTIONS: [number, string][] = [
  [0.25, "1/4"],
  [0.33, "1/3"],
  [0.5, "1/2"],
  [0.67, "2/3"],
  [0.75, "3/4"],
];

function qtyText(qty: number): string {
  const whole = Math.floor(qty);
  const rest = qty - whole;
  if (rest < 0.01) return String(whole);
  const hit = FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.02);
  if (hit) return whole > 0 ? `${whole} ${hit[1]}` : hit[1];
  return String(Math.round(qty * 100) / 100);
}

/** "2 tbsp gochujang" */
export function ingredientLine(i: Ingredient): string {
  const parts: string[] = [];
  if (typeof i.qty === "number" && i.qty > 0) parts.push(qtyText(i.qty));
  if (i.unit) parts.push(i.unit);
  parts.push(i.item);
  return parts.join(" ");
}

/** The day word the server would use for a custom time: "today", "Thursday" or "Nov 26". */
export function longDayFor(local: string): string | null {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (days === 0) return "today";
  if (days > 0 && days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** A datetime-local value ("YYYY-MM-DDTHH:mm") for now plus some minutes, in the browser's zone. */
export function localInputValue(plusMinutes = 0): string {
  const d = new Date(Date.now() + plusMinutes * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
