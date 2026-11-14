"use client";

// Samples (DESIGN.md 7.2): tap a sample and watch it become a ticket.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { LiveTicket } from "@/components/live-ticket";
import { PasteForm, savedBeforeNote, saveReel } from "@/components/paste-form";
import { SampleTag, Thumb } from "@/components/ticket";
import { useToast } from "@/components/toast";
import { useTrace } from "@/components/trace";
import { ApiError, fetcher } from "@/lib/api";
import { useConfig, useRefresh } from "@/lib/hooks";
import { btnOutline, btnPrimary, linkInk, pageTitle, sectionTitle } from "@/lib/styles";
import type { SampleCard, SavesPage, Ticket as TicketData } from "@/lib/types";
import { cn } from "@/lib/utils";

const ADDED_FLAG = "rl_demo_added";

function readAdded(): boolean {
  try {
    return window.sessionStorage.getItem(ADDED_FLAG) === "1";
  } catch {
    return false;
  }
}

function Sample({
  sample,
  savedId,
  appName,
  onSaved,
  onTicketChange,
}: {
  sample: SampleCard;
  savedId: string | null;
  appName: string;
  onSaved: (shortcode: string, ticket: TicketData | null, saveId: string) => void;
  onTicketChange: (t: TicketData) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState<TicketData | null>(null);

  if (savedId) {
    return (
      <LiveTicket saveId={savedId} initial={initial} href={`/s/${savedId}`} traceLink onChange={onTicketChange} />
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await saveReel(sample.url, "sample");
      if (r.status === "error" || !r.save_id) {
        setError(r.message || "That sample didn't save. Try again.");
        return;
      }
      setInitial(r.ticket);
      onSaved(sample.shortcode, r.ticket, r.save_id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That sample didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-[16px] border border-line bg-ticket p-4" aria-label={sample.title ?? "Sample reel"}>
      <div className="flex gap-3">
        <Thumb ticket={{ thumb_url: sample.thumb_url, title: sample.title, url: sample.url, type: sample.type }} className="h-24 w-[72px]" />
        <div className="min-w-0 flex-1">
          <div className="flex min-h-[22px] items-center justify-between gap-2">
            <span className="truncate text-[13px] text-muted">{sample.creator}</span>
            <SampleTag />
          </div>
          <p className="mt-1 line-clamp-2 text-[15px] leading-[1.4] break-words text-ink">{sample.caption_excerpt}</p>
        </div>
      </div>
      <button type="button" className={cn(btnOutline, "mt-3 w-full")} disabled={busy} onClick={() => void save()}>
        Save to {appName}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-[14px] text-danger-ink">
          {error}
        </p>
      )}
    </article>
  );
}

export default function DemoPage() {
  const { appName } = useConfig();
  const toast = useToast();
  const refresh = useRefresh();
  const trace = useTrace();
  const samples = useSWR<SampleCard[]>("/api/demo/samples", fetcher);
  const saves = useSWR<SavesPage>("/api/saves?limit=100", fetcher);
  const [savedNow, setSavedNow] = useState<Record<string, string>>({});
  const [pasted, setPasted] = useState<string[]>([]);
  const [added, setAdded] = useState(readAdded);

  function noteChange(t: TicketData) {
    if (t.plan?.status === "accepted" && !added) {
      setAdded(true);
      try {
        window.sessionStorage.setItem(ADDED_FLAG, "1");
      } catch {
        /* private mode */
      }
    }
  }

  function savedIdFor(s: SampleCard): string | null {
    if (savedNow[s.shortcode]) return savedNow[s.shortcode];
    if (!s.saved) return null;
    const hit = saves.data?.items.find((t) => t.url.includes(`/${s.shortcode}/`));
    return hit?.save_id ?? null;
  }

  return (
    <div>
      <h1 className={pageTitle}>Samples</h1>
      <p className="mt-1 text-[16px] text-ink">This is what happens when you share a reel from Instagram.</p>

      <div className="mt-5 flex flex-col gap-4">
        {samples.error && !samples.data ? (
          <div role="alert">
            <p className="text-[16px] text-ink">The samples didn&apos;t load. Check your connection.</p>
            <button type="button" className={cn(btnOutline, "mt-3")} onClick={() => void samples.mutate()}>
              Try again
            </button>
          </div>
        ) : !samples.data ? (
          <div aria-hidden="true" className="h-[172px] rounded-[16px] border border-line bg-ticket" />
        ) : samples.data.length === 0 ? (
          <p className="text-[15px] text-muted">No samples are loaded right now. Paste a reel link below instead.</p>
        ) : (
          samples.data.map((s) => (
            <Sample
              key={s.shortcode}
              sample={s}
              savedId={savedIdFor(s)}
              appName={appName}
              onTicketChange={noteChange}
              onSaved={(shortcode, _ticket, saveId) => {
                setSavedNow((m) => ({ ...m, [shortcode]: saveId }));
                trace.select(saveId);
                refresh();
              }}
            />
          ))
        )}
      </div>

      {added && (
        <p className="mt-4 flex flex-wrap gap-x-5">
          <Link href="/plans" className={cn(linkInk, "inline-flex min-h-11 items-center text-[16px]")}>
            See it in Plans
          </Link>
          <Link href="/ask" className={cn(linkInk, "inline-flex min-h-11 items-center text-[16px]")}>
            Ask about your saves
          </Link>
        </p>
      )}

      <section className="mt-6 border-t border-line pt-5">
        <PasteForm
          label="Paste your own reel link"
          button="Read it"
          helper="Runs live. Takes 10 to 30 seconds."
          onSaved={(r) => {
            const note = savedBeforeNote(r);
            if (note) toast.show(note);
            setPasted((ids) => (ids.includes(r.save_id) ? ids : [r.save_id, ...ids]));
            trace.select(r.save_id);
            refresh();
          }}
        />
        {pasted.length > 0 && (
          <div className="mt-4 flex flex-col gap-4">
            {pasted.map((id) => (
              <LiveTicket key={id} saveId={id} href={`/s/${id}`} traceLink onChange={noteChange} />
            ))}
          </div>
        )}
      </section>

      {added && (
        <section className="mt-6 rounded-[16px] border border-line bg-ticket p-4">
          <h2 className={sectionTitle}>Want this on your phone? Set it up in 1 minute.</h2>
          <Link href="/setup" className={cn(btnPrimary, "mt-3")}>
            Set up on iPhone
          </Link>
        </section>
      )}
    </div>
  );
}
