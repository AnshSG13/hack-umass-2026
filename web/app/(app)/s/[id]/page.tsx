"use client";

// The Reel page, after the mockup: hero, category chip, title, summary, facts, the plan
// card, actions, the trip plan (places and events), what was pulled from the
// reel, how it was read and planned.

import { useEffect, useId, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { AgentTrace } from "@/components/agent-activity";
import { useNow } from "@/components/bits";
import { Icon, type IconName } from "@/components/icons";
import { CookCard, CookMode, NutritionPanel } from "@/components/cook";
import { PlanCard } from "@/components/plan-card";
import { ShopResearch } from "@/components/shop-research";
import { AskAboutButton, Discussions, ReelChat } from "@/components/reel-chat";
import { ReelSections } from "@/components/reel-sections";
import { useApp } from "@/components/shell";
import { useToast } from "@/components/toast";
import { SEEDED_SAMPLE_NOTE } from "@/components/trace";
import { TripPlan } from "@/components/trip-plan";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHead, SheetTitle } from "@/components/ui/sheet";
import { api, ApiError, fetcher } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import {
  clock,
  eventDate,
  inFlight,
  ingredientLine,
  plural,
  relativeTime,
  scaleIngredient,
  ticketTitle,
} from "@/lib/format";
import { useConfig, useRefresh, useSaveDetail } from "@/lib/hooks";
import { KIND_ORDER, kindOf, KINDS, kindTint, tint } from "@/lib/kinds";
import type { Deliver, Fields, Ingredient, SaveDetail, SavePatch, SaveType, TastesResponse, Ticket } from "@/lib/types";

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError && e.status !== 404 && e.status !== 405 ? e.message : fallback;
}

// ---- facts row: only values the reel gave ----

function facts(type: SaveType | null, fields: Fields, servings: number | null): { icon: IconName; text: string }[] {
  const out: { icon: IconName; text: string }[] = [];
  if (type === "recipe" && fields.recipe) {
    const r = fields.recipe;
    if (r.total_time_min) out.push({ icon: "clock", text: `${r.total_time_min} min` });
    const serves = servings ?? r.servings;
    if (serves) out.push({ icon: "users", text: `Serves ${serves}` });
  } else if (type === "workout" && fields.workout) {
    const w = fields.workout;
    if (w.duration_min) out.push({ icon: "clock", text: `${w.duration_min} min` });
    if (w.goal) out.push({ icon: "fit", text: w.goal });
  } else if (type === "event" && fields.event) {
    const e = fields.event;
    const date = e.date_text || eventDate(e.start_local);
    if (date) out.push({ icon: "cal", text: date });
    if (e.venue) out.push({ icon: "pin", text: e.venue });
  } else if (type === "place" && fields.place) {
    const cities = Array.from(new Set((fields.place.places ?? []).map((p) => p.city).filter(Boolean))) as string[];
    if (cities.length > 0) out.push({ icon: "pin", text: cities.slice(0, 3).join(", ") });
  } else if (type === "product" && fields.product) {
    const items = fields.product.items ?? [];
    if (items.length === 1 && items[0].price_hint) out.push({ icon: "tag", text: items[0].price_hint });
  }
  return out;
}

// ---- grocery list ----

function groceryGroups(list: Ingredient[]): { aisle: string; items: Ingredient[] }[] {
  const groups = new Map<string, Ingredient[]>();
  for (const ing of list) {
    const aisle = ing.aisle?.trim() || "Other";
    groups.set(aisle, [...(groups.get(aisle) ?? []), ing]);
  }
  return Array.from(groups, ([aisle, items]) => ({ aisle, items }));
}

function sentence(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function GrocerySheet({
  open,
  onOpenChange,
  title,
  ingredients,
  servings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  ingredients: Ingredient[];
  servings: number | null;
}) {
  const toast = useToast();
  const groups = groceryGroups(ingredients);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const text = [
    servings ? `Groceries for ${title} (${plural(servings, "serving", "servings")})` : `Groceries for ${title}`,
    ...groups.flatMap((g) => ["", `${sentence(g.aisle)}:`, ...g.items.map((i) => `- ${ingredientLine(i)}`)]),
  ].join("\n");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHead>Grocery list</SheetHead>
        <SheetDescription>
          {servings ? `${title}, for ${plural(servings, "serving", "servings")}` : title}
        </SheetDescription>
        {groups.map((g) => (
          <div key={g.aisle}>
            <h3 className="aisle">{sentence(g.aisle)}</h3>
            <ul className="glist">
              {g.items.map((ing, i) => (
                <li key={i}>{ingredientLine(ing)}</li>
              ))}
            </ul>
          </div>
        ))}
        <div className="sheet-foot">
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              toast.show((await copyText(text)) ? "List copied." : "Copying didn't work here. Select the list instead.");
            }}
          >
            <Icon name="copy" />
            Copy list
          </button>
          {canShare && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                // Closing the share sheet rejects the promise; that isn't an error.
                void navigator.share({ title: `Groceries for ${title}`, text }).catch(() => {});
              }}
            >
              <Icon name="share" />
              Share
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---- the page ----

