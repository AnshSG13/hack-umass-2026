"use client";

// "Ready for you": a plan built from several saves. One card, one main button. Start puts
// every reel in it on your week; the rest of the card opens the plan's own page.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { api, ApiError, fetcher } from "@/lib/api";
import { useRefresh } from "@/lib/hooks";
import { kindOf, tint } from "@/lib/kinds";
import type { Bundle, BundlesResponse } from "@/lib/types";

/** The list of bundles. Asked again every few seconds while a new one's words are being written. */
export function useBundles(enabled = true) {
  return useSWR<BundlesResponse>(enabled ? "/api/bundles" : null, fetcher, {
    refreshInterval: (latest) => (latest?.ready.some((b) => b.polishing) ? 2500 : 0),
  });
}

/** Start a bundle: one request, a toast with what was added, every list brought up to date. */
export function useStartBundle(): { start: (b: Bundle) => Promise<Bundle | null>; busyId: string | null } {
  const toast = useToast();
  const refresh = useRefresh();
  const [busyId, setBusyId] = useState<string | null>(null);
  async function start(b: Bundle): Promise<Bundle | null> {
    if (busyId) return null;
    setBusyId(b.id);
    try {
      const r = await api<{ bundle: Bundle; message: string }>(`/api/bundles/${b.id}/start`, { method: "POST" });
      toast.show(r.message || "Added to your week.");
      refresh();
      return r.bundle;
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "That didn't start. Try again.");
      return null;
    } finally {
      setBusyId(null);
    }
  }
  return { start, busyId };
}

export function Fan({ urls }: { urls: string[] }) {
  return (
    <span className="bfan" aria-hidden="true">
      {urls.slice(0, 3).map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={u + i} src={u} alt="" loading="lazy" />
      ))}
    </span>
  );
}

export function BundleCard({
  bundle,
  compact = false,
  onDismiss,
}: {
  bundle: Bundle;
  /** The narrow card in Home's rail: no blurb, no "Not now". */
  compact?: boolean;
  onDismiss?: (b: Bundle) => void;
}) {
  const kind = kindOf(bundle.type);
  const { start, busyId } = useStartBundle();
  const busy = busyId === bundle.id;
  const href = `/b/${bundle.id}`;
  return (
    <article className={compact ? "bcard is-compact" : "bcard"} style={kind ? tint(kind.color) : undefined}>
      <Link href={href} className="bcard-main" aria-label={`Open ${bundle.title}`}>
        <span className="bcard-top">
          <span className="bcard-kind">
            {kind && <Icon name={kind.icon} />}
            {bundle.count_label}
          </span>
          <Fan urls={bundle.thumbs} />
        </span>
        <span className="bcard-title">{bundle.title}</span>
        {!compact && <span className="bcard-blurb">{bundle.blurb}</span>}
        {bundle.first_when && <span className="bcard-when">First one {bundle.first_when}</span>}
      </Link>
      <div className="bcard-foot">
        {bundle.can_start ? (
          <button type="button" className="btn btn-primary bcard-go" disabled={busy} onClick={() => void start(bundle)}>
            {busy ? "Adding" : bundle.cta}
          </button>
        ) : (
          <Link href={href} className="btn btn-primary bcard-go">
            {bundle.cta}
          </Link>
        )}
        {!compact && onDismiss && (
          <button type="button" className="text-btn" disabled={busy} onClick={() => onDismiss(bundle)}>
            Not now
          </button>
        )}
      </div>
    </article>
  );
}

/** A started bundle as one row: it is on the week already; this leads to its page. */
export function BundleRow({ bundle }: { bundle: Bundle }) {
  const kind = kindOf(bundle.type);
  const next = bundle.items.find((i) => i.plan_status === "accepted");
  return (
    <Link href={`/b/${bundle.id}`} className="brow" style={kind ? tint(kind.color) : undefined}>
      <Fan urls={bundle.thumbs} />
      <span className="brow-text">
        <span className="brow-title">{bundle.title}</span>
        <span className="brow-meta">
          {bundle.count_label}
          {next?.when ? ` · next ${next.when}` : ""}
        </span>
      </span>
      <Icon name="right" />
    </Link>
  );
}
