"use client";

// Save detail (DESIGN.md 7.5): the full ticket, what the agent pulled out of the reel,
// the transcript, and how it was planned.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Clock, MoreHorizontal } from "lucide-react";
import { AgentTrace } from "@/components/agent-activity";
import { SaveSections } from "@/components/save-sections";
import { Ticket, TicketPlaceholder } from "@/components/ticket";
import { useToast } from "@/components/toast";
import { SEEDED_SAMPLE_NOTE, useTrace } from "@/components/trace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { api, ApiError } from "@/lib/api";
import { clock } from "@/lib/format";
import { useRefresh, useSaveDetail } from "@/lib/hooks";
import { btnDanger, btnIcon, btnOutline, btnText, sectionTitle } from "@/lib/styles";
import type { Ticket as TicketData } from "@/lib/types";
import { cn } from "@/lib/utils";

function BackLink() {
  return (
    <Link href="/library" className={cn(btnText, "-ml-3")}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      Library
    </Link>
  );
}

export default function SaveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const refresh = useRefresh();
  const { select } = useTrace();
  const { data, error, isLoading, mutate } = useSaveDetail(id);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // On desktop the side panel shows this save's trace.
  useEffect(() => {
    if (id) select(id);
  }, [id, select]);

  if (error && !data) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div>
        <BackLink />
        <div className="mt-4" role="alert">
          <p className="text-[16px] text-ink">
            {missing ? "That save isn't in your library." : "This save didn't load. Check your connection."}
          </p>
          {!missing && (
            <button type="button" className={cn(btnOutline, "mt-3")} onClick={() => void mutate()}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div>
        <BackLink />
        <div className="mt-2" role="status">
          <span className="sr-only">Loading this save</span>
          <TicketPlaceholder />
        </div>
      </div>
    );
  }

  const { ticket, details, runs } = data;
  const enriching = ticket.processing === "enriching" || ticket.processing === "planned";
  const working =
    enriching || ticket.processing === "queued" || ticket.processing === "reading" || ticket.processing === "planning";
  const hasVideoText = details.transcript.length > 0 || details.on_screen_text.length > 0;

  async function planAgain() {
    setBusy(true);
    try {
      const r = await api<{ ticket: TicketData }>(`/api/saves/${id}/replan`, { method: "POST" });
      await mutate((cur) => (cur ? { ...cur, ticket: { ...r.ticket, steps: cur.ticket.steps } } : cur), {
        revalidate: true,
      });
      refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Planning again didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api<{ ok: boolean }>(`/api/saves/${id}`, { method: "DELETE" });
      setDeleteOpen(false);
      select(null);
      refresh();
      router.replace("/library");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Delete didn't work. Try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <BackLink />

      <div className="mt-2">
        <Ticket ticket={ticket} />
      </div>

      {enriching && (
        <p className="mt-4 flex items-center gap-2 text-[14px] text-muted">
          <Clock aria-hidden="true" className="size-4 shrink-0" />
          Watching the video for details.
        </p>
      )}

      {details.summary && <p className="mt-5 text-[16px] text-ink">{details.summary}</p>}

      <SaveSections fields={details.fields ?? {}} unverified={details.unverified ?? []} />

      {details.enrich_error && (
        <p className="mt-6 text-[14px] text-muted">
          Couldn&apos;t watch the video: {details.enrich_error.replace(/\.$/, "")}. The plan uses the caption.
        </p>
      )}

      {hasVideoText && (
        <details className="group mt-6 border-y border-line">
          <summary className={cn(sectionTitle, "flex min-h-12 items-center justify-between gap-3")}>
            What&apos;s in the video
            <ChevronDown aria-hidden="true" className="size-5 shrink-0 group-open:rotate-180" />
          </summary>
          <div className="pb-4">
            {details.transcript.length > 0 && (
              <ol className="flex flex-col gap-1.5 text-[15px] text-ink">
                {details.transcript.map((line, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="tabular w-9 shrink-0 text-[13px] leading-[22px] text-muted">
                      {clock(line.start_sec)}
                    </span>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ol>
            )}
            {details.on_screen_text.length > 0 && (
              <>
                <h3 className="mt-4 text-[13px] text-muted">On screen</h3>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[15px] text-ink marker:text-line-strong">
                  {details.on_screen_text.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </details>
      )}

      {/* Below 1100 px the trace lives in the page; at 1100 px it's in the side panel. */}
      <section className="mt-6 desk:hidden" aria-labelledby="trace-heading">
        <h2 id="trace-heading" className={sectionTitle}>
          How it was planned
        </h2>
        <div className="mt-2">
          <AgentTrace runs={runs} live={working} emptyText={ticket.is_sample ? SEEDED_SAMPLE_NOTE : undefined} />
        </div>
      </section>

      <div className="mt-8 flex items-center gap-2">
        <a className={cn(btnOutline, "flex-1")} href={ticket.url} target="_blank" rel="noopener noreferrer">
          Open on Instagram
        </a>
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(btnIcon, "border border-line-strong bg-ticket")} aria-label="More for this save" disabled={busy}>
            <MoreHorizontal aria-hidden="true" className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top">
            {ticket.plan && <DropdownMenuItem onSelect={() => void planAgain()}>Plan again</DropdownMenuItem>}
            <DropdownMenuItem variant="danger" onSelect={() => setDeleteOpen(true)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Sheet open={deleteOpen} onOpenChange={setDeleteOpen}>
        <SheetContent>
          <SheetTitle>Delete this save?</SheetTitle>
          <SheetDescription>Its plan goes too.</SheetDescription>
          <button
            type="button"
            className={cn(btnDanger, "mt-5 w-full")}
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete
          </button>
          <button type="button" className={cn(btnText, "mt-1 w-full")} onClick={() => setDeleteOpen(false)}>
            Keep it
          </button>
        </SheetContent>
      </Sheet>
    </div>
  );
}
