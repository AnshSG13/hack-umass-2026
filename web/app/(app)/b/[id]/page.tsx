"use client";

// One "Ready for you" plan: the reels in it and when each would happen, one button to put
// them all on your week, and what only a group of reels can give you: one grocery list for
// several recipes, or several product reels side by side.

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { useStartBundle } from "@/components/bundle-card";
import { Icon } from "@/components/icons";
import { useApp } from "@/components/shell";
import { useToast } from "@/components/toast";
import { ApiError, fetcher } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { kindOf, tint } from "@/lib/kinds";
import type { Bundle, BundleItem, GroceryGroup } from "@/lib/types";

// ---- ticks on the grocery list, remembered on this device ----

function ticksKey(id: string): string {
  return `rl_bticks_${id}`;
}
function readTicks(id: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ticksKey(id)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeTicks(id: string, ticks: string[]): void {
  try {
    if (ticks.length === 0) window.localStorage.removeItem(ticksKey(id));
    else window.localStorage.setItem(ticksKey(id), JSON.stringify(ticks));
  } catch {
    /* private mode: the ticks just don't outlive the page */
  }
}

function sentence(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function Groceries({ bundle, groups }: { bundle: Bundle; groups: GroceryGroup[] }) {
  const toast = useToast();
  const [ticks, setTicks] = useState<string[]>(() => (typeof window === "undefined" ? [] : readTicks(bundle.id)));
  const all = groups.flatMap((g) => g.items);
  const done = all.filter((i) => ticks.includes(i.key)).length;
  const thumbOf = new Map(bundle.items.map((i) => [i.save_id, i.thumb_url]));
  const shared = all.filter((i) => i.from.length > 1).length;
  const text = [
    `Groceries for ${bundle.title}`,
    ...groups.flatMap((g) => ["", `${sentence(g.aisle)}:`, ...g.items.map((i) => `- ${i.text}`)]),
  ].join("\n");

  function toggle(key: string, on: boolean) {
    const next = on ? [...ticks.filter((t) => t !== key), key] : ticks.filter((t) => t !== key);
    setTicks(next);
    writeTicks(bundle.id, next);
  }

  return (
    <section className="sec" aria-labelledby="groc-h" id="groceries">
      <div className="sec-head">
        <h2 className="sec-title" id="groc-h">
          One grocery list
        </h2>
        <button
          type="button"
          className="add"
          onClick={async () => {
            toast.show((await copyText(text)) ? "List copied." : "Copying didn't work here. Select the list instead.");
          }}
        >
          <Icon name="copy" />
          Copy
        </button>
      </div>
      <p className="sec-sub">
        {all.length} things for {bundle.count_label}
        {shared > 0 ? `. ${shared} ${shared === 1 ? "is" : "are"} shared, so you buy ${shared === 1 ? "it" : "them"} once.` : "."}
      </p>
      <div
        className="gbar"
        role="progressbar"
        aria-label="Groceries ticked off"
        aria-valuemin={0}
        aria-valuemax={all.length}
        aria-valuenow={done}
      >
        <span style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
      </div>
      <p className="gbar-note">
        {done === 0 ? "Tick things off as you shop." : done === all.length ? "That's everything." : `${done} of ${all.length} in the basket`}
      </p>
      {groups.map((g) => (
        <div key={g.aisle}>
          <h3 className="aisle">{sentence(g.aisle)}</h3>
          <ul className="ings">
            {g.items.map((i) => (
              <li key={i.key}>
                <label className="ing">
                  <input type="checkbox" checked={ticks.includes(i.key)} onChange={(e) => toggle(i.key, e.target.checked)} />
                  <span className="tick">
                    <Icon name="check" />
                  </span>
                  <span className="ing-text">
                    <span className="ing-name">{i.text}</span>
                  </span>
                  <span className="from" aria-label={`For ${i.from.length} of the recipes`}>
                    {i.from.map((sid) =>
                      thumbOf.get(sid) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={sid} src={thumbOf.get(sid) as string} alt="" loading="lazy" />
                      ) : null,
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function ItemRow({ item, index, slotKind, cook }: { item: BundleItem; index: number; slotKind: boolean; cook: boolean }) {
  const added = item.plan_status === "accepted";
  const finished = item.plan_status === "done";
  return (
    <li>
      <Link href={cook ? `/s/${item.save_id}?cook=1` : `/s/${item.save_id}`} className="bitem">
        <span className="bitem-thumb">
          {item.thumb_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumb_url} alt="" loading="lazy" />
          ) : (
            <Icon name="bookmark" />
          )}
        </span>
        <span className="bitem-text">
          {slotKind && item.when && (
            <span className={added || finished ? "bitem-when is-set" : "bitem-when"}>
              {(added || finished) && <Icon name="check" />}
              {finished ? "Done" : item.when}
            </span>
          )}
          <span className="bitem-title">{item.title}</span>
          <span className="bitem-note">{item.note || item.meta}</span>
        </span>
        <span className="vh">{`Step ${index + 1}`}</span>
        {cook ? <span className="bitem-go">Cook</span> : <Icon name="right" />}
      </Link>
    </li>
  );
}

export default function BundlePage() {
  const { id } = useParams<{ id: string }>();
  const { goBack } = useApp();
  const { data, error, isLoading, mutate } = useSWR<{ bundle: Bundle }>(`/api/bundles/${id}`, fetcher, {
    refreshInterval: (latest) => (latest?.bundle.polishing ? 2500 : 0),
  });
  const { start, busyId } = useStartBundle();

  const back = (
    <div className="block-head" style={{ minHeight: 44 }}>
      <button type="button" className="back-pill" onClick={goBack}>
        <Icon name="back" />
        Back
      </button>
    </div>
  );

  if (error && !data) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div className="gutter">
        <header className="page-head with-back">{back}</header>
        <div className="msg" role="alert">
          <p>{missing ? "That plan isn't here any more." : "This plan didn't load. Check your connection."}</p>
          {missing ? (
            <Link href="/home" className="btn">
              Back to Home
            </Link>
          ) : (
            <button type="button" className="btn" onClick={() => void mutate()}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="gutter">
        <header className="page-head with-back">{back}</header>
        <div className="stack-col" style={{ marginTop: 18 }} role="status">
          <span className="vh">Loading this plan</span>
          <span className="skel" style={{ height: 34, width: "70%" }} />
          <span className="skel" style={{ height: 76, borderRadius: 20, width: "100%" }} />
          <span className="skel" style={{ height: 76, borderRadius: 20, width: "100%", marginTop: 0 }} />
        </div>
      </div>
    );
  }

  const b = data.bundle;
  const kind = kindOf(b.type);
  const slotKind = b.type === "workout" || b.type === "place";
  const isRecipe = b.type === "recipe";
  const busy = busyId === b.id;
  const started = b.status === "started";

  return (
    <div className="gutter" style={kind ? tint(kind.color) : undefined}>
      <header className="page-head with-back">
        {back}
        <p className="bhead-kind">
          {kind && <Icon name={kind.icon} />}
          {b.count_label}
          {b.polishing && <span className="bhead-wait">Naming it</span>}
        </p>
        <h1 className="page-title" style={{ marginTop: 8 }}>
          {b.title}
        </h1>
        <p className="page-sub bhead-blurb">{b.blurb}</p>
      </header>

      {b.can_start && (
        <div className="bstart">
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={async () => {
              const next = await start(b);
              if (next) await mutate({ bundle: next }, { revalidate: false });
            }}
          >
            {busy ? "Adding" : b.cta}
          </button>
          <p className="bstart-note">One tap adds all of these to your week. Nothing is added before that.</p>
        </div>
      )}
      {isRecipe && (
        <div className="bstart bstart-two">
          {b.items[0] && (
            <Link href={`/s/${b.items[0].save_id}?cook=1`} className="btn btn-primary">
              Start now
            </Link>
          )}
          {(b.groceries?.length ?? 0) > 0 && (
            <a href="#groceries" className="btn">
              <Icon name="basket" />
              Shop the list
            </a>
          )}
        </div>
      )}
      {started && (
        <p className="bdone">
          <Icon name="check" />
          On your week. Change any one of them from its reel.
        </p>
      )}

      {b.type === "product" && b.pick && (
        <Link href={`/s/${b.pick.save_id}`} className="bpick">
          <span className="bpick-label">
            <Icon name="spark" />
            The one the reels back most
          </span>
          <span className="bpick-name">{b.pick.name}</span>
          {b.pick.why && <span className="bpick-why">{b.pick.why}</span>}
        </Link>
      )}

      <section className="sec" aria-labelledby="in-h" style={{ marginTop: 28 }}>
        <h2 className="sec-title" id="in-h">
          {isRecipe ? "Pick one to cook" : slotKind ? "What's in it" : "From these reels"}
        </h2>
        <ol className="bitems">
          {b.items.map((item, i) => (
            <ItemRow key={item.save_id} item={item} index={i} slotKind={slotKind} cook={isRecipe} />
          ))}
        </ol>
      </section>

      {b.type === "product" && (b.products?.length ?? 0) > 0 && (
        <section className="sec" aria-labelledby="cmp-h">
          <h2 className="sec-title" id="cmp-h">
            Side by side
          </h2>
          <ul className="cmp">
            {b.products!.map((p, i) => (
              <li key={`${p.save_id}:${p.name}:${i}`} className={b.pick?.name.toLowerCase() === p.name.toLowerCase() ? "is-pick" : undefined}>
                <span className="cmp-name">
                  {p.name}
                  {p.price_hint && <span className="cmp-price">{p.price_hint}</span>}
                </span>
                {p.brand && p.brand.toLowerCase() !== p.name.toLowerCase() && <span className="cmp-brand">{p.brand}</span>}
                {p.why && <span className="cmp-why">{p.why}</span>}
                {p.where_to_buy && <span className="cmp-where">{p.where_to_buy}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {b.type === "recipe" && (b.groceries?.length ?? 0) > 0 && <Groceries bundle={b} groups={b.groceries!} />}
    </div>
  );
}
