"use client";

// Action mode: the thing a reel was saved for, on its own screen, apart from the reel's
// details. Ready for you opens here. Cook mode and the gym routine open straight into their
// step-by-step screens; prices, the itinerary, key points and the event each get a focused
// page. "See the reel" leads to the details page. The foot marks it done; finishing the last
// step of cook mode or a workout marks it done too.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CookMode, type StepModeWords } from "@/components/cook";
import { DoneBar, useDone } from "@/components/done";
import { Icon } from "@/components/icons";
import { PlanCard } from "@/components/plan-card";
import { ReelSections } from "@/components/reel-sections";
import { useApp } from "@/components/shell";
import { ShareAction } from "@/components/share-action";
import { ShopResearch } from "@/components/shop-research";
import { TripPlan } from "@/components/trip-plan";
import { inFlight, ticketTitle } from "@/lib/format";
import { useSaveDetail } from "@/lib/hooks";
import { DELIVERY, kindTint } from "@/lib/kinds";
import type { Fields, Ingredient, SaveDetail } from "@/lib/types";

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

function BackButton() {
  const { goBack } = useApp();
  return (
    <button type="button" className="round back" aria-label="Back" onClick={goBack}>
      <Icon name="back" />
    </button>
  );
}

export default function ActionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error } = useSaveDetail(id);

  // Nothing to do for a vibes reel (or one not read yet): the details page instead.
  const noAction = data !== undefined && (!data.ticket.action || data.ticket.action.deliver === "keep");
  useEffect(() => {
    if (noAction) router.replace(`/s/${id}`);
  }, [noAction, id, router]);

  if (error && !data) {
    return (
      <div className="gutter act-page">
        <BackButton />
        <p className="msg" role="alert">
          This action didn&apos;t load. Check your connection.
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="gutter act-page" role="status">
        <BackButton />
        <span className="vh">Loading</span>
        <span className="skel" style={{ marginTop: 28, height: 34, width: "70%" }} />
        <span className="skel" style={{ marginTop: 14, height: 14, width: "90%" }} />
      </div>
    );
  }
  if (noAction) return null;
  return <ActionView id={id} data={data} />;
}

function ActionView({ id, data }: { id: string; data: SaveDetail }) {
  const { goBack } = useApp();
  const { ticket, details } = data;
  const done = useDone(ticket);
  // Step-by-step modes open on arrival (not when it is already done); closing that first one
  // goes back to where you came from. Opened again from this page, closing just shows the page.
  const [stepOpen, setStepOpen] = useState(!done.done);
  const autoOpened = useRef(!done.done);
  // Set by the last step's Done, so closing then stays on the page and the done state shows.
  const finishing = useRef(false);
  const [servings, setServings] = useState<number | null>(null);

  const fields = details.fields ?? {};
  const action = ticket.action!;
  const reading = inFlight(ticket.processing);
  const title = ticketTitle(ticket);
  const d = DELIVERY[action.deliver];
  const recipe = fields.recipe;
  const workout = fields.workout;
  const ingredients: Ingredient[] = recipe?.ingredients ?? [];
  const steps = recipe?.steps ?? [];
  const moves = (workout?.exercises ?? []).map(exerciseStep);
  const gear: Ingredient[] = (workout?.equipment ?? []).map((item) => ({ item }) as Ingredient);

  const closeStep = (open: boolean) => {
    setStepOpen(open);
    if (!open && autoOpened.current && !finishing.current) goBack();
    autoOpened.current = false;
    finishing.current = false;
  };
  const openStep = () => {
    autoOpened.current = false;
    setStepOpen(true);
  };
  // Followed through to the end: that counts as done.
  const finish = () => {
    finishing.current = true;
    if (done.canMark) void done.mark();
  };

  return (
    <div className="act-page" style={kindTint(ticket.type)}>
      <header className="act-head gutter">
        <div className="act-top">
          <BackButton />
          <ShareAction deliver={action.deliver} ticket={ticket} fields={fields} />
        </div>
        <div className="act-chips">
          <span className="act-kind">
            <Icon name={d.icon} />
            {d.label}
          </span>
          {done.done && (
            <span className="act-kind is-done">
              <Icon name="check" />
              Done{done.when ? ` ${done.when}` : ""}
            </span>
          )}
        </div>
        {/* The reel itself is the headline (the dish, the product); the call to action and
            what's ready sit under it. */}
        <h1 className="act-title">{title}</h1>
        <p className="act-pitch">
          <b className="act-cta">{action.cta}</b>
          {action.pitch && <span>{action.pitch}</span>}
        </p>
        <Link href={`/s/${id}`} className="act-reel">
          {ticket.thumb_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ticket.thumb_url} alt="" />
          )}
          <span className="act-reel-text">
            <span className="act-reel-title">{ticket.creator ? `Saved from ${ticket.creator}` : "The original reel"}</span>
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
              {done.done ? "Cook it again" : "Cook now"}
            </button>
            <ReelSections saveId={id} fields={{ recipe }} unverified={details.unverified ?? []} servings={servings} onServings={setServings} />
            {(ingredients.length > 0 || steps.length > 0) && (
              <CookMode open={stepOpen} onOpenChange={closeStep} title={title} ingredients={ingredients} steps={steps} servings={recipe?.servings ?? null} onFinish={finish} />
            )}
          </>
        )}

        {action.deliver === "workout" && (
          <>
            <button type="button" className="btn btn-primary btn-block act-go" onClick={openStep} disabled={moves.length === 0}>
              <Icon name="fit" />
              {done.done ? "Do it again" : "Start the workout"}
            </button>
            <ReelSections saveId={id} fields={{ workout }} unverified={details.unverified ?? []} servings={null} onServings={() => {}} />
            {moves.length > 0 && (
              <CookMode open={stepOpen} onOpenChange={closeStep} title={title} ingredients={gear} steps={moves} servings={null} words={GYM_WORDS} onFinish={finish} />
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

        {/* The event's plan card carries its own done controls. */}
        {action.deliver !== "calendar" && !reading && <DoneBar ticket={ticket} />}
      </div>
    </div>
  );
}
