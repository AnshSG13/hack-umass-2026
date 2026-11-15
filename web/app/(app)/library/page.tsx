"use client";

// The saves list: search (what was said or shown), filter by kind, rows that open the Reel
// page. Home sends people here with ?focus=1 (the search box) or ?type=recipe (a taste).

import { Suspense, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { SaveRow } from "@/components/save-row";
import { useApp } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { plural } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { KIND_ORDER, KINDS, tint } from "@/lib/kinds";
import type { SavesPage, SaveType, SearchResult, TastesResponse } from "@/lib/types";

const PAGE = 30;
const MAX_LIMIT = 100; // the API's cap on ?limit

function asType(value: string | null): SaveType | null {
  return value && (KIND_ORDER as string[]).includes(value) ? (value as SaveType) : null;
}

function BackHome() {
  return (
    <Link href="/collection" className="back-pill">
      <Icon name="back" />
      My collection
    </Link>
  );
}

function SavesList() {
  const router = useRouter();
  const params = useSearchParams();
  const { openAdd } = useApp();
  const { data: me } = useMe();
  const type = asType(params.get("type"));
  const sub = type ? params.get("sub") : null;
  const tastes = useSWR<TastesResponse>("/api/tastes", fetcher);
  const subs = type ? (tastes.data?.tastes.find((t) => t.type === type)?.subcategories ?? []) : [];
  const wantsFocus = params.get("focus") === "1";
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const searchId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (wantsFocus) inputRef.current?.focus();
  }, [wantsFocus]);

  const searching = debounced.length > 0;
  const typeParam = (type ? `&type=${type}` : "") + (sub ? `&sub=${encodeURIComponent(sub)}` : "");
  const list = useSWR<SavesPage>(searching ? null : `/api/saves?limit=${limit}${typeParam}`, fetcher, {
    keepPreviousData: true,
  });
  const search = useSWR<SearchResult>(
    searching ? `/api/search?q=${encodeURIComponent(debounced)}${typeParam}` : null,
    fetcher,
    { keepPreviousData: true },
  );

  const active = searching ? search : list;
  const items = active.data?.items ?? [];
  const total = me?.counts.saves;
  const nothingSaved = !searching && !type && list.data !== undefined && list.data.items.length === 0;
  const canShowMore = !searching && Boolean(list.data?.next_before) && limit < MAX_LIMIT;

  function pick(next: SaveType | null) {
    setLimit(PAGE);
    router.replace(next ? `/library?type=${next}` : "/library", { scroll: false });
  }

  function pickSub(next: string | null) {
    if (!type) return;
    setLimit(PAGE);
    router.replace(`/library?type=${type}${next ? `&sub=${encodeURIComponent(next)}` : ""}`, { scroll: false });
  }

  const head = (
    <header className="page-head with-back">
      <div className="block-head" style={{ minHeight: 44 }}>
        <BackHome />
      </div>
      <h1 className="page-title" style={{ marginTop: 10 }}>
        Your saves
      </h1>
      {total !== undefined && <p className="page-sub">{plural(total, "save", "saves")}</p>}
    </header>
  );

  if (nothingSaved) {
    return (
      <div className="gutter">
        {head}
        <div className="empty">
          <h2 className="empty-title">Nothing saved yet</h2>
          <p className="empty-text">Every reel you add lands here, plan or not.</p>
          <button type="button" className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" />
            Add a reel
          </button>
        </div>
      </div>
    );
  }

  // "All", then every kind this account has saved (and the one picked, even at zero).
  const kinds = KIND_ORDER.filter((t) => t === type || me === undefined || (me.counts.by_type[t] ?? 0) > 0);

  return (
    <>
      <div className="gutter">
        {head}
        <label className="search search-field" htmlFor={searchId} style={{ marginTop: 18 }}>
          <Icon name="search" />
          <span className="vh">Search what was said or shown</span>
          <input
            id={searchId}
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Search what was said or shown"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="filters" role="group" aria-label="Filter by kind">
        <button type="button" className="fchip" aria-pressed={type === null} onClick={() => pick(null)}>
          All
          {total !== undefined && <b>{total}</b>}
        </button>
        {kinds.map((t) => {
          const k = KINDS[t];
          const count = me?.counts.by_type[t];
          return (
            <button
              key={t}
              type="button"
              className="fchip"
              style={tint(k.color)}
              aria-pressed={type === t}
              onClick={() => pick(t)}
            >
              <Icon name={k.icon} />
              {k.label}
              {count !== undefined && <b>{count}</b>}
            </button>
          );
        })}
      </div>

      {type && subs.length > 0 && (
        <div className="filters" role="group" aria-label={`Filter ${KINDS[type].label} by sub-category`}>
          <button type="button" className="fchip" aria-pressed={sub === null} onClick={() => pickSub(null)}>
            All {KINDS[type].label}
          </button>
          {subs.map((s) => (
            <button
              key={s.name}
              type="button"
              className="fchip"
              style={tint(KINDS[type].color)}
              aria-pressed={sub === s.name}
              onClick={() => pickSub(s.name)}
            >
              {s.name}
              <b>{s.count}</b>
            </button>
          ))}
        </div>
      )}

      <div className="gutter" aria-live="polite">
        {active.error && !active.data ? (
          <div role="alert" className="msg">
            <p>{searching ? "Search didn't load. Check your connection." : "Your saves didn't load. Check your connection."}</p>
            <button type="button" className="btn" onClick={() => void active.mutate()}>
              Try again
            </button>
          </div>
        ) : !active.data ? (
          <div className="stack-col" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel" style={{ height: 68, width: "100%", borderRadius: 14, marginTop: 0 }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="msg">
            {searching
              ? `Nothing matches “${debounced}”. Try a word they said in the video.`
              : type
                ? `Nothing filed under ${KINDS[type].label}${sub ? ` › ${sub}` : ""} yet.`
                : "Nothing here yet."}
          </p>
        ) : (
          <ul className="rows">
            {items.map((t) => (
              <li key={t.save_id}>
                <SaveRow ticket={t} when={`Saved ${t.saved_on}`} />
              </li>
            ))}
          </ul>
        )}

        {canShowMore && (
          <button
            type="button"
            className="btn btn-block"
            style={{ marginTop: 12 }}
            onClick={() => setLimit((n) => Math.min(MAX_LIMIT, n + PAGE))}
          >
            Show more
          </button>
        )}
      </div>
    </>
  );
}

export default function LibraryPage() {
  // useSearchParams needs a Suspense boundary so the rest of the shell can prerender.
  return (
    <Suspense fallback={null}>
      <SavesList />
    </Suspense>
  );
}
