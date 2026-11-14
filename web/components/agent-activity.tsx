"use client";

// Agent activity (DESIGN.md section 6). Layer one: plain step lines. Layer two: the
// "Show tool calls" switch, which opens each step's tool name, arguments and result.

import { useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, ChevronRight, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { formatMs } from "@/lib/format";
import type { AgentRun, RunStep, StepLine } from "@/lib/types";

function StepIcon({ state }: { state: StepLine["state"] }) {
  if (state === "done") return <Check aria-hidden="true" className="size-4 shrink-0 text-ink" strokeWidth={2.25} />;
  if (state === "failed") return <X aria-hidden="true" className="size-4 shrink-0 text-danger-ink" strokeWidth={2.25} />;
  return (
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
      <span className="step-dot-current block size-2 rounded-full bg-ink" />
    </span>
  );
}

function stateWord(state: StepLine["state"]): string {
  if (state === "done") return "done";
  if (state === "failed") return "failed";
  return "in progress";
}

function LineBody({ step }: { step: StepLine }) {
  return (
    <>
      <StepIcon state={step.state} />
      <span className="text-[15px] leading-[1.4] text-ink">
        {step.label}
        <span className="sr-only">, {stateWord(step.state)}</span>
        {step.state === "done" && step.ms != null && (
          <span className="text-[13px] text-muted"> · {formatMs(step.ms)}</span>
        )}
      </span>
    </>
  );
}

/**
 * Layer one. With `live`, each line enters when its real step arrives (motion moment 1:
 * opacity 0 to 1 and y 4 to 0 over 140 ms; lines that arrive together stagger 60 ms).
 */
export function StepLines({ steps, live = false }: { steps: StepLine[]; live?: boolean }) {
  const reduce = useReducedMotion();
  // `base` is how many lines were already on screen before the latest batch arrived.
  const [batch, setBatch] = useState({ count: steps.length, base: live ? 0 : steps.length });
  if (steps.length !== batch.count) setBatch({ count: steps.length, base: batch.count });

  return (
    <ol aria-live="polite" className="flex flex-col gap-2">
      {steps.map((step, i) => {
        const delay = Math.max(0, i - batch.base) * 0.06;
        return (
          <motion.li
            key={i}
            className="flex items-start gap-2 [&>svg]:mt-[3px] [&>span:first-child]:mt-[3px]"
            initial={live ? (reduce ? { opacity: 0 } : { opacity: 0, y: 4 }) : false}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={
              reduce ? { duration: 0.12, delay: 0 } : { duration: 0.14, ease: "easeOut", delay }
            }
          >
            <LineBody step={step} />
          </motion.li>
        );
      })}
    </ol>
  );
}

// ---- layer two ----

const RUN_LABEL: Record<AgentRun["kind"], string> = {
  propose: "Planning",
  enrich: "Watching the video",
  replan: "Planning again",
  ask: "Ask",
};

function runSeconds(run: AgentRun): string | null {
  if (!run.started_at || !run.ended_at) return null;
  const ms = Date.parse(run.ended_at) - Date.parse(run.started_at);
  if (Number.isNaN(ms) || ms < 0) return null;
  return formatMs(ms);
}

function jsonText(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value as Record<string, unknown>);
    const truncated = (value as Record<string, unknown>).truncated;
    // The server cuts long payloads to 2 KB and hands back the cut string.
    if (keys.length === 1 && typeof truncated === "string") return `${truncated} …`;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="group mt-1">
      <summary className="flex min-h-11 items-center gap-1 text-[14px] text-ink">
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 group-open:rotate-90" />
        {title}
      </summary>
      <pre className="tool-json overflow-x-auto rounded-[8px] bg-paper p-3 text-ink" tabIndex={0}>
        {jsonText(value)}
      </pre>
    </details>
  );
}

function ToolCall({ step }: { step: RunStep }) {
  return (
    <div className="mt-1 ml-6">
      <p className="text-[13px] text-muted">
        Tool: <span className="tool-json text-ink">{step.tool}</span>
      </p>
      {step.args != null && <JsonBlock title="Arguments" value={step.args} />}
      {step.result != null && <JsonBlock title="Result" value={step.result} />}
      {step.error && <p className="mt-1 text-[13px] text-danger-ink">{step.error}</p>}
    </div>
  );
}

/** Both layers, for "How it was planned". */
export function AgentTrace({
  runs,
  live = false,
  emptyText,
}: {
  runs: AgentRun[];
  live?: boolean;
  emptyText?: string;
}) {
  const [showTools, setShowTools] = useState(false);
  const switchId = useId();
  const visible = runs.filter((r) => r.steps.length > 0);

  if (visible.length === 0) {
    return <p className="text-[14px] text-muted">{emptyText ?? "No steps were recorded for this save."}</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={switchId} className="text-[15px] text-ink">
          Show tool calls
        </label>
        <Switch id={switchId} checked={showTools} onCheckedChange={setShowTools} />
      </div>
      <div className="mt-2 flex flex-col gap-5">
        {visible.map((run) => {
          const secs = runSeconds(run);
          const metaParts = [run.model, run.status === "done" ? null : run.status, secs].filter(Boolean);
          return (
            <section key={run.id} aria-label={RUN_LABEL[run.kind]}>
              <h3 className="text-[13px] text-muted">
                {RUN_LABEL[run.kind]}
                {showTools && metaParts.length > 0 && <span> · {metaParts.join(" · ")}</span>}
              </h3>
              {showTools ? (
                <ol className="mt-2 flex flex-col gap-3">
                  {run.steps.map((step, i) => (
                    <li key={i}>
                      <div className="flex items-start gap-2 [&>svg]:mt-[3px] [&>span:first-child]:mt-[3px]">
                        <LineBody step={step} />
                      </div>
                      <ToolCall step={step} />
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="mt-2">
                  <StepLines steps={run.steps} live={live && run.status === "running"} />
                </div>
              )}
              {showTools && run.error && (
                <pre className="tool-json mt-2 overflow-x-auto rounded-[8px] bg-paper p-3 text-ink">{run.error}</pre>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
