"use client";

// The intro, one question per screen like a video app's onboarding:
//   1. Choose what you like: interest chips, plus more specific ones Gemini suggests
//   2. Your hobbies
//   3. A bit about you: age, ethnicity (optional, last, so the folders come first)
// Then each interest and hobby becomes a folder under the kind Gemini says it fits (Food >
// Baking) and the screen shows them. New reels reuse them, or get a new sub-category when none fits.
// Ethnicity is stored on the profile only; it is never sent to Gemini. There is no gender
// question: nothing used the answer.

import { Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { api, ApiError, fetcher } from "@/lib/api";
import { useKey, useMe } from "@/lib/hooks";
import { KINDS, tint } from "@/lib/kinds";
import type { OnboardingOptions, Profile, StarterGroup } from "@/lib/types";

type StepId = "interests" | "hobbies" | "age" | "ethnicity";
type OwnList = "interests" | "hobbies"; // lists people can add their own entries to

interface Step {
  id: StepId;
  section: 0 | 1 | 2;
  title: string;
  sub?: string;
}

const SECTIONS = ["Choose what you like", "Your hobbies", "A bit about you"];

const STEPS: Step[] = [
  { id: "interests", section: 0, title: "What are you into?", sub: "Pick a few, or add your own. Each one becomes a folder for your saves." },
  { id: "hobbies", section: 1, title: "What do you do for fun?", sub: "Tap any, or add your own." },
  { id: "age", section: 2, title: "How old are you?", sub: "Optional. Your age range helps fit your plans to you." },
  { id: "ethnicity", section: 2, title: "What's your ethnicity?", sub: "Optional, and only you see it. It isn't used to sort or plan anything." },
];

const EMPTY: Profile = { age_range: null, ethnicity: [], interests: [], hobbies: [] };
const PREFER_NOT = "Prefer not to say";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Chips({
  values,
  picked,
  onToggle,
  label,
}: {
  values: string[];
  picked: string[];
  onToggle: (v: string) => void;
  label: string;
}) {
  return (
    <div className="ob-chips" role="group" aria-label={label}>
      {values.map((v) => (
        <button key={v} type="button" className="ob-chip" aria-pressed={picked.includes(v)} onClick={() => onToggle(v)}>
          {picked.includes(v) && <Icon name="check" />}
          {v}
        </button>
      ))}
    </div>
  );
}

function AddOwn({ onAdd, placeholder }: { onAdd: (v: string) => void; placeholder: string }) {
  const [text, setText] = useState("");
  const id = useId();
  function add() {
    const v = text.split(/\s+/).join(" ").trim().slice(0, 32);
    if (v) onAdd(v);
    setText("");
  }
  return (
    <form
      className="ob-add"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <label htmlFor={id} className="vh">
        {placeholder}
      </label>
      <input
        id={id}
        value={text}
        maxLength={32}
        placeholder={placeholder}
        enterKeyHint="done"
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="ob-add-btn" disabled={!text.trim()} aria-label="Add">
        <Icon name="plus" />
      </button>
    </form>
  );
}

function Welcome() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") === "/setup" ? "/setup" : "/home";
  const key = useKey();
  const { data: me, mutate: mutateMe } = useMe(Boolean(key));
  const { data: options } = useSWR<OnboardingOptions>("/api/onboarding/options", fetcher, {
    revalidateOnFocus: false,
  });

  const [index, setIndex] = useState(0);
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [extra, setExtra] = useState<Record<OwnList, string[]>>({ interests: [], hobbies: [] });
  const [suggested, setSuggested] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [phase, setPhase] = useState<"asking" | "building" | "done">("asking");
  const [made, setMade] = useState<StarterGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (key === null) router.replace("/");
  }, [key, router]);

  // Coming back to redo the intro: start from what was saved last time.
  const [seeded, setSeeded] = useState(false);
  if (!seeded && me) {
    setSeeded(true);
    // Only the fields asked now; an old stored answer (like the removed gender one) isn't sent back.
    const p = me.profile;
    if (p)
      setProfile({
        age_range: p.age_range ?? null,
        ethnicity: p.ethnicity ?? [],
        interests: p.interests ?? [],
        hobbies: p.hobbies ?? [],
      });
  }

  // Move focus to each new question so screen readers hear it.
  useEffect(() => {
    headingRef.current?.focus();
  }, [index, phase]);

  // Gemini's "More for you" chips follow what the person picked or typed (not Gemini's own
  // chips), after a short pause. The joined key keeps a new array with the same picks from
  // asking again.
  const broadKey = profile.interests.filter((i) => !suggested.includes(i)).join("\n");
  const broadPicked = useMemo(() => (broadKey ? broadKey.split("\n") : []), [broadKey]);
  useEffect(() => {
    if (STEPS[index]?.id !== "interests" || broadPicked.length === 0) return;
    let live = true;
    const t = window.setTimeout(async () => {
      setSuggesting(true);
      try {
        const r = await api<{ suggestions: string[] }>("/api/onboarding/suggest", {
          body: { picked: broadPicked, age_range: profile.age_range },
        });
        if (live) setSuggested((old) => [...new Set([...old.filter((s) => profile.interests.includes(s)), ...r.suggestions])]);
      } catch {
        /* suggestions are optional */
      } finally {
        if (live) setSuggesting(false);
      }
    }, 700);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // profile.interests is read for the merge only; refetch when the broad picks change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadPicked, index]);

  const step = STEPS[index];
  const progress = phase === "asking" ? (index + 1) / (STEPS.length + 1) : 1;

  async function finish() {
    setPhase("building");
    setError(null);
    try {
      const r = await api<{ starters: StarterGroup[] }>("/api/onboarding/finish", { body: { profile } });
      await mutateMe();
      if (r.starters.length === 0) {
        router.replace(next);
        return;
      }
      setMade(r.starters);
      setPhase("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't save. Check your connection and try again.");
      setPhase("asking");
    }
  }

  function advance() {
    if (index < STEPS.length - 1) setIndex(index + 1);
    else void finish();
  }

  function addOwn(list: OwnList, value: string) {
    const same = (x: string) => x.toLowerCase() === value.toLowerCase();
    const shown = [...(options?.[list] ?? []), ...extra[list], ...(list === "interests" ? suggested : [])];
    if (!shown.some(same)) setExtra((e) => ({ ...e, [list]: [...e[list], value] }));
    setProfile((p) => (p[list].some(same) ? p : { ...p, [list]: [...p[list], value] }));
  }

  function pickAge(value: string) {
    setProfile((p) => ({ ...p, age_range: value }));
    window.setTimeout(advance, 220); // single choice moves on by itself
  }

  if (!options || key === undefined) {
    return <div className="ob" aria-busy="true" />;
  }

  if (phase === "building") {
    return (
      <div className="ob">
        <main className="ob-center">
          <span className="ob-spinner" aria-hidden="true" />
          <h1 ref={headingRef} tabIndex={-1} className="ob-title" style={{ textAlign: "center" }}>
            Setting up your folders
          </h1>
          <p className="ob-sub" style={{ textAlign: "center" }}>
            Reading what you picked. This takes a few seconds.
          </p>
        </main>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="ob">
        <main className="ob-main">
          <p className="ob-section">You&apos;re set</p>
          <h1 ref={headingRef} tabIndex={-1} className="ob-title">
            Your folders
          </h1>
          <p className="ob-sub">
            Saves get filed by kind, then into one of these. When a reel fits none of them, a new one is made for it.
          </p>
          <ul className="ob-cats">
            {made.map((g) => {
              const k = KINDS[g.type];
              return (
                <li key={g.type} style={tint(k.color)}>
                  <b>
                    <Icon name={k.icon} />
                    {k.label}
                  </b>
                  <span className="ob-subs">
                    {g.subcategories.map((s) => (
                      <span key={s} className="ob-sub-chip">
                        {s}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </main>
        <footer className="ob-foot">
          <button type="button" className="btn btn-primary btn-block" onClick={() => router.replace(next)}>
            Start saving
          </button>
        </footer>
      </div>
    );
  }

  return (
    <div className="ob">
      <header className="ob-head">
        <button
          type="button"
          className="ob-icon"
          aria-label="Back"
          disabled={index === 0}
          onClick={() => setIndex(Math.max(0, index - 1))}
        >
          <Icon name="back" />
        </button>
        <div
          className="ob-progress"
          role="progressbar"
          aria-label="Intro progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <button type="button" className="ob-skip" onClick={advance}>
          Skip
        </button>
      </header>

      <main className="ob-main">
        <p className="ob-section">{SECTIONS[step.section]}</p>
        <h1 ref={headingRef} tabIndex={-1} className="ob-title">
          {step.title}
        </h1>
        {step.sub && <p className="ob-sub">{step.sub}</p>}

        {step.id === "age" && (
          <div className="ob-list" role="radiogroup" aria-label={step.title}>
            {options.age_ranges.map((v) => {
              const on = profile.age_range === v;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="ob-option"
                  onClick={() => pickAge(v)}
                >
                  {v}
                  {on && <Icon name="check" />}
                </button>
              );
            })}
          </div>
        )}

        {step.id === "ethnicity" && (
          <Chips
            label={step.title}
            values={options.ethnicities}
            picked={profile.ethnicity}
            onToggle={(v) =>
              setProfile((p) => ({
                ...p,
                ethnicity:
                  v === PREFER_NOT
                    ? p.ethnicity.includes(PREFER_NOT) ? [] : [PREFER_NOT]
                    : toggle(p.ethnicity.filter((e) => e !== PREFER_NOT), v),
              }))
            }
          />
        )}

        {step.id === "interests" && (
          <>
            <Chips
              label="Interests"
              values={[...options.interests, ...extra.interests]}
              picked={profile.interests}
              onToggle={(v) => setProfile((p) => ({ ...p, interests: toggle(p.interests, v) }))}
            />
            <AddOwn key="interests" placeholder="Add your own" onAdd={(v) => addOwn("interests", v)} />
            {(suggested.length > 0 || suggesting) && (
              <section className="ob-more" aria-live="polite">
                <h2>
                  <Icon name="spark" />
                  More for you
                </h2>
                {suggested.length > 0 ? (
                  <Chips
                    label="Suggested interests"
                    values={suggested}
                    picked={profile.interests}
                    onToggle={(v) => setProfile((p) => ({ ...p, interests: toggle(p.interests, v) }))}
                  />
                ) : (
                  <p className="ob-sub">Finding more like these</p>
                )}
              </section>
            )}
          </>
        )}

        {step.id === "hobbies" && (
          <>
            <Chips
              label={step.title}
              values={[...options.hobbies, ...extra.hobbies]}
              picked={profile.hobbies}
              onToggle={(v) => setProfile((p) => ({ ...p, hobbies: toggle(p.hobbies, v) }))}
            />
            <AddOwn key="hobbies" placeholder="Add a hobby" onAdd={(v) => addOwn("hobbies", v)} />
          </>
        )}

        {error && (
          <p role="alert" className="ob-error">
            {error}
          </p>
        )}
      </main>

      {step.id !== "age" && (
        <footer className="ob-foot">
          <button type="button" className="btn btn-primary btn-block" onClick={advance}>
            {index === STEPS.length - 1 ? "Finish" : "Continue"}
          </button>
        </footer>
      )}
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={<div className="ob" aria-busy="true" />}>
      <Welcome />
    </Suspense>
  );
}
