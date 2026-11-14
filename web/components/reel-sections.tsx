"use client";

// What was pulled out of the reel, by type, in the Reel page's section style. A recipe
// gets the mockup's ingredients (servings stepper, tap to tick), steps and tips; the other
// types reuse the same parts. Names that weren't found in the video carry a flag.

import { useState } from "react";
import { Icon } from "@/components/icons";
import { eventDate, ingredientParts, scaleIngredient } from "@/lib/format";
import { tint } from "@/lib/kinds";
import type { Fields, Ingredient } from "@/lib/types";

type Recipe = NonNullable<Fields["recipe"]>;

function Unverified() {
  return (
    <span className="flag">
      <Icon name="alert" />
      Not found in the video. Double check.
    </span>
  );
}

// ---- ticks, remembered per save on this device ----

function ticksKey(saveId: string): string {
  return `rl_ticks_${saveId}`;
}

function readTicks(saveId: string): string[] {
  try {
    const raw = window.localStorage.getItem(ticksKey(saveId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeTicks(saveId: string, ticks: string[]): void {
  try {
    if (ticks.length === 0) window.localStorage.removeItem(ticksKey(saveId));
    else window.localStorage.setItem(ticksKey(saveId), JSON.stringify(ticks));
  } catch {
    /* private mode or a full store: the ticks just don't outlive the page */
  }
}

function tickId(index: number, ing: Ingredient): string {
  return `${index}:${ing.item}`;
}

/** The highest number of servings the stepper goes to. */
export function maxServings(base: number): number {
  return Math.max(12, base * 4);
}

function Ingredients({
  saveId,
  recipe,
  servings,
  onServings,
  isUnverified,
}: {
  saveId: string;
  recipe: Recipe;
  servings: number | null;
  onServings: (n: number) => void;
  isUnverified: (name?: string) => boolean;
}) {
  const [ticks, setTicks] = useState<string[]>(() => readTicks(saveId));
  const base = recipe.servings && recipe.servings > 0 ? recipe.servings : null;
  const shown = servings ?? base;
  const list = recipe.ingredients ?? [];

  function toggle(id: string, on: boolean) {
    const next = on ? [...ticks.filter((t) => t !== id), id] : ticks.filter((t) => t !== id);
    setTicks(next);
    writeTicks(saveId, next);
  }

  return (
    <section className="sec" aria-labelledby="ing-h">
      <div className="sec-head">
        <h2 className="sec-title" id="ing-h">
          Ingredients
        </h2>
        {base !== null && shown !== null && (
          <div className="stepper" role="group" aria-label="Servings">
            <button type="button" aria-label="Fewer servings" disabled={shown <= 1} onClick={() => onServings(shown - 1)}>
              <Icon name="minus" />
            </button>
            <output aria-live="polite">{shown === 1 ? "1 serving" : `${shown} servings`}</output>
            <button
              type="button"
              aria-label="More servings"
              disabled={shown >= maxServings(base)}
              onClick={() => onServings(shown + 1)}
            >
              <Icon name="plus" />
            </button>
          </div>
        )}
      </div>
      <ul className="ings">
        {list.map((ing, i) => {
          const id = tickId(i, ing);
          const scaled = base !== null && shown !== null ? scaleIngredient(ing, shown, base) : ing;
          const { qty, name } = ingredientParts(scaled);
          return (
            <li key={id}>
              <label className="ing">
                <input type="checkbox" checked={ticks.includes(id)} onChange={(e) => toggle(id, e.target.checked)} />
                <span className="tick">
                  <Icon name="check" />
                </span>
                <span className="ing-text">
                  {qty && <span className="ing-qty">{qty} </span>}
                  <span className="ing-name">{name}</span>
                  {isUnverified(ing.item) && <Unverified />}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function exerciseDose(ex: { sets?: number; reps?: string; duration_sec?: number; rest_sec?: number }): string {
  const dose =
    ex.sets && ex.reps
      ? `${ex.sets} × ${ex.reps}`
      : ex.sets && ex.duration_sec
        ? `${ex.sets} × ${ex.duration_sec} s`
        : ex.reps
          ? /^\d+$/.test(ex.reps.trim())
            ? `${ex.reps.trim()} reps`
            : ex.reps
          : ex.duration_sec
            ? `${ex.duration_sec} s`
            : ex.sets
              ? `${ex.sets} sets`
              : null;
  return [dose, ex.rest_sec ? `rest ${ex.rest_sec} s` : null].filter(Boolean).join(" · ");
}

export function ReelSections({
  saveId,
  fields,
  unverified,
  servings,
  onServings,
}: {
  saveId: string;
  fields: Fields;
  unverified: string[];
  /** Servings picked on this page; null means the recipe's own number. */
  servings: number | null;
  onServings: (n: number) => void;
}) {
  const flagged = new Set(unverified.map((u) => u.trim().toLowerCase()));
  const isUnverified = (name?: string) => Boolean(name && flagged.has(name.trim().toLowerCase()));
  const { recipe, event, place, workout, product, tip } = fields;

  return (
    <>
      {recipe && (
        <>
          {(recipe.ingredients?.length ?? 0) > 0 && (
            <Ingredients
              saveId={saveId}
              recipe={recipe}
              servings={servings}
              onServings={onServings}
              isUnverified={isUnverified}
            />
          )}
          {((recipe.steps?.length ?? 0) > 0 || (recipe.tips?.length ?? 0) > 0) && (
            <section className="sec" aria-labelledby="steps-h">
              <h2 className="sec-title" id="steps-h">
                {(recipe.steps?.length ?? 0) > 0 ? "Steps" : "Tips"}
              </h2>
              {(recipe.steps?.length ?? 0) > 0 && (
                <ol className="steps">
                  {recipe.steps!.map((s, i) => (
                    <li key={i}>
                      <p>{s}</p>
                    </li>
                  ))}
                </ol>
              )}
              {(recipe.tips ?? []).map((text, i) => (
                <div className="tip" key={i}>
                  <span className="tip-mark" aria-hidden="true">
                    <Icon name="tip" />
                  </span>
                  <p>{text}</p>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {event && (event.name || event.venue || event.date_text || event.start_local || event.ticket_url) && (
        <section className="sec" aria-labelledby="event-h">
          <h2 className="sec-title" id="event-h">
            Event
          </h2>
          <ul className="read">
            {event.name && (
              <li>
                <span className="src">Name</span>
                <span className="how">
                  {event.name}
                  {isUnverified(event.name) && <Unverified />}
                </span>
              </li>
            )}
            {(event.date_text || event.start_local) && (
              <li>
                <span className="src">Date</span>
                {/* The reel's own wording first; the normalized date only when there is none. */}
                <span className="how">{event.date_text || eventDate(event.start_local)}</span>
              </li>
            )}
            {(event.venue || event.city) && (
              <li>
                <span className="src">Venue</span>
                <span className="how">
                  {[event.venue, event.city].filter(Boolean).join(", ")}
                  {isUnverified(event.venue) && <Unverified />}
                </span>
              </li>
            )}
            {event.price_hint && (
              <li>
                <span className="src">Price</span>
                <span className="how">{event.price_hint}</span>
              </li>
            )}
          </ul>
          {event.ticket_url && (
            <div className="actions" style={{ marginTop: 12 }}>
              <a className="btn" href={event.ticket_url} target="_blank" rel="noopener noreferrer">
                <Icon name="out" />
                Tickets
              </a>
            </div>
          )}
        </section>
      )}

      {place && (place.places?.length ?? 0) > 0 && (
        <section className="sec" aria-labelledby="places-h">
          <h2 className="sec-title" id="places-h">
            {place.places!.length === 1 ? "Place" : "Places"}
          </h2>
          <ul className="cards">
            {place.places!.map((p, i) => (
              <li key={i} className="card">
                <p className="card-name">{p.name}</p>
                {(p.kind || p.city) && <p className="card-meta">{[p.kind, p.city].filter(Boolean).join(" · ")}</p>}
                {isUnverified(p.name) && <Unverified />}
                {p.why && <p className="card-text">{p.why}</p>}
                {p.tip && (
                  <p className="card-text">
                    <b style={{ color: "var(--ink)", fontWeight: 600 }}>Tip.</b> {p.tip}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {workout && (workout.exercises?.length ?? 0) > 0 && (
        <section className="sec" aria-labelledby="workout-h">
          <h2 className="sec-title" id="workout-h">
            Workout
          </h2>
          {(workout.goal || (workout.equipment?.length ?? 0) > 0) && (
            <p className="sec-sub">
              {[workout.goal, workout.equipment?.length ? workout.equipment.join(", ") : null].filter(Boolean).join(" · ")}
            </p>
          )}
          <ol className="steps" style={tint("mint")}>
            {workout.exercises!.map((ex, i) => {
              const dose = exerciseDose(ex);
              return (
                <li key={i}>
                  <div>
                    <p className="step-name" style={{ paddingTop: 0 }}>
                      {ex.name}
                    </p>
                    {dose && <p className="step-sub tabular">{dose}</p>}
                    {isUnverified(ex.name) && <Unverified />}
                    {(ex.cues?.length ?? 0) > 0 && <p className="step-sub">{ex.cues!.join(" ")}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {product && (product.items?.length ?? 0) > 0 && (
        <section className="sec" aria-labelledby="products-h">
          <h2 className="sec-title" id="products-h">
            {product.items!.length === 1 ? "Product" : "Products"}
          </h2>
          <ul className="cards">
            {product.items!.map((it, i) => (
              <li key={i} className="card">
                <p className="card-name">{[it.brand, it.name].filter(Boolean).join(" ")}</p>
                {it.price_hint && <p className="card-meta">{it.price_hint}</p>}
                {isUnverified(it.name) && <Unverified />}
                {it.why && <p className="card-text">{it.why}</p>}
                {it.where_to_buy && (
                  <p className="card-text">
                    Where to buy:{" "}
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noopener noreferrer">
                        {it.where_to_buy}
                      </a>
                    ) : (
                      it.where_to_buy
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tip && ((tip.key_points?.length ?? 0) > 0 || tip.takeaway) && (
        <section className="sec" aria-labelledby="tip-h">
          <h2 className="sec-title" id="tip-h">
            {tip.topic || "Key points"}
          </h2>
          {(tip.key_points?.length ?? 0) > 0 && (
            <ol className="steps" style={tint("lavender")}>
              {tip.key_points!.map((point, i) => (
                <li key={i}>
                  <p>{point}</p>
                </li>
              ))}
            </ol>
          )}
          {tip.takeaway && (
            <div className="tip">
              <span className="tip-mark" aria-hidden="true">
                <Icon name="tip" />
              </span>
              <p>
                <b>Takeaway.</b> {tip.takeaway}
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}
