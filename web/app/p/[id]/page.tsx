"use client";

// Public plan page (DESIGN.md 7.7): opened from the calendar event or reminder on the phone.
// The share token in ?t= stands in for a key.

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Ticket, TicketPlaceholder } from "@/components/ticket";
import { ToastViewport } from "@/components/toast";
import { ApiError, fetcher } from "@/lib/api";
import { useConfig } from "@/lib/hooks";
import { btnOutline, linkInk } from "@/lib/styles";
import type { Ticket as TicketData } from "@/lib/types";
import { cn } from "@/lib/utils";

function PlanPage() {
  const { id } = useParams<{ id: string }>();
  const token = useSearchParams().get("t");
  const { appName } = useConfig();
  const { data, error, isLoading, mutate } = useSWR<{ ticket: TicketData }>(
    token ? `/api/public/plans/${id}?t=${encodeURIComponent(token)}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const [result, setResult] = useState<"done" | "skipped" | null>(null);

  const openApp = (
    <Link href="/" className={cn(linkInk, "inline-flex min-h-11 items-center text-[16px]")}>
      Open {appName}
    </Link>
  );

  const badLink = !token || (error instanceof ApiError && (error.status === 404 || error.status === 400 || error.status === 422));

  let body: React.ReactNode;
  if (badLink) {
    body = (
      <div>
        <p className="text-[16px] text-ink">
          This link doesn&apos;t open a plan. Open {appName} to see your plans.
        </p>
        <p className="mt-2">{openApp}</p>
      </div>
    );
  } else if (error && !data) {
    body = (
      <div role="alert">
        <p className="text-[16px] text-ink">This plan didn&apos;t load. Check your connection.</p>
        <button type="button" className={cn(btnOutline, "mt-3")} onClick={() => void mutate()}>
          Try again
        </button>
      </div>
    );
  } else if (isLoading || !data) {
    body = (
      <div role="status">
        <span className="sr-only">Loading this plan</span>
        <TicketPlaceholder />
      </div>
    );
  } else {
    const status = data.ticket.plan?.status;
    const actionable = status === "accepted";
    body = (
      <div>
        <Ticket
          ticket={data.ticket}
          publicToken={token ?? undefined}
          preview={!actionable && status !== "done" && status !== "skipped"}
          onChange={(t) => {
            const s = t.plan?.status;
            if (s === "done" || s === "skipped") setResult(s);
          }}
        />
        <p className="mt-4 min-h-6 text-[16px] font-medium text-ink" aria-live="polite">
          {result === "done" ? "Nice. Marked done." : result === "skipped" ? "Marked skipped." : ""}
        </p>
        <p className="mt-1">{openApp}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[440px] px-4 pb-10">
      <header className="flex h-14 items-center">
        <Link href="/" className="wide inline-flex min-h-11 items-center rounded-[4px] text-[20px] leading-none text-ink">
          {appName}
        </Link>
      </header>
      <main className="pt-2">{body}</main>
      <ToastViewport />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-paper" />}>
      <PlanPage />
    </Suspense>
  );
}
