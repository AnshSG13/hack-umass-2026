"use client";

// Something that was sent: an itinerary, a grocery list, an invite. Opened from a link in
// a message by someone who may never have used the app, so there is no navigation and no
// sign-in here. The share token in ?t= stands in for a key, and the request carries none.

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { DeliverableBlocks, safeHref } from "@/components/deliverables";
import { Icon } from "@/components/icons";
import { PublicBack, PublicClose } from "@/components/public-back";
import { ApiError, publicFetcher } from "@/lib/api";
import { useConfig } from "@/lib/hooks";
import type { PublicDeliverable } from "@/lib/types";

function SentPage() {
  const { id } = useParams<{ id: string }>();
  const token = useSearchParams().get("t");
  const { appName } = useConfig();
  const { data, error, isLoading, mutate } = useSWR<{ deliverable: PublicDeliverable }>(
    token ? `/api/public/deliverables/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}` : null,
    publicFetcher,
    { revalidateOnFocus: false },
  );
  const d = data?.deliverable;

  // The tab is named after what was sent, not only after the app.
  const tabTitle = d ? `${d.title} · ${d.app_name}` : null;
  useEffect(() => {
    if (tabTitle) document.title = tabTitle;
  }, [tabTitle]);

  const badLink =
    !token || (error instanceof ApiError && (error.status === 404 || error.status === 400 || error.status === 422));

  let body: React.ReactNode;
  if (badLink) {
    body = <p className="dpage-plain">This link doesn&apos;t open anything.</p>;
  } else if (error && !d) {
    body = (
      <div role="alert">
        <p className="dpage-plain">This didn&apos;t load. Check your connection.</p>
        <button type="button" className="btn" onClick={() => void mutate()}>
          <Icon name="redo" />
          Try again
        </button>
      </div>
    );
  } else if (isLoading || !d) {
    body = (
      <div role="status" style={{ marginTop: 28 }}>
        <span className="vh">Loading</span>
        <span className="skel" style={{ height: 34, width: "78%" }} />
        <span className="skel" style={{ marginTop: 22, height: 14, width: "100%" }} />
        <span className="skel" style={{ height: 14, width: "86%" }} />
        <span className="skel" style={{ height: 14, width: "64%" }} />
      </div>
    );
  } else {
    const reel = d.reel;
    const reelUrl = safeHref(reel.url);
    const showReel = Boolean(reel.title || reel.creator || reel.thumb_url || reelUrl);
    body = (
      <article>
        {showReel && (
          <div className="dpage-reel">
            {reel.thumb_url && (
              <span className="thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={reel.thumb_url} alt="" width={52} height={68} />
              </span>
            )}
            <div className="dpage-reel-text">
              <span className="dpage-reel-from">Made from this reel</span>
              {reel.title && <span className="dpage-reel-title">{reel.title}</span>}
              {reel.creator && <span className="dpage-reel-by">{reel.creator}</span>}
              {reelUrl && (
                <a className="trip-link" href={reelUrl} target="_blank" rel="noopener noreferrer">
                  <span>
                    Open the reel<span className="vh"> (opens in a new tab)</span>
                  </span>
                  <Icon name="out" />
                </a>
              )}
            </div>
          </div>
        )}

        <h1 className="dpage-title">{d.title}</h1>
        {d.lede.map((line, i) => (
          <p key={i} className="dpage-line">
            {line}
          </p>
        ))}
        <DeliverableBlocks blocks={d.blocks} heading="h2" />
        {d.closing.length > 0 && (
          <div className="dpage-closing">
            {d.closing.map((line, i) => (
              <p key={i} className="dpage-line">
                {line}
              </p>
            ))}
          </div>
        )}
      </article>
    );
  }

  return (
    <div className="dpage">
      <header className="dpage-head">
        <PublicBack />
        <Link href="/" className="wide dpage-brand" translate="no">
          {d?.app_name ?? appName}
        </Link>
        <PublicClose />
      </header>
      <main>{body}</main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-paper" />}>
      <SentPage />
    </Suspense>
  );
}
