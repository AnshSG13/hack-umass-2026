"use client";

// Recipes are for cooking now, not for booking a slot: the card a recipe gets in place of
// a plan, the nutrition estimate, and cook mode (one step at a time, big type, the screen
// kept awake).

import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { fetcher } from "@/lib/api";
import { ingredientParts, plural } from "@/lib/format";
import type { Ingredient, Nutrition, NutritionResponse, PublishedNutrition } from "@/lib/types";

// ---- the card ----

export function CookCard({
  minutes,
  ingredients,
  steps,
  onCook,
  onShop,
  headline,
}: {
  minutes?: number;
  ingredients: number;
  steps: number;
  onCook: () => void;
  onShop: () => void;
  /** The action's call to action ("Cook this tiramisu tonight"). */
  headline?: string;
}) {
  const bits = [
    minutes ? (minutes >= 90 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`) : null,
    ingredients ? plural(ingredients, "ingredient", "ingredients") : null,
    steps ? plural(steps, "step", "steps") : null,
  ].filter(Boolean);
  return (
    <section className="cook-card" aria-label="Cook this">
      <p className="cook-kicker">
        <Icon name="food" />
        Cook mode
      </p>
      <p className="action-cta">{headline || "Let's cook this"}</p>
      {bits.length > 0 && <p className="cook-facts">{bits.join(" · ")}</p>}
      <div className="cook-btns">
        <button type="button" className="btn btn-primary" onClick={onCook} disabled={steps === 0 && ingredients === 0}>
          Start cooking
        </button>
        {ingredients > 0 && (
          <button type="button" className="btn" onClick={onShop}>
            <Icon name="basket" />
            Shopping list
          </button>
        )}
      </div>
    </section>
  );
}

// ---- nutrition ----

export function NutritionPanel({ saveId }: { saveId: string }) {
  const { data, error, isLoading, mutate } = useSWR<NutritionResponse>(`/api/saves/${saveId}/nutrition`, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const pub = data?.published ?? null;
  const n = pub ? null : (data?.nutrition ?? null);
  const shown = Boolean(pub || n);
  return (
    <section className="sec" aria-labelledby="nut-h">
      <div className="sec-head">
        <h2 className="sec-title" id="nut-h">
          Nutrition
        </h2>
        <span className="pill">{pub?.per === "recipe" ? "Whole recipe" : "Per serving"}</span>
      </div>
      {isLoading && !shown && (
        <div className="nut" role="status">
          <span className="vh">Working out the nutrition</span>
          <span className="skel" style={{ height: 44, width: "46%" }} />
          <span className="skel" style={{ height: 12, width: "100%", marginTop: 16, borderRadius: 12 }} />
        </div>
      )}
      {error && !shown && (
        <p className="msg">
          Nutrition isn&apos;t available for this one right now.{" "}
          <button type="button" className="link" onClick={() => void mutate()}>
            Try again
          </button>
        </p>
      )}
      {pub && <PublishedBody p={pub} />}
      {n && <NutritionBody n={n} />}
    </section>
  );
}

function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The recipe's own published numbers, with where they came from. */
function PublishedBody({ p }: { p: PublishedNutrition }) {
  const v = p.values;
  const rows: [string, string][] = [];
  if (v.protein_g !== undefined) rows.push(["Protein", `${v.protein_g} g`]);
  if (v.carbs_g !== undefined) rows.push(["Carbs", `${v.carbs_g} g`]);
  if (v.fat_g !== undefined) rows.push(["Fat", `${v.fat_g} g`]);
  if (v.fiber_g !== undefined) rows.push(["Fiber", `${v.fiber_g} g`]);
  if (v.sugar_g !== undefined) rows.push(["Sugar", `${v.sugar_g} g`]);
  if (v.sodium_mg !== undefined) rows.push(["Sodium", `${v.sodium_mg.toLocaleString()} mg`]);
  const src = p.sources[0];
  return (
    <Facts kcal={v.calories} split={p.split_pct} rows={rows}>
      Published for this recipe
      {p.per === "serving" && p.servings ? `, which makes ${plural(p.servings, "serving", "servings")}` : ""}
      {src ? (
        <>
          , from{" "}
          <a className="link" href={src.url} target="_blank" rel="noopener noreferrer">
            {siteName(src.url)}
          </a>
        </>
      ) : null}
      .
    </Facts>
  );
}

function NutritionBody({ n }: { n: Nutrition }) {
  const p = n.per_serving;
  const rows: [string, string][] = [
    ["Protein", `${p.protein_g} g`],
    ["Carbs", `${p.carbs_g} g`],
    ["Fat", `${p.fat_g} g`],
    ["Fiber", `${p.fiber_g} g`],
    ["Sugar", `${p.sugar_g} g`],
    ["Sodium", `${p.sodium_mg.toLocaleString()} mg`],
  ];
  return (
    <Facts kcal={p.kcal} split={n.split_pct} rows={rows}>
      An estimate from the ingredients, for {plural(n.servings, "serving", "servings")}
      {n.servings_from === "estimate" ? " (the reel doesn't say how many, so that's a guess too)" : ""}.
      {n.assumed > 0 ? ` ${plural(n.assumed, "ingredient has", "ingredients have")} no amount in the reel, so a typical one was used.` : ""}
    </Facts>
  );
}

function Facts({
  kcal,
  split,
  rows,
  children,
}: {
  kcal: number | undefined;
  split: { protein?: number; carbs?: number; fat?: number };
  rows: [string, string][];
  children: React.ReactNode;
}) {
  return (
    <div className="nut">
      {kcal !== undefined && (
        <p className="nut-kcal">
          <b>{kcal.toLocaleString()}</b> kcal
        </p>
      )}
      {split.protein !== undefined && (
        <>
          <div className="macro-bar" role="img" aria-label={`Calories: ${split.protein}% protein, ${split.carbs}% carbs, ${split.fat}% fat`}>
            <span className="m-p" style={{ flexGrow: split.protein }} />
            <span className="m-c" style={{ flexGrow: split.carbs }} />
            <span className="m-f" style={{ flexGrow: split.fat }} />
          </div>
          <ul className="macro-key" aria-hidden="true">
            <li>
              <i className="m-p" />
              Protein {split.protein}%
            </li>
            <li>
              <i className="m-c" />
              Carbs {split.carbs}%
            </li>
            <li>
              <i className="m-f" />
              Fat {split.fat}%
            </li>
          </ul>
        </>
      )}
      <dl className="nut-rows">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="nut-note">{children}</p>
    </div>
  );
}

// ---- cook mode ----

export function CookMode({
  open,
  onOpenChange,
  title,
  ingredients,
  steps,
  servings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  ingredients: Ingredient[];
  steps: string[];
  servings: number | null;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content className="cook" aria-describedby={undefined}>
          <CookBody title={title} ingredients={ingredients} steps={steps} servings={servings} onClose={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CookBody({
  title,
  ingredients,
  steps,
  servings,
  onClose,
}: {
  title: string;
  ingredients: Ingredient[];
  steps: string[];
  servings: number | null;
  onClose: () => void;
}) {
  // Page 0 is "get these ready"; then one page per step.
  const pages = (ingredients.length > 0 ? 1 : 0) + steps.length;
  const [at, setAt] = useState(0);
  const [have, setHave] = useState<number[]>([]);
  const hasPrep = ingredients.length > 0;
  const stepIndex = hasPrep ? at - 1 : at;
  const last = at === pages - 1;

  // Keep the screen on while cooking. Where the browser can't, cooking still works.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock
      ?.request("screen")
      .then((l) => {
        lock = l;
      })
      .catch(() => {});
    return () => {
      void lock?.release().catch(() => {});
    };
  }, []);

  // Arrow keys on a laptop.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setAt((n) => Math.min(pages - 1, n + 1));
      if (e.key === "ArrowLeft") setAt((n) => Math.max(0, n - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages]);

  return (
    <>
      <header className="cook-head">
        <Dialog.Close className="rc-btn" aria-label="Stop cooking">
          <Icon name="x" />
        </Dialog.Close>
        <Dialog.Title className="cook-title">{title}</Dialog.Title>
        <span className="cook-count" aria-hidden="true">
          {at + 1}/{pages}
        </span>
      </header>
      <div className="cook-dots" aria-hidden="true">
        {Array.from({ length: pages }, (_, i) => (
          <span key={i} className={i < at ? "is-done" : i === at ? "is-now" : undefined} />
        ))}
      </div>

      <div className="cook-page" key={at} aria-live="polite">
        {hasPrep && at === 0 ? (
          <>
            <p className="cook-label">Get these ready{servings ? `, for ${plural(servings, "serving", "servings")}` : ""}</p>
            <ul className="ings cook-ings">
              {ingredients.map((ing, i) => {
                const { qty, name } = ingredientParts(ing);
                return (
                  <li key={i}>
                    <label className="ing">
                      <input
                        type="checkbox"
                        checked={have.includes(i)}
                        onChange={(e) => setHave((h) => (e.target.checked ? [...h, i] : h.filter((x) => x !== i)))}
                      />
                      <span className="tick">
                        <Icon name="check" />
                      </span>
                      <span className="ing-text">
                        {qty && <span className="ing-qty">{qty} </span>}
                        <span className="ing-name">{name}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <p className="cook-label">Step {stepIndex + 1}</p>
            <p className="cook-step">{steps[stepIndex]}</p>
          </>
        )}
      </div>

      <footer className="cook-foot">
        <button type="button" className="btn" disabled={at === 0} onClick={() => setAt((n) => Math.max(0, n - 1))}>
          <Icon name="back" />
          Back
        </button>
        {last ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            <Icon name="check" />
            Done
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setAt((n) => Math.min(pages - 1, n + 1))}>
            {hasPrep && at === 0 ? "Start" : "Next"}
            <Icon name="right" />
          </button>
        )}
      </footer>
    </>
  );
}
