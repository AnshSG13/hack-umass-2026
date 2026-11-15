"use client";

// Share and export for action mode: send the recipe, the itinerary, the price list, the
// routine or the key points as text (the phone's share sheet, a copy, an email), as a file,
// or as a PDF through the browser's print dialog. The text is built from what the page shows;
// nothing new is made up for it.

import { useState } from "react";
import useSWR from "swr";
import { Icon, type IconName } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Sheet, SheetContent, SheetHead } from "@/components/ui/sheet";
import { fetcher } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { ingredientLine } from "@/lib/format";
import { useConfig } from "@/lib/hooks";
import { tint, type KindColor } from "@/lib/kinds";
import { useTicketActions } from "@/lib/ticket-actions";
import type { Deliver, Fields, Shop, Ticket, TripState } from "@/lib/types";

function dose(ex: { sets?: number; reps?: string; duration_sec?: number }): string {
  if (ex.sets && ex.reps) return `${ex.sets} x ${ex.reps}`;
  if (ex.sets && ex.duration_sec) return `${ex.sets} x ${ex.duration_sec} s`;
  if (ex.reps) return /^\d+$/.test(ex.reps.trim()) ? `${ex.reps.trim()} reps` : ex.reps;
  if (ex.duration_sec) return `${ex.duration_sec} s`;
  return "";
}

