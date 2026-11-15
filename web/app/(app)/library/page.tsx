"use client";

// Folders, the browsing tab: search (what was said or shown), then the reel from before to
// remember, the newest saves, a folder per kind, questions to ask about them, and every
// save as a list. ?focus=1 focuses the search; ?type=recipe searches one folder only.

import { Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { useNow } from "@/components/bits";
import { AskAboutSaves, RECENT_KEY, RecentSaves, RememberCard, YourFolders } from "@/components/folders";
import { Icon } from "@/components/icons";
import { PullToRefresh } from "@/components/pull-refresh";
import { SaveRow } from "@/components/save-row";
import { useApp } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { plural } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { KIND_ORDER, KINDS } from "@/lib/kinds";
import type { SavesPage, SaveType, SearchResult } from "@/lib/types";

const PAGE = 30;
const MAX_LIMIT = 100; // the API's cap on ?limit

function asType(value: string | null): SaveType | null {
  return value && (KIND_ORDER as string[]).includes(value) ? (value as SaveType) : null;
}

function Skeleton() {
  return (
    <div className="stack-col" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="skel" style={{ height: 68, width: "100%", borderRadius: 14, marginTop: 0 }} />
      ))}
    </div>
  );
}

function Rows({ items }: { items: SavesPage["items"] }) {
  return (
    <ul className="rows">
      {items.map((t) => (
        <li key={t.save_id}>
          <SaveRow ticket={t} when={`Saved ${t.saved_on}`} />
        </li>
      ))}
    </ul>
  );
}

/** "All saves": every save, newest first, thirty at a time. */
function AllSaves() {
  const [limit, setLimit] = useState(PAGE);
  const list = useSWR<SavesPage>(`/api/saves?limit=${limit}`, fetcher, { keepPreviousData: true });
  const items = list.data?.items ?? [];
  const canShowMore = Boolean(list.data?.next_before) && limit < MAX_LIMIT;

  return (
    <section className="blk gutter" aria-labelledby="all-h">
      <div className="block-head">
        <h2 className="block-title" id="all-h">
          All saves
        </h2>
      </div>
      <div aria-live="polite">
        {list.error && !list.data ? (
          <div role="alert" className="msg">
            <p>Your saves didn&apos;t load. Check your connection.</p>
            <button type="button" className="btn" onClick={() => void list.mutate()}>
              Try again
            </button>
          </div>
        ) : !list.data ? (
          <Skeleton />
        ) : items.length === 0 ? (
          <p className="msg">Nothing here yet.</p>
        ) : (
          <Rows items={items} />
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
    </section>
  );
}

function Folders() {
  const router = useRouter();
  const params = useSearchParams();
  const { openAdd, fresh } = useApp();
  const now = useNow();
  const { data: me } = useMe();
  const type = asType(params.get("type"));
  const wantsFocus = params.get("focus") === "1";
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
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
  const search = useSWR<SearchResult>(
    searching ? `/api/search?q=${encodeURIComponent(debounced)}${type ? `&type=${type}` : ""}` : null,
    fetcher,
    { keepPreviousData: true },
  );
  // The same request as the rail of recent saves, so it is asked once.
  const recent = useSWR<SavesPage>(RECENT_KEY, fetcher);
  const isEmpty = recent.data !== undefined && recent.data.items.length === 0 && fresh.length === 0;
  const total = me?.counts.saves;

  // Pull down at the top: ask the server again for everything this screen shows.
  const { mutate } = useSWRConfig();
  const reload = useCallback(
    () =>
      mutate(
        (key) => typeof key === "string" && key.startsWith("/api/") && key !== "/api/config" && key !== "/api/health",
      ),
    [mutate],
  );

  const head = (
    <header className="page-head">
      <h1 className="page-title">Folders</h1>
      {total !== undefined && total > 0 && <p className="page-sub">{plural(total, "save", "saves")}</p>}
    </header>
  );

  if (isEmpty) {
    return (
      <>
        <PullToRefresh onRefresh={reload} />
        <div className="gutter">
          {head}
          <div className="empty">
            <h2 className="empty-title">Nothing saved yet</h2>
            <p className="empty-text">Add a reel from Instagram and it comes back with a plan.</p>
            <button type="button" className="btn btn-primary" onClick={openAdd}>
              <Icon name="plus" />
              Add a reel
            </button>
          </div>
        </div>
      </>
    );
  }

  const results = search.data?.items ?? [];

  return (
    <div className="folders">
      <PullToRefresh onRefresh={reload} />
      <div className="gutter">
        {head}
        <label className="search search-field" htmlFor={searchId}>
          <Icon name="search" />
          <span className="vh">Search what was said or shown</span>
          <input
            id={searchId}
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder={type ? `Search ${KINDS[type].label}` : "Search what was said or shown"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {type && (
          <p className="folders-scope">
            <span>Only in {KINDS[type].label}</span>
            <button
              type="button"
              className="text-btn"
              onClick={() => router.replace("/library?focus=1", { scroll: false })}
            >
              Search all saves
            </button>
          </p>
        )}
      </div>

      {searching ? (
        <div className="gutter folders-results" aria-live="polite">
          {search.error && !search.data ? (
            <div role="alert" className="msg">
              <p>Search didn&apos;t load. Check your connection.</p>
              <button type="button" className="btn" onClick={() => void search.mutate()}>
                Try again
              </button>
            </div>
          ) : !search.data ? (
            <Skeleton />
          ) : results.length === 0 ? (
            <p className="msg">{`Nothing matches “${debounced}”. Try a word they said in the video.`}</p>
          ) : (
            <Rows items={results} />
          )}
        </div>
      ) : (
        <>
          <RememberCard />
          <RecentSaves now={now} />
          <YourFolders />
          <AskAboutSaves />
          <AllSaves />
        </>
      )}
    </div>
  );
}

export default function LibraryPage() {
  // useSearchParams needs a Suspense boundary so the rest of the shell can prerender.
  return (
    <Suspense fallback={null}>
      <Folders />
    </Suspense>
  );
}
