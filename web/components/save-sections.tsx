"use client";

// Type sections on the save detail (DESIGN.md 7.5). Everything shown is what the agent
// pulled from the reel; names it couldn't find in the video carry a warning.

import { TriangleAlert } from "lucide-react";
import { ingredientLine } from "@/lib/format";
import { linkInk, sectionTitle } from "@/lib/styles";
import type { Fields } from "@/lib/types";
import { cn } from "@/lib/utils";

function Unverified() {
  return (
    <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink">
      <TriangleAlert aria-hidden="true" className="size-[14px] shrink-0" />
      Not found in the video. Double check.
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className={sectionTitle}>{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[16px] text-ink marker:text-line-strong">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

/** "Thursday, Nov 19, 6:30 pm" from a local "YYYY-MM-DDTHH:mm" (midnight means no time was given). */
function eventDate(start?: string): string | null {
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

export function SaveSections({ fields, unverified }: { fields: Fields; unverified: string[] }) {
  const flagged = new Set(unverified.map((u) => u.trim().toLowerCase()));
  const isUnverified = (name?: string) => Boolean(name && flagged.has(name.trim().toLowerCase()));

  const { recipe, event, place, workout, product, tip } = fields;

  return (
    <>
      {recipe && (
        <>
          {(recipe.ingredients?.length ?? 0) > 0 && (
            <Section title="Ingredients">
              {(recipe.servings || recipe.total_time_min) && (
                <p className="mb-2 text-[13px] text-muted">
                  {[recipe.servings ? `Serves ${recipe.servings}` : null, recipe.total_time_min ? `${recipe.total_time_min} min` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <ul className="flex flex-col gap-1.5 text-[16px] text-ink">
                {recipe.ingredients!.map((ing, i) => (
                  <li key={i}>
                    {ingredientLine(ing)}
                    {isUnverified(ing.item) && <Unverified />}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {(recipe.steps?.length ?? 0) > 0 && (
            <Section title="Steps">
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-[16px] text-ink marker:font-semibold">
                {recipe.steps!.map((s, i) => (
                  <li key={i} className="pl-1">
                    {s}
                  </li>
                ))}
              </ol>
            </Section>
          )}
          {(recipe.tips?.length ?? 0) > 0 && (
            <Section title="Tips">
              <Bullets items={recipe.tips!} />
            </Section>
          )}
        </>
      )}

      {event && (event.name || event.venue || event.date_text || event.start_local || event.ticket_url) && (
        <Section title="Event">
          <dl className="flex flex-col gap-2 text-[16px] text-ink">
            {event.name && (
              <div>
                <dt className="sr-only">Name</dt>
                <dd className="font-medium">
                  {event.name}
                  {isUnverified(event.name) && <Unverified />}
                </dd>
              </div>
            )}
            {(event.date_text || event.start_local) && (
              <div>
                <dt className="text-[13px] text-muted">Date</dt>
                {/* The reel's own wording first; the normalized date only when there is none. */}
                <dd>{event.date_text || eventDate(event.start_local)}</dd>
              </div>
            )}
            {(event.venue || event.city) && (
              <div>
                <dt className="text-[13px] text-muted">Venue</dt>
                <dd>
                  {[event.venue, event.city].filter(Boolean).join(", ")}
                  {isUnverified(event.venue) && <Unverified />}
                </dd>
              </div>
            )}
            {event.price_hint && (
              <div>
                <dt className="text-[13px] text-muted">Price</dt>
                <dd>{event.price_hint}</dd>
              </div>
            )}
          </dl>
          {event.ticket_url && (
            <a
              className={cn(linkInk, "inline-flex min-h-11 items-center text-[16px]")}
              href={event.ticket_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Tickets
            </a>
          )}
        </Section>
      )}

      {place && (place.places?.length ?? 0) > 0 && (
        <Section title={place.places!.length === 1 ? "Place" : "Places"}>
          <ul className="flex flex-col gap-4">
            {place.places!.map((p, i) => (
              <li key={i} className="text-[16px] text-ink">
                <p className="font-semibold">{p.name}</p>
                {(p.kind || p.city) && (
                  <p className="text-[13px] text-muted">{[p.kind, p.city].filter(Boolean).join(" · ")}</p>
                )}
                {isUnverified(p.name) && <Unverified />}
                {p.why && <p className="mt-1">{p.why}</p>}
                {p.tip && <p className="mt-1 text-[14px] text-muted">Tip: {p.tip}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {workout && (workout.exercises?.length ?? 0) > 0 && (
        <Section title="Workout">
          {(workout.goal || workout.duration_min || (workout.equipment?.length ?? 0) > 0) && (
            <p className="mb-2 text-[13px] text-muted">
              {[
                workout.goal,
                workout.duration_min ? `${workout.duration_min} min` : null,
                workout.equipment?.length ? workout.equipment.join(", ") : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {workout.exercises!.map((ex, i) => {
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
              const row = [ex.name, dose, ex.rest_sec ? `rest ${ex.rest_sec} s` : null].filter(Boolean).join(" · ");
              return (
                <li key={i} className="text-[16px] text-ink">
                  <p className="tabular">{row}</p>
                  {isUnverified(ex.name) && <Unverified />}
                  {(ex.cues?.length ?? 0) > 0 && <p className="text-[14px] text-muted">{ex.cues!.join(" ")}</p>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {product && (product.items?.length ?? 0) > 0 && (
        <Section title={product.items!.length === 1 ? "Product" : "Products"}>
          <ul className="flex flex-col gap-4">
            {product.items!.map((it, i) => (
              <li key={i} className="text-[16px] text-ink">
                <p className="font-semibold">{[it.brand, it.name].filter(Boolean).join(" ")}</p>
                {it.price_hint && <p className="text-[13px] text-muted">{it.price_hint}</p>}
                {isUnverified(it.name) && <Unverified />}
                {it.why && <p className="mt-1">{it.why}</p>}
                {it.where_to_buy && (
                  <p className="mt-1 text-[14px] text-muted">
                    Where to buy:{" "}
                    {it.url ? (
                      <a className="text-ink underline underline-offset-4" href={it.url} target="_blank" rel="noopener noreferrer">
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
        </Section>
      )}

      {tip && ((tip.key_points?.length ?? 0) > 0 || tip.takeaway) && (
        <Section title={tip.topic || "Key points"}>
          {(tip.key_points?.length ?? 0) > 0 && <Bullets items={tip.key_points!} />}
          {tip.takeaway && (
            <p className="mt-3 text-[16px] text-ink">
              <span className="font-semibold">Takeaway: </span>
              {tip.takeaway}
            </p>
          )}
        </Section>
      )}
    </>
  );
}