/** The action as plain text, from the data the page already has. */
export function actionText(
  deliver: Deliver,
  ticket: Ticket,
  fields: Fields,
  extra: { shop?: Shop | null; trip?: TripState | null },
  appName: string,
): string {
  const title = ticket.title ?? "Saved reel";
  const lines: string[] = [ticket.action?.cta || title, ""];
  if (deliver === "cook" && fields.recipe) {
    const r = fields.recipe;
    lines.push(title);
    const facts = [r.total_time_min ? `${r.total_time_min} min` : null, r.servings ? `serves ${r.servings}` : null].filter(Boolean);
    if (facts.length) lines.push(facts.join(", "));
    if (r.ingredients?.length) lines.push("", "Ingredients", ...r.ingredients.map((i) => `- ${ingredientLine(i)}`));
    if (r.steps?.length) lines.push("", "Steps", ...r.steps.map((s, i) => `${i + 1}. ${s}`));
  } else if (deliver === "workout" && fields.workout) {
    const w = fields.workout;
    if (w.goal) lines.push(w.goal);
    if (w.equipment?.length) lines.push(`You need: ${w.equipment.join(", ")}`);
    lines.push("", ...(w.exercises ?? []).map((ex, i) => `${i + 1}. ${ex.name}${dose(ex) ? `, ${dose(ex)}` : ""}${ex.rest_sec ? `, rest ${ex.rest_sec} s` : ""}`));
  } else if (deliver === "learn" && fields.tip) {
    const t = fields.tip;
    if (t.topic) lines.push(t.topic);
    lines.push("", ...(t.key_points ?? []).map((p) => `- ${p}`));
    if (t.takeaway) lines.push("", `Takeaway: ${t.takeaway}`);
  } else if (deliver === "shop" && extra.shop?.status === "ready") {
    const s = extra.shop;
    const main = s.offers.filter((o) => !o.alternative);
    const alts = s.offers.filter((o) => o.alternative);
    lines.push(title, "");
    lines.push(...main.map((o) => `- ${o.product}: ${o.price_text} at ${o.store}\n  ${o.url}`));
    if (alts.length) lines.push("", "Similar products", ...alts.map((o) => `- ${o.product}: ${o.price_text} at ${o.store}\n  ${o.url}`));
    if (s.checked_on) lines.push("", `Prices checked ${s.checked_on}. Check the store before you buy.`);
  } else if (deliver === "itinerary" && extra.trip?.trip) {
    const t = extra.trip.trip;
    lines.push(`${t.city}, ${t.date_label}`);
    for (const d of t.days) {
      lines.push("", `${d.label}: ${d.title}`);
      for (const s of d.stops) {
        const bits = [s.what, s.cost ? `Cost: ${s.cost}` : null, s.hours ? `Hours: ${s.hours}` : null].filter(Boolean);
        lines.push(`- ${s.time} ${s.name}${s.area ? ` (${s.area})` : ""}`, ...(bits.length ? [`  ${bits.join(". ")}`] : []));
      }
    }
    if (t.stay) lines.push("", `Stay: ${t.stay.area}. ${t.stay.why}`);
  } else if (deliver === "calendar" && fields.event) {
    const e = fields.event;
    lines.push(e.name || title);
    const when = e.date_text || e.start_local?.replace("T", " ");
    if (when) lines.push(`When: ${when}`);
    if (e.price_hint) lines.push(`Price: ${e.price_hint}`);
    if (e.venue || e.city) lines.push(`Where: ${[e.venue, e.city].filter(Boolean).join(", ")}`);
    if (e.ticket_url) lines.push(`Tickets: ${e.ticket_url}`);
  } else {
    lines.push(title);
  }
  lines.push("", `From this reel: ${ticket.url}`, `Made with ${appName}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fileName(title: string): string {
  return (title || "action").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "action";
}

export function ShareAction({ deliver, ticket, fields }: { deliver: Deliver; ticket: Ticket; fields: Fields }) {
  const [open, setOpen] = useState(false);
  // "calendar": the sheet's second page, Apple or Google Calendar (after picking a time).
  const [view, setView] = useState<"main" | "calendar">("main");
  // The ticket as this sheet last saw it: picking a time here updates it at once.
  const [cur, setCur] = useState(ticket);
  const [seen, setSeen] = useState(ticket);
  if (ticket !== seen) {
    // The page loaded a newer ticket: start from that.
    setSeen(ticket);
    setCur(ticket);
  }
  const actions = useTicketActions(cur, { apply: setCur });
  const plan = cur.plan;
  const planned = plan?.status === "accepted" && Boolean(plan.ics_url || plan.gcal_url);
  const times = plan && plan.status === "proposed" && plan.actionable ? plan.options.slice(0, 3) : [];
  const canCalendar = planned || times.length > 0;
  const toast = useToast();
  const { appName } = useConfig();
  // The same keys the price list and the trip plan use, so this reads their cached data.
  const { data: shop } = useSWR<{ shop: Shop | null }>(deliver === "shop" ? `/api/saves/${ticket.save_id}/shop` : null, fetcher);
  const { data: trip } = useSWR<TripState>(deliver === "itinerary" ? `/api/saves/${ticket.save_id}/trip` : null, fetcher);
  const subject = ticket.action?.cta || ticket.title || appName;
  const text = () => actionText(deliver, ticket, fields, { shop: shop?.shop ?? null, trip: trip ?? null }, appName);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const notReady =
    (deliver === "shop" && shop?.shop?.status !== "ready") || (deliver === "itinerary" && trip?.status !== "ready");

  async function nativeShare() {
    try {
      await navigator.share({ title: subject, text: text() });
      setOpen(false);
    } catch {
      /* closed without sharing */
    }
  }
  async function copy() {
    toast.show((await copyText(text())) ? "Copied" : "Couldn't copy. Try Share instead.");
    setOpen(false);
  }
  function email() {
    window.location.assign(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text())}`);
    setOpen(false);
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text()], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName(subject)}.txt`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setOpen(false);
  }
  function pdf() {
    setOpen(false);
    // After the sheet has closed, so it isn't in the printout.
    window.setTimeout(() => window.print(), 350);
  }

  const rows: { icon: IconName; name: string; note: string; color: KindColor; run: () => void; show: boolean }[] = [
    {
      icon: "cal",
      name: "Add to calendar",
      note: planned ? `Apple or Google Calendar, ${plan?.big_time ?? "at its time"}` : "Pick a time, then Apple or Google Calendar",
      color: "rose",
      run: () => setView("calendar"),
      show: canCalendar,
    },
    { icon: "share", name: "Share", note: "Messages, WhatsApp, Notes and more", color: "lavender", run: () => void nativeShare(), show: canShare },
    { icon: "copy", name: "Copy as text", note: "Paste it anywhere", color: "sky", run: () => void copy(), show: true },
    { icon: "mail", name: "Email it", note: "Opens your mail app", color: "peach", run: email, show: true },
    { icon: "print", name: "Save as PDF", note: "Or print it", color: "mint", run: pdf, show: true },
    { icon: "download", name: "Download a text file", note: `${fileName(subject)}.txt`, color: "butter", run: download, show: true },
  ];

  return (
    <>
      <button type="button" className="round act-share" aria-label="Share or export" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="share" />
      </button>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setView("main");
        }}
      >
        <SheetContent aria-describedby={undefined}>
          {view === "calendar" ? (
            <CalendarPage
              ticket={cur}
              planned={planned}
              times={times}
              busy={actions.busy}
              error={actions.error}
              onPick={(id) => void actions.confirm(id)}
              onBack={() => setView("main")}
              onDone={() => setOpen(false)}
            />
          ) : (
          <>
          <SheetHead>Share or export</SheetHead>
          {notReady && <p className="plan-meta" style={{ marginTop: 0 }}>It finishes in a moment; until then only the basics are included.</p>}
          <ul className="opts">
            {rows
              .filter((r) => r.show)
              .map((r) => (
                <li key={r.name}>
                  <button type="button" className="opt" onClick={r.run}>
                    <span className="opt-ico" style={tint(r.color)}>
                      <Icon name={r.icon} />
                    </span>
                    <span className="opt-text">
                      <span className="opt-name">{r.name}</span>
                      <span className="opt-note">{r.note}</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The share sheet's calendar page. Once the plan has a time: Apple Calendar (a calendar file)
 *  or Google Calendar (its add-event page), as real links so the phone opens them. Before that,
 *  the suggested times; picking one plans it, and the two calendars appear. */
function CalendarPage({
  ticket,
  planned,
  times,
  busy,
  error,
  onPick,
  onBack,
  onDone,
}: {
  ticket: Ticket;
  planned: boolean;
  times: NonNullable<Ticket["plan"]>["options"];
  busy: string | null;
  error: string | null;
  onPick: (id: string) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const plan = ticket.plan;
  return (
    <>
      <button type="button" className="back-pill cal-back" onClick={onBack}>
        <Icon name="back" />
        Share or export
      </button>
      <SheetHead>Add to calendar</SheetHead>
      {planned && plan ? (
        <>
          <p className="cal-when">
            <Icon name="cal" />
            <span>
              <b>{plan.big_time ?? "Planned"}</b>
              {ticket.title ? ` · ${ticket.title}` : ""}
            </span>
          </p>
          <ul className="opts">
            {plan.ics_url && (
              <li>
                <a className="opt" href={plan.ics_url} target="_blank" rel="noopener noreferrer" onClick={onDone}>
                  <span className="opt-ico" style={tint("sky")}>
                    <Icon name="cal" />
                  </span>
                  <span className="opt-text">
                    <span className="opt-name">Apple Calendar</span>
                    <span className="opt-note">Adds it on this iPhone, with its alerts</span>
                  </span>
                </a>
              </li>
            )}
            {plan.gcal_url && (
              <li>
                <a className="opt" href={plan.gcal_url} target="_blank" rel="noopener noreferrer" onClick={onDone}>
                  <span className="opt-ico" style={tint("mint")}>
                    <Icon name="cal" />
                  </span>
                  <span className="opt-text">
                    <span className="opt-name">Google Calendar</span>
                    <span className="opt-note">Opens Google Calendar to save it</span>
                  </span>
                </a>
              </li>
            )}
          </ul>
        </>
      ) : (
        <>
          <p className="plan-meta" style={{ marginTop: 0 }}>
            Pick a time first. It goes on your week, then you choose Apple or Google Calendar.
          </p>
          <ul className="opts">
            {times.map((o) => (
              <li key={o.id}>
                <button type="button" className="opt" disabled={busy !== null} onClick={() => onPick(o.id)}>
                  <span className="opt-ico" style={tint("rose")}>
                    <Icon name="clock" />
                  </span>
                  <span className="opt-text">
                    <span className="opt-name">{busy === o.id ? "Planning it" : o.big_time}</span>
                    <span className="opt-note">{o.secondary || o.web_label}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="plan-error">
              {error}
            </p>
          )}
        </>
      )}
    </>
  );
}
