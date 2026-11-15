"use client";

// Action mode: the thing a reel was saved for, on its own screen, apart from the reel's
// details. Ready for you opens here. Cook mode and the gym routine open straight into their
// step-by-step screens; prices, the itinerary, key points and the event each get a focused
// page. "See the reel" leads to the details page.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CookMode, type StepModeWords } from "@/components/cook";
import { Icon } from "@/components/icons";
import { PlanCard } from "@/components/plan-card";
import { ReelSections } from "@/components/reel-sections";
import { useApp } from "@/components/shell";
import { ShopResearch } from "@/components/shop-research";
import { TripPlan } from "@/components/trip-plan";
import { inFlight, ticketTitle } from "@/lib/format";
import { useSaveDetail } from "@/lib/hooks";
import { DELIVERY, kindTint } from "@/lib/kinds";
import type { Fields, Ingredient } from "@/lib/types";

const GYM_WORDS: StepModeWords = { close: "Stop the workout", prep: "Get these ready", step: "Move", start: "Start" };

type Exercise = NonNullable<NonNullable<Fields["workout"]>["exercises"]>[number];

/** "Goblet squat. 3 × 12. Rest 60 s. Keep your chest up." One page of the routine. */
function exerciseStep(ex: Exercise): string {
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
            : null;
  return [ex.name, dose, ex.rest_sec ? `Rest ${ex.rest_sec} s` : null, ...(ex.cues ?? [])]
    .filter(Boolean)
    .map((p) => String(p).replace(/\.$/, ""))
    .join(". ") + ".";
}

export default function ActionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { goBack } = useApp();
  const { data, error } = useSaveDetail(id);
  // Step-by-step modes open on arrival; closing that first one goes back to where you came
  // from. Opened again from this page, closing just shows the page.
  const [stepOpen, setStepOpen] = useState(true);
  const autoOpened = useRef(true);
  const [servings, setServings] = useState<number | null>(null);

  // Nothing to do for a vibes reel (or one not read yet): the details page instead.
  const noAction = data !== undefined && (!data.ticket.action || data.ticket.action.deliver === "keep");
  useEffect(() => {
    if (noAction) router.replace(`/s/${id}`);
  }, [noAction, id, router]);

  const back = (
    <button type="button" className="round back" aria-label="Back" onClick={goBack}>
      <Icon name="back" />
    </button>
  );

  if (error && !data) {
    return (
      <div className="gutter act-page">
        {back}
        <p className="msg" role="alert">
          This action didn&apos;t load. Check your connection.
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="gutter act-page" role="status">
        {back}
        <span className="vh">Loading</span>
        <span className="skel" style={{ marginTop: 28, height: 34, width: "70%" }} />
        <span className="skel" style={{ marginTop: 14, height: 14, width: "90%" }} />
      </div>
    );
  }

  const { ticket, details } = data;
  const fields = details.fields ?? {};
  const action = ticket.action;
  const reading = inFlight(ticket.processing);
  const title = ticketTitle(ticket);

  if (!action || action.deliver === "keep") return null;
  const d = DELIVERY[action.deliver];
  const recipe = fields.recipe;
  const workout = fields.workout;
  const ingredients: Ingredient[] = recipe?.ingredients ?? [];
  const steps = recipe?.steps ?? [];
  const moves = (workout?.exercises ?? []).map(exerciseStep);
  const gear: Ingredient[] = (workout?.equipment ?? []).map((item) => ({ item }) as Ingredient);

  const closeStep = (open: boolean) => {
    setStepOpen(open);
    if (!open && autoOpened.current) goBack();
    autoOpened.current = false;
  };
  const openStep = () => {
    autoOpened.current = false;
    setStepOpen(true);
  };

  return (
    <div className="act-page" style={kindTint(ticket.type)}>
      <header className="act-head gutter">
        {back}
        <span className="act-kind">
          <Icon name={d.icon} />
          {d.label}
        </span>
        <h1 className="act-title">{action.cta}</h1>
        {action.pitch && <p className="act-pitch">{action.pitch}</p>}
        <Link href={`/s/${id}`} className="act-reel">
          {ticket.thumb_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ticket.thumb_url} alt="" />
          )}
          <span className="act-reel-text">
            <span className="act-reel-title">{title}</span>
            <span className="act-reel-link">
              See the reel
              <Icon name="right" />
            </span>
          </span>
        </Link>
      </header>

      <div className="act-body gutter">
        {reading && <p className="plan-meta">Still reading this reel. It&apos;ll be ready in a moment.</p>}

        {action.deliver === "cook" && (
          <>
            <button type="button" className="btn btn-primary btn-block act-go" onClick={openStep}>
              <Icon name="food" />
              Start cooking
            </button>
            <ReelSections saveId={id} fields={{ recipe }} unverified={details.unverified ?? []} servings={servings} onServings={setServings} />
            {(ingredients.length > 0 || steps.length > 0) && (
              <CookMode open={stepOpen} onOpenChange={closeStep} title={title} ingredients={ingredients} steps={steps} servings={recipe?.servings ?? null} />
            )}
          </>
        )}

        {action.deliver === "workout" && (
          <>
            <button type="button" className="btn btn-primary btn-block act-go" onClick={openStep} disabled={moves.length === 0}>
              <Icon name="fit" />
              Start the workout
            </button>
            <ReelSections saveId={id} fields={{ workout }} unverified={details.unverified ?? []} servings={null} onServings={() => {}} />
            {moves.length > 0 && (
              <CookMode open={stepOpen} onOpenChange={closeStep} title={title} ingredients={gear} steps={moves} servings={null} words={GYM_WORDS} />
            )}
          </>
        )}

        {action.deliver === "shop" && <ShopResearch saveId={id} settled={!reading} go={1} />}

        {action.deliver === "itinerary" && <TripPlan saveId={id} type={ticket.type} settled={!reading} go={1} />}

        {action.deliver === "learn" && (
          <ReelSections saveId={id} fields={{ tip: fields.tip }} unverified={details.unverified ?? []} servings={null} onServings={() => {}} />
        )}

        {action.deliver === "calendar" && (
          <>
            <PlanCard ticket={ticket} bare />
            <ReelSections saveId={id} fields={{ event: fields.event }} unverified={details.unverified ?? []} servings={null} onServings={() => {}} />
          </>
        )}
      </div>
    </div>
  );
}