export default function ReelPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const refresh = useRefresh();
  const now = useNow();
  const { appName } = useConfig();
  const { goBack, forget } = useApp();
  const { data, error, isLoading, mutate } = useSaveDetail(id);

  const [servings, setServings] = useState<number | null>(null);
  const [sheet, setSheet] = useState<"cat" | "more" | "delete" | "grocery" | null>(null);
  const [newSub, setNewSub] = useState("");
  const newSubId = useId();
  // The sub-categories this account already uses, offered first in the File under sheet.
  const tastes = useSWR<TastesResponse>(sheet === "cat" ? "/api/tastes" : null, fetcher);
  const [busy, setBusy] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);

  // The reel's own chat: open or not, and which saved discussion (null is a new one).
  const [chatOpen, setChatOpen] = useState(false);
  // The action asked for on arrival (?do=cook from a Ready for you tile). Cook mode opens
  // straight away; the others run once the reel has loaded (see the effect below).
  const [arrivalDo] = useState<Deliver | null>(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search);
    if (q.get("cook") === "1") return "cook";
    const d = q.get("do");
    return d && ["cook", "shop", "itinerary", "workout", "learn"].includes(d) ? (d as Deliver) : null;
  });
  const [cooking, setCooking] = useState(arrivalDo === "cook");
  // Bumped to tell price research or the trip plan to start.
  const [shopGo, setShopGo] = useState(0);
  const [tripGo, setTripGo] = useState(0);
  const arrivalDone = useRef(arrivalDo === "cook" || arrivalDo === null);
  const [discussionId, setDiscussionId] = useState<string | null>(null);

  // A moment in the video to show: from a link (?t=11) or from an answer's "Said at 0:11".
  const [atSec, setAtSec] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const t = new URLSearchParams(window.location.search).get("t");
    return t && /^\d{1,5}$/.test(t) ? Number(t) : null;
  });
  const foldRef = useRef<HTMLDetailsElement>(null);
  const saidRef = useRef<HTMLDetailsElement>(null);
  const hasTranscript = (data?.details.transcript?.length ?? 0) > 0;
  useEffect(() => {
    if (atSec === null || !hasTranscript) return;
    if (foldRef.current) foldRef.current.open = true;
    if (saidRef.current) saidRef.current.open = true;
    // After the chat layer has closed and the rows have opened.
    const scroll = window.setTimeout(() => {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      saidRef.current?.querySelector(".is-at")?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    }, 340);
    const clear = window.setTimeout(() => setAtSec(null), 6000);
    return () => {
      window.clearTimeout(scroll);
      window.clearTimeout(clear);
    };
  }, [atSec, hasTranscript]);

  // After "Reanalyze and re-sort": where the reel was filed before, so the toast at the end
  // can say whether it moved. Cleared once the second reading is done.
  const resorting = useRef<{ type: SaveType | null; sub: string | null } | null>(null);
  useEffect(() => {
    const before = resorting.current;
    const t = data?.ticket;
    if (!before || !t) return;
    if (inFlight(t.processing) || t.processing === "planned" || t.processing === "enriching") return;
    resorting.current = null;
    refresh(`/api/saves/${id}`);
    if (data.details.enrich_error) {
      toast.show("It couldn't be watched again. Where it's filed didn't change.");
      return;
    }
    const where = [kindOf(t.type)?.label, t.subcategory].filter(Boolean).join(" › ");
    const moved = t.type !== before.type || (t.subcategory ?? null) !== before.sub;
    toast.show(moved ? `Re-sorted under ${where}` : `Read again. Still under ${where}`);
  }, [data, id, refresh, toast]);

  // Do the reel's action here: open cook mode, start price research, build the itinerary,
  // or bring the moves or key points into view.
  function doAction(deliver: Deliver) {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const show = (elId: string) =>
      window.setTimeout(
        () => document.getElementById(elId)?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" }),
        80,
      );
    if (deliver === "cook") setCooking(true);
    else if (deliver === "shop") {
      setShopGo((n) => n + 1);
      show("shop");
    } else if (deliver === "itinerary") {
      setTripGo((n) => n + 1);
      show("trip");
    } else if (deliver === "workout") show("workout-h");
    else if (deliver === "learn") show("tip-h");
  }

  // Arrived with ?do=: run it once the reel has been read.
  const readyForDo = data ? !inFlight(data.ticket.processing) : false;
  useEffect(() => {
    if (arrivalDone.current || !readyForDo || !arrivalDo) return;
    arrivalDone.current = true;
    doAction(arrivalDo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyForDo]);

  const backButton = (
    <button type="button" className="round back" aria-label="Back" onClick={goBack}>
      <Icon name="back" />
    </button>
  );

  if (error && !data) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <>
        <div className="hero" style={{ height: 120, background: "none" }}>
          {backButton}
        </div>
        <div className="gutter msg" role="alert">
          <p>{missing ? "That save isn't in your saves." : "This save didn't load. Check your connection."}</p>
          {!missing && (
            <button type="button" className="btn" onClick={() => void mutate()}>
              Try again
            </button>
          )}
        </div>
      </>
    );
  }

  if (isLoading || !data) {
    return (
      <>
        <div className="hero">{backButton}</div>
        <div className="panel gutter" role="status">
          <span className="vh">Loading this save</span>
          <span className="skel" style={{ width: 96, height: 36, borderRadius: 999 }} />
          <span className="skel" style={{ marginTop: 22, height: 30, width: "80%" }} />
          <span className="skel" style={{ marginTop: 16, height: 14, width: "100%" }} />
        </div>
      </>
    );
  }

  const { ticket, details, runs } = data;
  const fields = details.fields ?? {};
  const type = ticket.type;
  const kind = kindOf(type);
  const title = ticketTitle(ticket);
  const reading = inFlight(ticket.processing);
  const enriching = ticket.processing === "enriching" || ticket.processing === "planned";
  const working = enriching || reading;
  const recipe = type === "recipe" ? fields.recipe : undefined;
  const base = recipe?.servings && recipe.servings > 0 ? recipe.servings : null;
  const shownServings = base !== null ? (servings ?? base) : null;
  const groceries = (recipe?.ingredients ?? []).map((ing) =>
    base !== null && shownServings !== null ? scaleIngredient(ing, shownServings, base) : ing,
  );
  const factList = facts(type, fields, shownServings);
  const onInstagram = /instagram\.com/i.test(ticket.url);
  const byline = [
    ticket.creator ? (onInstagram ? `${ticket.creator} on Instagram` : ticket.creator) : onInstagram ? "Instagram" : null,
    details.duration_sec ? clock(details.duration_sec) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const transcript = details.transcript ?? [];
  const onScreen = details.on_screen_text ?? [];
  const unverified = details.unverified ?? [];
  const watched = ticket.processing === "ready" && !details.enrich_error;
  // The spoken line a moment falls in: the last one that starts at or before it.
  const atLine =
    atSec === null ? -1 : transcript.reduce((best, line, i) => (line.start_sec <= atSec + 0.5 ? i : best), -1);

  function openChat(id: string | null) {
    setDiscussionId(id);
    setChatOpen(true);
  }

  // What the plan card changed, without waiting for the next poll.
  function applyTicket(next: Ticket) {
    void mutate((cur) => (cur ? { ...cur, ticket: { ...next, steps: next.steps ?? cur.ticket.steps } } : cur), {
      revalidate: false,
    });
  }

  async function patch(body: SavePatch, fallback: string): Promise<string | null> {
    try {
      const next = await api<SaveDetail>(`/api/saves/${id}`, { method: "PATCH", body });
      await mutate(next, { revalidate: false });
      refresh();
      return null;
    } catch (e) {
      return errorText(e, fallback);
    }
  }

  async function fileUnder(next: SaveType) {
    if (next === type) {
      setSheet(null);
      return;
    }
    setBusy(true);
    setCatError(null);
    const problem = await patch({ type: next }, "Moving it didn't work. Try again.");
    setBusy(false);
    if (problem) {
      setCatError(problem);
      return;
    }
    setServings(null);
    setSheet(null);
    toast.show(`Moved to ${KINDS[next].label}`);
  }

  async function fileSub(next: string) {
    const clean = next.trim();
    if (clean === (ticket.subcategory ?? "")) {
      setSheet(null);
      return;
    }
    setBusy(true);
    setCatError(null);
    let saved: string | null = null;
    try {
      // The server tidies the label and reuses a matching one ("desserts" -> "Dessert"),
      // so the toast names what was saved, not what was typed.
      const next = await api<SaveDetail>(`/api/saves/${id}`, { method: "PATCH", body: { subcategory: clean } });
      await mutate(next, { revalidate: false });
      refresh();
      saved = next.ticket.subcategory;
    } catch (e) {
      setCatError(errorText(e, "That didn't save. Try again."));
      setBusy(false);
      return;
    }
    setBusy(false);
    setNewSub("");
    setSheet(null);
    toast.show(saved ? `Filed under ${kind?.label ?? "this kind"} › ${saved}` : "Sub-category removed");
  }

  async function planAgain() {
    setBusy(true);
    try {
      const r = await api<{ ticket: Ticket; message?: string }>(`/api/saves/${id}/replan`, { method: "POST" });
      applyTicket(r.ticket);
      void mutate();
      refresh();
      setSheet(null);
      toast.show(r.message || "Planned again.");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Planning again didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function reanalyze() {
    setBusy(true);
    try {
      const r = await api<{ ticket: Ticket; message: string }>(`/api/saves/${id}/reanalyze`, { method: "POST" });
      resorting.current = { type: ticket.type, sub: ticket.subcategory ?? null };
      applyTicket(r.ticket);
      toast.show(r.message);
    } catch (e) {
      toast.show(errorText(e, "That didn't start. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api<{ ok: boolean }>(`/api/saves/${id}`, { method: "DELETE" });
      setSheet(null);
      forget(id);
      // Everything but this page's own save, which is gone.
      refresh(`/api/saves/${id}`);
      toast.show("Deleted.");
      router.replace("/home");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Delete didn't work. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hero">
        {ticket.thumb_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ticket.thumb_url} alt={ticket.title ? `Thumbnail of ${ticket.title}` : "Reel thumbnail"} />
        ) : (
          <span className="hero-ph" style={kindTint(type)} aria-hidden="true">
            <Icon name={kind?.icon ?? "bookmark"} />
          </span>
        )}
        {backButton}
        <button type="button" className="round more" aria-label="More options" aria-haspopup="dialog" onClick={() => setSheet("more")}>
          <Icon name="more" />
        </button>
      </div>

      <article className="panel gutter">
        <div className="crumbs">
          {kind ? (
            <button
              type="button"
              className="chip-cat"
              style={tint(kind.color)}
              aria-haspopup="dialog"
              aria-label={`Filed under ${kind.label}${ticket.subcategory ? ` › ${ticket.subcategory}` : ""}. Change`}
              disabled={reading}
              onClick={() => {
                setCatError(null);
                setSheet("cat");
              }}
            >
              <Icon name={kind.icon} />
              <span>
                {kind.label}
                {ticket.subcategory && ` › ${ticket.subcategory}`}
              </span>
              <Icon name="down" />
            </button>
          ) : (
            <span className="chip-cat">
              <Icon name="spark" />
              <span>{reading ? "Reading" : "Not filed"}</span>
            </span>
          )}
          <span className="when">Saved {relativeTime(ticket.created_at, now)}</span>
        </div>

        <h1 className="reel-title">{title}</h1>
        {byline && <p className="byline">{byline}</p>}
        {details.summary && <p className="summary">{details.summary}</p>}

        {factList.length > 0 && (
          <ul className="facts">
            {factList.map((f) => (
              <li key={f.icon + f.text}>
                <Icon name={f.icon} />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        )}

        {/* A recipe is for cooking when you want to, not for booking a slot. One already
            on the calendar keeps its plan card so it can be moved or marked done. */}
        {recipe && !(ticket.plan && ["accepted", "done", "skipped"].includes(ticket.plan.status)) ? (
          <CookCard
            minutes={recipe.total_time_min}
            ingredients={groceries.length}
            steps={recipe.steps?.length ?? 0}
            onCook={() => setCooking(true)}
            onShop={() => setSheet("grocery")}
            headline={ticket.action?.deliver === "cook" ? ticket.action.cta : undefined}
          />
        ) : (
          <PlanCard ticket={ticket} onChange={applyTicket} onDo={doAction} />
        )}

        {enriching && (
          <p className="plan-meta" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="clock" />
            Watching the video for details.
          </p>
        )}

        <div className="actions">
          {groceries.length > 0 && !recipe && (
            <button type="button" className="btn btn-primary" onClick={() => setSheet("grocery")}>
              <Icon name="basket" />
              Make a grocery list
            </button>
          )}
          <AskAboutButton onClick={() => openChat(null)} disabled={reading} />
          <a className="btn" href={ticket.url} target="_blank" rel="noopener noreferrer">
            <Icon name="out" />
            Open original
          </a>
        </div>

        <TripPlan saveId={ticket.save_id} type={type} settled={!reading} go={tripGo} />
        {type === "product" && <ShopResearch saveId={ticket.save_id} settled={!reading} go={shopGo} />}

        <Discussions saveId={ticket.save_id} onOpen={openChat} />

        <ReelSections
          saveId={ticket.save_id}
          fields={fields}
          unverified={unverified}
          servings={shownServings}
          onServings={setServings}
        />

        {recipe && (recipe.ingredients?.length ?? 0) > 0 && !reading && <NutritionPanel saveId={ticket.save_id} />}

        {/* How it was read and planned: there when wanted, one closed row otherwise. */}
        <details className="said fold" ref={foldRef}>
          <summary>
            <span className="fold-label">
              Details
              <small>
                {transcript.length > 0 ? "The transcript, and how" : "How"} {appName} read and planned this
              </small>
            </span>
            <Icon name="down" />
          </summary>
          <ul className="read">
            {details.caption?.trim() && (
              <li>
                <span className="src">Caption</span>
                <span className="how">Used</span>
              </li>
            )}
            {onScreen.length > 0 && (
              <li>
                <span className="src">On-screen text</span>
                <span className="how">{plural(onScreen.length, "line", "lines")}</span>
              </li>
            )}
            {(transcript.length > 0 || watched || enriching) && (
              <li>
                <span className="src">Voiceover</span>
                <span className="how">
                  {transcript.length > 0
                    ? plural(transcript.length, "line", "lines")
                    : enriching
                      ? "Still watching the video"
                      : "No speech"}
                </span>
              </li>
            )}
            {details.enrich_error && (
              <li>
                <span className="src">Video</span>
                <span className="how">Couldn&apos;t watch it: {details.enrich_error.replace(/\.$/, "")}. The plan uses the caption.</span>
              </li>
            )}
          </ul>
          {unverified.length > 0 && (
            <ul className="unsure">
              {unverified.map((u) => (
                <li key={u}>
                  <Icon name="alert" />
                  <span>Couldn&apos;t confirm: {u}</span>
                </li>
              ))}
            </ul>
          )}

          {transcript.length > 0 && (
            <details className="said" ref={saidRef}>
              <summary>
                What&apos;s said in the video
                <Icon name="down" />
              </summary>
              <ul className="lines">
                {transcript.map((line, i) => (
                  <li key={i} className={i === atLine ? "is-at" : undefined}>
                    <time>{clock(line.start_sec)}</time>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {onScreen.length > 0 && (
            <details className="said">
              <summary>
                What&apos;s written on screen
                <Icon name="down" />
              </summary>
              <ul className="lines plain">
                {onScreen.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </details>
          )}
          <details className="said">
            <summary>
              How it was planned
              <Icon name="down" />
            </summary>
            <div className="said-body">
              <AgentTrace runs={runs} live={working} emptyText={ticket.is_sample ? SEEDED_SAMPLE_NOTE : undefined} />
            </div>
          </details>
        </details>

        {ticket.processing !== "failed" && (
          <div className="reanalyze">
            <button type="button" className="text-btn" disabled={busy || working} onClick={() => void reanalyze()}>
              <Icon name="redo" />
              {working ? "Reading it again" : "Reanalyze and re-sort"}
            </button>
          </div>
        )}
      </article>

      {/* File under */}
      <Sheet open={sheet === "cat"} onOpenChange={(open) => setSheet(open ? "cat" : null)}>
        <SheetContent aria-describedby={undefined}>
          <SheetHead>File under</SheetHead>
          <ul className="opts">
            {KIND_ORDER.map((t) => {
              const k = KINDS[t];
              return (
                <li key={t}>
                  <button
                    type="button"
                    className="opt"
                    aria-pressed={t === type}
                    disabled={busy}
                    onClick={() => void fileUnder(t)}
                  >
                    <span className="opt-ico" style={tint(k.color)}>
                      <Icon name={k.icon} />
                    </span>
                    <span className="opt-name">{k.label}</span>
                    <Icon name="check" />
                  </button>
                </li>
              );
            })}
          </ul>
          {kind && type && (
            <>
              <h3 className="sheet-title" style={{ marginTop: 18, minHeight: 44, display: "flex", alignItems: "center" }}>
                Sub-category in {kind.label}
              </h3>
              <ul className="opts">
                {(tastes.data?.tastes.find((t) => t.type === type)?.subcategories ?? []).map((s) => (
                  <li key={s.name}>
                    <button
                      type="button"
                      className="opt"
                      aria-pressed={s.name === ticket.subcategory}
                      disabled={busy}
                      onClick={() => void fileSub(s.name)}
                    >
                      <span className="opt-ico" style={tint(kind.color)}>
                        <Icon name={kind.icon} />
                      </span>
                      <span className="opt-name">{s.name}</span>
                      <Icon name="check" />
                    </button>
                  </li>
                ))}
                {ticket.subcategory && (
                  <li>
                    <button type="button" className="opt" disabled={busy} onClick={() => void fileSub("")}>
                      <span className="opt-ico" style={tint("rose")}>
                        <Icon name="skip" />
                      </span>
                      <span className="opt-name">No sub-category</span>
                    </button>
                  </li>
                )}
              </ul>
              <form
                className="name-field"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newSub.trim()) void fileSub(newSub);
                }}
              >
                <label htmlFor={newSubId} className="vh">
                  New sub-category
                </label>
                <input
                  id={newSubId}
                  type="text"
                  maxLength={32}
                  autoComplete="off"
                  placeholder="New, e.g. Dessert"
                  value={newSub}
                  onChange={(e) => setNewSub(e.target.value)}
                />
                <button type="submit" className="btn" disabled={busy || !newSub.trim()}>
                  Add
                </button>
              </form>
            </>
          )}
          {catError && (
            <p role="alert" className="field-error">
              {catError}
            </p>
          )}
        </SheetContent>
      </Sheet>

      {/* More */}
      <Sheet open={sheet === "more"} onOpenChange={(open) => setSheet(open ? "more" : null)}>
        <SheetContent aria-describedby={undefined}>
          <SheetHead>This save</SheetHead>
          <ul className="opts">
            {ticket.plan && (
              <li>
                <button type="button" className="opt" disabled={busy} onClick={() => void planAgain()}>
                  <span className="opt-ico" style={tint("lavender")}>
                    <Icon name="redo" />
                  </span>
                  <span className="opt-name">Plan again</span>
                </button>
              </li>
            )}
            <li>
              <button type="button" className="opt" disabled={busy} onClick={() => setSheet("delete")}>
                <span className="opt-ico" style={tint("rose")}>
                  <Icon name="trash" />
                </span>
                <span className="opt-name">Delete this save</span>
              </button>
            </li>
          </ul>
        </SheetContent>
      </Sheet>

      {/* Delete, confirmed */}
      <Sheet open={sheet === "delete"} onOpenChange={(open) => setSheet(open ? "delete" : null)}>
        <SheetContent>
          <SheetTitle>Delete this save?</SheetTitle>
          <SheetDescription>Its plan goes too. This can&apos;t be undone.</SheetDescription>
          <div className="sheet-foot">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
              Delete
            </button>
            <SheetClose className="btn">Keep it</SheetClose>
          </div>
        </SheetContent>
      </Sheet>

      {recipe && (
        <CookMode
          open={cooking}
          onOpenChange={setCooking}
          title={title}
          ingredients={groceries}
          steps={recipe.steps ?? []}
          servings={shownServings}
        />
      )}

      <ReelChat
        open={chatOpen}
        onOpenChange={setChatOpen}
        saveId={ticket.save_id}
        title={title}
        type={type}
        thumbUrl={ticket.thumb_url}
        discussionId={discussionId}
        onDiscussionId={setDiscussionId}
        onJump={setAtSec}
      />

      <GrocerySheet
        open={sheet === "grocery"}
        onOpenChange={(open) => setSheet(open ? "grocery" : null)}
        title={title}
        ingredients={groceries}
        servings={shownServings}
      />
    </>
  );
}
