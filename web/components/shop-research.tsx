"use client";

// Price research for a product reel, run only when asked. The server searches stores big and
// small, brands' own sites and review sites, and drops coupon sites and anything that looks unsafe.

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { api, ApiError, fetcher } from "@/lib/api";
import { plural } from "@/lib/format";
import type { Shop, ShopOffer } from "@/lib/types";

function Offer({ o, best }: { o: ShopOffer; best?: boolean }) {
  return (
    <li>
      <a href={o.url} target="_blank" rel="noopener noreferrer" className={best ? "offer is-best" : "offer"}>
        <span className="offer-main">
          <span className="offer-name">{o.product}</span>
          <span className="offer-meta">
            {o.store}
            {o.via !== o.store ? ` · via ${o.via}` : ""}
            {o.note ? ` · ${o.note}` : ""}
          </span>
        </span>
        <span className="offer-price">{o.price_text}</span>
        <Icon name="out" />
      </a>
    </li>
  );
}

export function ShopResearch({ saveId, settled, go = 0 }: { saveId: string; settled: boolean; go?: number }) {
  const key = `/api/saves/${saveId}/shop`;
  const { data, mutate } = useSWR<{ shop: Shop | null }>(settled ? key : null, fetcher, {
    refreshInterval: (latest) => (latest?.shop?.status === "building" ? 2500 : 0),
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const shop = data?.shop ?? null;
  const building = starting || shop?.status === "building";

  async function run() {
    setProblem(null);
    setStarting(true);
    try {
      const r = await api<{ shop: Shop | null }>(key, { method: "POST" });
      await mutate(r, { revalidate: false });
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Price research didn't start. Try again.");
    } finally {
      setStarting(false);
    }
  }

  // The action's "Check prices": run it once data has loaded and nothing is there yet.
  const handled = useRef(0);
  useEffect(() => {
    if (go === 0 || go === handled.current || data === undefined) return;
    handled.current = go;
    // A one-off command from the action button (a prop bump), not state syncing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!data.shop && !starting) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, data]);

  if (!settled) return null;

  return (
    <section className="sec" id="shop" aria-labelledby="shop-h">
      <div className="sec-head">
        <h2 className="sec-title" id="shop-h">
          Best price
        </h2>
        {shop?.status === "ready" && (
          <button type="button" className="add" onClick={() => void run()} disabled={building}>
            <Icon name="redo" />
            Check again
          </button>
        )}
      </div>

      {!shop && !building && (
        <div className="shop-ask">
          <p>Find where to buy this for less. It looks at the brand&apos;s own site, real stores big and small, and review sites, and skips coupon sites and anything that looks unsafe.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => void run()}>
            <Icon name="search" />
            Find the best price
          </button>
        </div>
      )}

      {building && (
        <p className="thinking shop-wait" role="status">
          <span className="dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Checking stores. This takes about 15 seconds.
        </p>
      )}

      {shop?.status === "failed" && !building && (
        <div role="alert" className="ask-error">
          <p>{shop.error ?? "Price research didn't finish. Try again."}</p>
          <button type="button" className="btn" onClick={() => void run()}>
            <Icon name="redo" />
            Try again
          </button>
        </div>
      )}

      {problem && (
        <p role="alert" className="field-error">
          {problem}
        </p>
      )}

      {shop?.status === "ready" && !building && (
        <>
          {shop.offers.length === 0 ? (
            <p className="msg">No prices from a store we could check turned up. Try again later, or open the reel for where they bought it.</p>
          ) : (
            <>
              {(() => {
                // One highlighted: the lowest kept price for what the reel shows. Then
                // the rest, cheapest first.
                const same = shop.offers.filter((o) => !o.alternative).sort((a, b) => a.price - b.price);
                const [top, ...rest] = same;
                return (
                  <>
                    {top && (
                      <>
                        <p className="offer-label">Lowest price found</p>
                        <ul className="offers best">
                          <Offer o={top} best />
                        </ul>
                      </>
                    )}
                    {rest.length > 0 && (
                      <>
                        <h3 className="aisle">More options</h3>
                        <ul className="offers">
                          {rest.map((o, i) => (
                            <Offer key={`o${i}`} o={o} />
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                );
              })()}
              {shop.alternatives.length > 0 && (
                <>
                  <h3 className="aisle">Cheaper for the same job</h3>
                  <ul className="offers">
                    {shop.alternatives.map((o, i) => (
                      <Offer key={`a${i}`} o={o} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          <p className="nut-note">
            Checked {shop.checked_on}. Prices marked out of stock are left out, but stock and prices change. Check the store&apos;s page before you buy.
            {shop.dropped > 0 ? ` ${plural(shop.dropped, "price", "prices")} ${shop.dropped === 1 ? "was" : "were"} left out: no readable price, or a coupon site or one that looked unsafe.` : ""}
          </p>
        </>
      )}
    </section>
  );
}
