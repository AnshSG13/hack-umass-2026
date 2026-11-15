"use client";

// Home's week: a strip of seven days, the chosen day's plans or its free time (with saves
// that fit it, one tap to add), and one shopping list for the recipes planned this week.
// Everything comes from GET /api/week and /api/plans, both computed in code.

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { ReelThumb } from "@/components/bits";
import { Icon } from "@/components/icons";
import { DayItems } from "@/components/plans-parts";
import { useToast } from "@/components/toast";
import { api, ApiError, fetcher } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { plural } from "@/lib/format";
import type { FreeSlot, Ticket, WeekDay, WeekResponse } from "@/lib/types";

export const WEEK_KEY = "/api/week";
export const PLANS_KEY = "/api/plans?range=week";

export function useWeek() {
  return useSWR<WeekResponse>(WEEK_KEY, fetcher);
}

function dayLabel(d: WeekDay): string {
  return d.today ? "Today" : d.long;
}

// ---- the strip ----

export function WeekStrip({
  days,
  selected,
  free,
  onSelect,
}: {
  days: WeekDay[];
  selected: string;
  free: Set<string>;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="wk" role="group" aria-label="Your week">
      {days.map((d) => {
        const on = d.date === selected;
        const open = free.has(d.date);
        const said = [
          `${d.long} ${d.num}`,
          d.planned > 0 ? plural(d.planned, "plan", "plans") : "nothing planned",
          open ? "free time" : "",
        ].filter(Boolean);
        return (
          <button
            key={d.date}
            type="button"
            className="wk-day"
            aria-pressed={on}
            aria-label={said.join(", ")}
            onClick={() => onSelect(d.date)}
          >
            <span className="wk-short">{d.today ? "Today" : d.short}</span>
            <span className="wk-num">{d.num}</span>
            <span className="wk-mark" aria-hidden="true">
              {d.planned > 0
                ? Array.from({ length: Math.min(d.planned, 3) }, (_, i) => <i key={i} className="wk-dot" />)
                : open && <i className="wk-ring" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---- one day ----

function FreeCard({ slot }: { slot: FreeSlot }) {
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  function refresh() {
    void mutate(WEEK_KEY);
    void mutate(PLANS_KEY);
    void mutate("/api/bundles");
  }

  async function undo(saveId: string) {
    try {
      const r = await api<{ message?: string }>(`/api/saves/${saveId}/unconfirm`, { method: "POST" });
      toast.show(r.message || "Undone.");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    }
    refresh();
  }

  async function add(saveId: string) {
    setBusy(saveId);
    try {
      const r = await api<{ status: string; message: string }>(`/api/saves/${saveId}/confirm`, {
        body: { start_local: slot.start_local, source: "web" },
      });
      if (r.status === "accepted") toast.show(r.message || `Planned for ${slot.day}.`, { undo: () => void undo(saveId) });
      else toast.show(r.message || "That time isn't free any more.");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    }
    setBusy(null);
    refresh();
  }

  // "Add to Thu", "Add to tomorrow": day words mid-sentence stay lower case.
  const first = slot.when.split(" ")[0];
  const shortDay = first === "Today" || first === "Tomorrow" ? first.toLowerCase() : first;
  return (
    <div className="free">
      <p className="free-head">
        <Icon name="cal" />
        <span>
          {slot.label} <span className="free-when">· {slot.when}</span>
        </span>
      </p>
      <ul className="rows free-rows">
        {slot.suggestions.map((s) => (
          <li key={s.save_id} className="free-row">
            <Link href={`/s/${s.save_id}`} className="row">
              <ReelThumb thumbUrl={s.thumb_url} type={s.type} small />
              <span className="row-main">
                <span className="row-title">{s.title}</span>
              </span>
            </Link>
            <button
              type="button"
              className="btn free-add"
              disabled={busy !== null}
              aria-label={`Add to ${shortDay}: ${s.title}, ${slot.when}`}
              onClick={() => void add(s.save_id)}
            >
              {busy === s.save_id ? "Adding" : `Add to ${shortDay}`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DayPanel({
  day,
  items,
  free,
  nextFree,
  onPick,
}: {
  day: WeekDay;
  items: Ticket[];
  free: FreeSlot | undefined;
  /** The next day with free time, offered when this one has nothing. */
  nextFree?: FreeSlot;
  onPick: (date: string) => void;
}) {
  return (
    <section className="wk-panel" aria-label={dayLabel(day)}>
      <h3 className="day-label">
        {dayLabel(day)}
        {!day.today && <span className="wk-panel-num"> {day.num}</span>}
      </h3>
      {items.length > 0 ? (
        <DayItems items={items} />
      ) : (
        !free && (
          <p className="wk-none">
            Nothing planned.
            {nextFree && (
              <>
                {" "}
                <button type="button" className="link wk-jump" onClick={() => onPick(nextFree.date)}>
                  See free time on {nextFree.day}
                </button>
              </>
            )}
          </p>
        )
      )}
      {free && <FreeCard slot={free} />}
    </section>
  );
}

// ---- the shopping list ----

const SHOW = 8;

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function ShoppingList({ week }: { week: WeekResponse }) {
  const toast = useToast();
  const items = week.groceries.items;
  const recipes = week.groceries.recipes;
  // Ticked items are this viewer's own convenience: kept in this browser, per week.
  const store = `rl_shop_${week.days[0]?.date ?? ""}`;
  const [got, setGot] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(store);
      // Reading browser storage after mount, so the first render matches the server.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setGot(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* no storage: nothing ticked */
    }
  }, [store]);
  if (items.length === 0) return null;

  function toggle(key: string) {
    setGot((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(store, JSON.stringify([...next]));
      } catch {
        /* no storage: it still ticks for now */
      }
      return next;
    });
  }

  const left = items.filter((g) => !got.has(g.key));
  const shown = all ? items : items.slice(0, SHOW);
  const text = [
    `Shopping for ${recipes.map((r) => r.title).join(", ")}`,
    ...left.map((g) => `- ${capital(g.item)}${g.amount ? ` (${g.amount})` : ""}`),
  ].join("\n");

  async function share() {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* closed or not allowed: copy instead */
      }
    }
    toast.show((await copyText(text)) ? "Copied the list." : "That didn't copy. Try again.");
  }

  return (
    <section className="blk" aria-labelledby="shop-h">
      <div className="block-head">
        <h2 id="shop-h" className="block-title">
          Shopping list
          <span className="pill">{left.length}</span>
        </h2>
        <button type="button" className="add shop-send" onClick={() => void share()} disabled={left.length === 0}>
          <Icon name="share" />
          Send
        </button>
      </div>
      <p className="blk-sub">For {recipes.map((r) => r.title).join(", ")}</p>
      <ul className="shop">
        {shown.map((g) => {
          const on = got.has(g.key);
          return (
            <li key={g.key}>
              <label className="shop-row" data-got={on}>
                <input type="checkbox" checked={on} onChange={() => toggle(g.key)} />
                <span className="shop-box" aria-hidden="true">
                  {on && <Icon name="check" />}
                </span>
                <span className="shop-item">{capital(g.item)}</span>
                {g.amount && <span className="shop-amt">{g.amount}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {items.length > SHOW && (
        <button type="button" className="chats-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}
