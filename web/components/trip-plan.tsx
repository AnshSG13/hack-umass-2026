"use client";

// The trip plan for a place or event reel, on the Reel page under the plan card: build it,
// watch it build, then a card per day with its stops, the forecast, and a link to the
// source next to every price, opening time and booking note. Every label, time, date and
// link comes from the server (GET /api/saves/{id}/trip) and is shown as sent. A fact that
// arrives without its source is left out.

import { useId, useRef, useState, type CSSProperties } from "react";
import useSWR from "swr";
import { StepLines } from "@/components/agent-activity";
import { Icon, type IconName } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHead, SheetTitle } from "@/components/ui/sheet";
import { api, ApiError, fetcher } from "@/lib/api";
import { kindTint, tint } from "@/lib/kinds";
import type { SaveType, Trip, TripDay, TripDayDetail, TripState, TripStop } from "@/lib/types";

const POLL_MS = 1500;

type LinkedSource = { title: string; url: string } | null | undefined;

/** True while the plan, or any one day's detail, is being built. */
function building(state: TripState | undefined): boolean {
  if (!state) return false;
  return state.status === "building" || (state.trip?.days ?? []).some((d) => d.detail_status === "building");
}

function has(text: string | null | undefined, source: LinkedSource): source is { title: string; url: string } {
  return Boolean(text && source?.url);
}

/** A source, as a small link that opens in a new tab. */
function Src({ source, named = false }: { source: LinkedSource; named?: boolean }) {
  // `named` is for a link the words before it already introduce ("Forecast: ...").
  if (!source?.url) return null;
  const title = (source.title ?? "").trim();
  // The arrow is tied to the title's last word, so it never wraps to a line of its own.
  const cut = title.lastIndexOf(" ") + 1;
  return (
    <>
      {" "}
      <a className="trip-src" href={source.url} target="_blank" rel="noopener noreferrer">
        {title && !named && <span className="vh">Source: </span>}
        {title.slice(0, cut)}
        <span className="trip-src-end">
          {title.slice(cut) || "Source"}
          <Icon name="out" />
        </span>
      </a>
    </>
  );
}

function weatherLine(w: NonNullable<TripDay["weather"]>): string {
  const temps = `${w.high}° / ${w.low}°${w.unit}`;
  const line = w.text ? `${w.text}, ${temps}` : temps;
  return w.rain_chance !== null ? `${line} · ${w.rain_chance}% rain` : line;
}

// ---- one stop on the day's rail ----

