// Small formatters. No numbers are invented here: everything formats API data.
// What each save type is called and how it is coloured lives in lib/kinds.ts.

import type { Ingredient, SaveType, Ticket } from "./types";

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

export function qtyText(qty: number): string {
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

/** An ingredient at another number of servings. Amounts stay readable: "1 1/2", "0.4", "450". */
export function scaleIngredient(i: Ingredient, servings: number, base: number): Ingredient {
  if (typeof i.qty !== "number" || i.qty <= 0 || base <= 0 || servings === base) return i;
  const raw = (i.qty * servings) / base;
  const qty = raw >= 20 ? Math.round(raw) : Math.round(raw * 100) / 100;
  return { ...i, qty };
}

/** "2 tbsp" and "gochujang", apart, so the amount can be set in bold. */
export function ingredientParts(i: Ingredient): { qty: string; name: string } {
  const parts: string[] = [];
  if (typeof i.qty === "number" && i.qty > 0) parts.push(qtyText(i.qty));
  if (i.unit) parts.push(i.unit);
  return { qty: parts.join(" "), name: i.item };
}

/**
 * "just now", "5 min ago", "2 days ago". The one piece of date text made in the browser;
 * every other date and time is shown as the server sent it.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/** "Good morning", by the clock on this device. */
export function greeting(hour: number = new Date().getHours()): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Thursday, Nov 19, 2026, 6:30 pm" from a local "YYYY-MM-DDTHH:mm" (midnight means no time was given). */
export function eventDate(start?: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(start ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  const hasTime = m[4] !== undefined && !(m[4] === "00" && m[5] === "00");
  if (!hasTime) return day;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "").toLowerCase();
  return `${day}, ${time}`;
}

/** True while a save is being fetched, read or planned: the states the processing tile covers. */
export function inFlight(processing: string | undefined): boolean {
  return processing === "queued" || processing === "reading" || processing === "planning";
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

/** A count of the person's saves, said as theirs: "1 of your saves", "12 of your saves". */
export function yourSaves(n: number): string {
  return `${n} of your saves`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