function Stop({ stop, reelTint }: { stop: TripStop; reelTint: CSSProperties | undefined }) {
  const facts: { icon: IconName; text: string; source: LinkedSource; must?: boolean }[] = [];
  if (has(stop.cost, stop.cost_source)) facts.push({ icon: "tag", text: stop.cost, source: stop.cost_source });
  if (has(stop.hours, stop.hours_source)) facts.push({ icon: "clock", text: stop.hours, source: stop.hours_source });
  if (stop.booking === "required" && stop.booking_source?.url) {
    facts.push({ icon: "alert", text: "Booking required", source: stop.booking_source, must: true });
  } else if (stop.booking === "recommended" && stop.booking_source?.url) {
    facts.push({ icon: "cal", text: "Booking recommended", source: stop.booking_source });
  }
  const when = stop.time || stop.part;

  return (
    <li className={stop.from_reel ? "trip-stop" : "trip-stop is-added"}>
      {(when || stop.area) && (
        <p className="trip-stop-top">
          {when && <span className="trip-time">{when}</span>}
          {stop.time && <Src source={stop.time_source} />}
          {stop.area && <span className="trip-area">{stop.area}</span>}
        </p>
      )}
      <h4 className="trip-name">
        {stop.maps_url ? (
          <a href={stop.maps_url} target="_blank" rel="noopener noreferrer">
            <span>
              {stop.name}
              <span className="vh"> on the map</span>
            </span>
            <Icon name="pin" />
          </a>
        ) : (
          stop.name
        )}
      </h4>
      <p className="trip-origin">
        {stop.from_reel ? (
          <span className="kind" style={reelTint ?? tint("mint")}>
            From the reel
          </span>
        ) : (
          <>
            <span className="kind trip-added">Added</span>
            <Src source={stop.source} />
          </>
        )}
      </p>
      {stop.what && <p className="trip-what">{stop.what}</p>}
      {facts.length > 0 && (
        <ul className="trip-facts">
          {facts.map((f) => (
            <li key={f.icon} className={f.must ? "is-must" : undefined}>
              <Icon name={f.icon} />
              <span>
                <span className="trip-fact">{f.text}</span>
                <Src source={f.source} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {stop.gcal_url && (
        <a className="trip-link" href={stop.gcal_url} target="_blank" rel="noopener noreferrer">
          <Icon name="cal" />
          <span>
            Add to calendar<span className="vh">: {stop.name}</span>
          </span>
        </a>
      )}
      {stop.next_directions_url && (
        <a className="trip-link trip-leg" href={stop.next_directions_url} target="_blank" rel="noopener noreferrer">
          <Icon name="down" />
          <span>
            Directions<span className="vh"> from {stop.name} to the next stop</span>
          </span>
        </a>
      )}
    </li>
  );
}

// ---- a day opened in detail ----

function DayDetail({ detail }: { detail: TripDayDetail }) {
  const stops = detail.stops
    .map((s) => ({
      name: s.name,
      highlights: s.highlights.filter((h) => has(h.text, h.source)),
      book: has(s.book, s.book_source) ? { text: s.book, source: s.book_source } : null,
    }))
    .filter((s) => s.highlights.length > 0 || s.book);
  const eat = detail.eat.filter((e) => e.name);
  const rain = detail.rain?.text ? detail.rain : null;
  const around = detail.around?.text ? detail.around : null;

  if (stops.length === 0 && eat.length === 0 && !rain && !around) {
    return (
      <div className="trip-detail">
        <p className="trip-text" style={{ marginTop: 0 }}>
          Nothing more turned up for this day.
        </p>
      </div>
    );
  }

  return (
    <div className="trip-detail">
      {stops.map((s, i) => (
        <div key={`${i}:${s.name}`} className="trip-block">
          <h4 className="trip-sub">{s.name}</h4>
          {s.highlights.length > 0 && (
            <ul className="trip-points">
              {s.highlights.map((h, j) => (
                <li key={j}>
                  <span className="trip-fact">{h.text}</span>
                  <Src source={h.source} />
                </li>
              ))}
            </ul>
          )}
          {s.book && (
            <p className="trip-book">
              <Icon name="cal" />
              <span>
                <span className="trip-fact">{s.book.text}</span>
                <Src source={s.book.source} />
              </span>
            </p>
          )}
        </div>
      ))}
      {eat.length > 0 && (
        <div className="trip-block">
          <h4 className="trip-sub">Where to eat nearby</h4>
          <ul className="trip-points">
            {eat.map((e, i) => (
              <li key={`${i}:${e.name}`}>
                <span className="trip-eat">
                  {e.maps_url ? (
                    <a href={e.maps_url} target="_blank" rel="noopener noreferrer">
                      {e.name}
                      <span className="vh"> on the map</span>
                    </a>
                  ) : (
                    <b>{e.name}</b>
                  )}
                  {e.near && <span className="trip-near"> · {e.near}</span>}
                </span>
                {e.why && <span className="trip-fact">{e.why}</span>}
                <Src source={e.source} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {rain && (
        <div className="trip-block">
          <h4 className="trip-sub">If it rains</h4>
          <p className="trip-text">
            <span className="trip-fact">{rain.text}</span>
            <Src source={rain.source} />
          </p>
        </div>
      )}
      {around && (
        <div className="trip-block">
          <h4 className="trip-sub">Getting around</h4>
          <p className="trip-text">
            <span className="trip-fact">{around.text}</span>
            <Src source={around.source} />
          </p>
        </div>
      )}
    </div>
  );
}

// ---- one day ----

function Day({
  id,
  day,
  reelTint,
  busy,
  problem,
  onOpen,
}: {
  id: string;
  day: TripDay;
  reelTint: CSSProperties | undefined;
  busy: boolean;
  /** Why the last request to open this day was turned down, if it was. */
  problem: string | null;
  onOpen: () => void;
}) {
  const w = day.weather;
  const ready = day.detail_status === "ready" && day.detail !== null;

  return (
    <li>
      <article className="trip-day" id={id} tabIndex={-1} aria-labelledby={`${id}-h`}>
        <h3 id={`${id}-h`}>
          <span className="trip-day-label">{day.label}</span>
          {day.title && <span className="trip-day-title">{day.title}</span>}
        </h3>
        {w && (
          <p className={w.wet ? "trip-wx is-wet" : "trip-wx"}>
            {w.wet && <Icon name="umbrella" />}
            <span>{weatherLine(w)}</span>
          </p>
        )}

        {day.stops.length > 0 && (
          <ol className="trip-stops">
            {day.stops.map((stop, i) => (
              <Stop key={`${i}:${stop.name}`} stop={stop} reelTint={reelTint} />
            ))}
          </ol>
        )}

        {ready && day.detail && <DayDetail detail={day.detail} />}

        <div className="trip-foot">
          {day.detail_status === "none" && (
            <button type="button" className="btn" disabled={busy} onClick={onOpen}>
              <Icon name="spark" />
              <span>
                Plan this day in detail<span className="vh">: {day.label}</span>
              </span>
            </button>
          )}
          {day.detail_status === "building" && (
            <p className="trip-progress">
              <span className="trip-pulse step-dot-current" aria-hidden="true" />
              Planning this day in detail
            </p>
          )}
          {day.detail_status === "failed" && (
            <>
              {day.detail_error && (
                <p role="alert" className="plan-error">
                  {day.detail_error}
                </p>
              )}
              <button type="button" className="btn" disabled={busy} onClick={onOpen}>
                <Icon name="redo" />
                Try again
              </button>
            </>
          )}
          {problem && (
            <p role="alert" className="plan-error">
              {problem}
            </p>
          )}
          {day.ics_url && (
            // A new tab on purpose, as on the plan card: a Home Screen web app has no back
            // button, so the calendar file must not replace the app's own page.
            <a className="trip-link" href={day.ics_url} target="_blank" rel="noopener noreferrer">
              <Icon name="cal" />
              <span>
                Add the day to Apple Calendar<span className="vh">: {day.label}</span>
              </span>
            </a>
          )}
        </div>
      </article>
    </li>
  );
}

// ---- the section ----

export function TripPlan({
  saveId,
  type,
  settled,
}: {
  saveId: string;
  type: SaveType | null;
  /** False while the reel is still being read: there is nothing to plan a trip from yet. */
  settled: boolean;
}) {
  const travel = type === "place" || type === "event";
  const path = `/api/saves/${saveId}/trip`;
  const { data, mutate } = useSWR<TripState>(travel && settled ? path : null, fetcher, {
    refreshInterval: (latest) => (building(latest) ? POLL_MS : 0),
    // SWR drops repeat requests inside its deduping window (2 s by default), which would
    // stretch the 1.5 s poll.
    dedupingInterval: 500,
  });
  const toast = useToast();
  const uid = useId();
  const section = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ at: string; text: string } | null>(null);
  const [sheet, setSheet] = useState<"dates" | "rebuild" | null>(null);

  // For screen readers: what is being built now, and one line when it has finished.
  const trip = data?.status === "ready" ? data.trip : null;
  const dayBuilding = trip?.days.find((d) => d.detail_status === "building");
  const working = data?.status === "building" ? "trip" : dayBuilding ? `day-${dayBuilding.index}` : null;
  const [seen, setSeen] = useState(working);
  const [finished, setFinished] = useState("");
  if (working !== seen) {
    setSeen(working);
    const day = trip?.days.find((d) => `day-${d.index}` === seen);
    setFinished(
      working !== null
        ? ""
        : seen === "trip" && trip
          ? "The trip plan is ready."
          : day?.detail_status === "ready"
            ? `${day.label} is planned in detail.`
            : "",
    );
  }

  if (!travel || !data || !data.can_build) return null;

  const live =
    working === "trip"
      ? "Building the trip plan."
      : dayBuilding
        ? `Planning ${dayBuilding.label} in detail.`
        : finished;

  /** One request that answers with the new TripState. `at` says where its error is shown. */
  async function send(
    at: string,
    method: "POST" | "PATCH",
    url: string,
    body: unknown,
    fallback: string,
  ): Promise<boolean> {
    setBusy(at);
    setProblem(null);
    try {
      const next = await api<TripState>(url, { method, body });
      await mutate(next, false);
      return true;
    } catch (e) {
      setProblem({ at, text: e instanceof ApiError ? e.message : fallback });
      return false;
    } finally {
      setBusy(null);
    }
  }

  // The control that was pressed is gone once a build starts, so hand focus to what
  // replaced it instead of letting it fall back to the page.
  function focusOn(el: HTMLElement | null) {
    window.requestAnimationFrame(() => {
      if (!el?.isConnected) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
    });
  }

  async function build(at: "build" | "rebuild") {
    if (!(await send(at, "POST", path, {}, "The trip plan didn't start. Try again."))) return;
    setSheet(null);
    focusOn(section.current);
  }

  async function moveDates(startDate: string) {
    if (startDate === trip?.start_date) {
      setSheet(null);
      return;
    }
    const body = { start_date: startDate };
    if (!(await send("dates", "PATCH", path, body, "The dates didn't change. Try again."))) return;
    setSheet(null);
    toast.show("Dates changed.");
  }

  async function openDay(index: number) {
    const at = `day-${index}`;
    if (!(await send(at, "POST", `${path}/days/${index}`, undefined, "That day didn't start. Try again."))) return;
    focusOn(document.getElementById(`${uid}-day-${index}`));
  }

  const idle = busy === null;
  const problemAt = (at: string) => (problem?.at === at ? problem.text : null);

  return (
    <section className="trip" ref={section} tabIndex={-1} aria-label="Trip plan">
      <p className="vh" role="status">
        {live}
      </p>

      {data.status === "none" && (
        <div className="plan">
          <p className="plan-label">
            <Icon name="travel" />
            Trip plan
          </p>
          <p className="plan-line">Turn this into a day-by-day trip</p>
          <p className="plan-why">
            Finds what&apos;s nearby, what it costs and the forecast, each with its source.
          </p>
          <div className="plan-btns">
            <button type="button" className="btn btn-primary" disabled={!idle} onClick={() => void build("build")}>
              {busy === "build" ? "Starting" : "Build the trip plan"}
            </button>
          </div>
          {problemAt("build") && (
            <p role="alert" className="plan-error">
              {problemAt("build")}
            </p>
          )}
        </div>
      )}

      {data.status === "building" && (
        <div className="plan" style={tint("lavender")}>
          <p className="plan-label">
            <Icon name="spark" />
            Building the trip plan
          </p>
          {data.steps.length > 0 && (
            <div className="plan-steps">
              <StepLines steps={data.steps} live />
            </div>
          )}
          <p className="plan-why">This takes a moment. You can keep reading.</p>
        </div>
      )}

      {data.status === "failed" && (
        <div className="plan" style={tint("rose")}>
          <p className="plan-label">
            <Icon name="alert" />
            Trip plan
          </p>
          {data.error && (
            <p className="plan-why" style={{ color: "var(--ink)" }}>
              {data.error}
            </p>
          )}
          <div className="plan-btns">
            <button type="button" className="btn" disabled={!idle} onClick={() => void build("build")}>
              <Icon name="redo" />
              {busy === "build" ? "Starting" : "Try again"}
            </button>
          </div>
          {problemAt("build") && (
            <p role="alert" className="plan-error">
              {problemAt("build")}
            </p>
          )}
        </div>
      )}

      {trip && (
        <TripReady
          uid={uid}
          trip={trip}
          reelTint={kindTint(type)}
          busy={!idle}
          dayProblem={(index) => problemAt(`day-${index}`)}
          onOpenDay={(index) => void openDay(index)}
          onChangeDates={() => {
            setProblem(null);
            setSheet("dates");
          }}
          onRebuild={() => {
            setProblem(null);
            setSheet("rebuild");
          }}
        />
      )}

      {/* Change dates */}
      {trip && !trip.dates_fixed && (
        <Sheet open={sheet === "dates"} onOpenChange={(open) => setSheet(open ? "dates" : null)}>
          <SheetContent>
            <SheetHead>Change dates</SheetHead>
            <SheetDescription>
              {/* The first dates are picked around the person's week, so they may not be in the list. */}
              {trip.date_label && !trip.date_options.some((o) => o.start_date === trip.start_date)
                ? `Now ${trip.date_label}. `
                : ""}
              The stops stay the same. The times and the forecast follow the new dates.
            </SheetDescription>
            <ul className="opts">
              {trip.date_options.map((o) => (
                <li key={o.start_date}>
                  <button
                    type="button"
                    className="opt"
                    aria-pressed={o.start_date === trip.start_date}
                    disabled={!idle}
                    onClick={() => void moveDates(o.start_date)}
                  >
                    <span className="opt-ico">
                      <Icon name="cal" />
                    </span>
                    <span className="opt-name tabular">{o.label}</span>
                    <Icon name="check" />
                  </button>
                </li>
              ))}
            </ul>
            {problemAt("dates") && (
              <p role="alert" className="field-error">
                {problemAt("dates")}
              </p>
            )}
          </SheetContent>
        </Sheet>
      )}

      {/* Rebuild, confirmed */}
      {trip && (
        <Sheet open={sheet === "rebuild"} onOpenChange={(open) => setSheet(open ? "rebuild" : null)}>
          <SheetContent>
            <SheetTitle>Rebuild the trip plan?</SheetTitle>
            <SheetDescription>
              A new plan replaces this one, including any day you planned in detail.
            </SheetDescription>
            {problemAt("rebuild") && (
              <p role="alert" className="field-error">
                {problemAt("rebuild")}
              </p>
            )}
            <div className="sheet-foot">
              <button type="button" className="btn btn-primary" disabled={!idle} onClick={() => void build("rebuild")}>
                {busy === "rebuild" ? "Starting" : "Rebuild the plan"}
              </button>
              <SheetClose className="btn">Keep this plan</SheetClose>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </section>
  );
}

function TripReady({
  uid,
  trip,
  reelTint,
  busy,
  dayProblem,
  onOpenDay,
  onChangeDates,
  onRebuild,
}: {
  uid: string;
  trip: Trip;
  reelTint: CSSProperties | undefined;
  busy: boolean;
  dayProblem: (index: number) => string | null;
  onOpenDay: (index: number) => void;
  onChangeDates: () => void;
  onRebuild: () => void;
}) {
  const heads = trip.heads_up.filter((h) => h.text);
  const stay = trip.stay && trip.stay.area ? trip.stay : null;

  return (
    <>
      <div className="trip-head">
        <div className="trip-head-main">
          {trip.city && (
            <p className="plan-label">
              <Icon name="travel" />
              Trip plan
            </p>
          )}
          <h2 className="sec-title trip-city">{trip.city || "Trip plan"}</h2>
          {trip.date_label && <p className="trip-dates">{trip.date_label}</p>}
        </div>
        {!trip.dates_fixed && trip.date_options.length > 0 && (
          <button type="button" className="trip-change" aria-haspopup="dialog" onClick={onChangeDates}>
            <Icon name="cal" />
            Change dates
          </button>
        )}
      </div>

      {trip.weather_note && <p className="trip-meta">{trip.weather_note}</p>}
      {trip.weather_source?.url && (
        <p className="trip-meta">
          Forecast: <Src source={trip.weather_source} named />
        </p>
      )}

      {heads.length > 0 && (
        <ul className="trip-heads" aria-label="Heads up">
          {heads.map((h, i) => (
            <li key={i}>
              <Icon name="alert" />
              <span>
                <span className="trip-fact">{h.text}</span>
                <Src source={h.source} />
              </span>
            </li>
          ))}
        </ul>
      )}

      <ol className="trip-days">
        {trip.days.map((day) => (
          <Day
            key={day.index}
            id={`${uid}-day-${day.index}`}
            day={day}
            reelTint={reelTint}
            busy={busy}
            problem={dayProblem(day.index)}
            onOpen={() => onOpenDay(day.index)}
          />
        ))}
      </ol>

      {stay && (
        <div className="trip-stay">
          <p className="plan-label">
            <Icon name="home" />
            Where to stay
          </p>
          <p className="card-name">{stay.area}</p>
          {(stay.why || stay.source?.url) && (
            <p className="trip-text">
              {stay.why && <span className="trip-fact">{stay.why}</span>}
              <Src source={stay.source} />
            </p>
          )}
          {stay.maps_url && (
            <a className="trip-link" href={stay.maps_url} target="_blank" rel="noopener noreferrer">
              <Icon name="out" />
              Find places to stay
            </a>
          )}
        </div>
      )}

      {trip.times_note && <p className="trip-meta">{trip.times_note}</p>}

      {trip.sources.length > 0 && (
        <details className="said">
          <summary>
            <span>
              Sources <span className="trip-count">{trip.sources.length}</span>
            </span>
            <Icon name="down" />
          </summary>
          <ol className="trip-sources">
            {trip.sources.map((s) => (
              <li key={s.n}>
                <span className="n">{s.n}</span>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}

      <button type="button" className="text-btn trip-rebuild" disabled={busy} onClick={onRebuild}>
        <Icon name="redo" />
        Rebuild the plan
      </button>
    </>
  );
}
