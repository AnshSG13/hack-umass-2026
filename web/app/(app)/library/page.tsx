"use client";

// Library (DESIGN.md 7.5): search, type chips with counts, rows, and the paste sheet.

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus, Search } from "lucide-react";
import { PasteForm, savedBeforeNote } from "@/components/paste-form";
import { SaveRow } from "@/components/save-row";
import { useToast } from "@/components/toast";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { fetcher } from "@/lib/api";
import { plural, TYPE_ORDER, TYPE_PLURAL } from "@/lib/format";
import { useMe, useRefresh } from "@/lib/hooks";
import { btnOutline, btnPrimary, btnText, inputBase, pageTitle } from "@/lib/styles";
import type { SavesPage, SaveType, SearchResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE = 30;
const MAX_LIMIT = 100; // the API's cap on ?limit

export default function LibraryPage() {
  const router = useRouter();
  const toast = useToast();
  const refresh = useRefresh();
  const { data: me } = useMe();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState<SaveType | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [pasteOpen, setPasteOpen] = useState(false);
  const searchId = useId();

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const searching = debounced.length > 0;
  const typeParam = type ? `&type=${type}` : "";
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
  const libraryEmpty = !searching && !type && list.data !== undefined && list.data.items.length === 0;
  const canShowMore = !searching && Boolean(list.data?.next_before) && limit < MAX_LIMIT;

  const pasteSheet = (
    <Sheet open={pasteOpen} onOpenChange={setPasteOpen}>
      <SheetContent aria-describedby={undefined}>
        <SheetTitle>Paste a reel link</SheetTitle>
        <div className="mt-4">
          <PasteForm
            label="Instagram reel link"
            button="Save it"
            primary
            onSaved={(r) => {
              setPasteOpen(false);
              const note = savedBeforeNote(r);
              if (note) toast.show(note);
              refresh();
              router.push(`/s/${r.save_id}`);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );

  if (libraryEmpty) {
    return (
      <div>
        <h1 className={pageTitle}>Library</h1>
        <p className="text-[14px] text-muted">0 saves</p>
        <div className="mt-6">
          <p className="text-[16px] text-ink">Every reel you share lands here, plan or not.</p>
          <button type="button" className={cn(btnPrimary, "mt-5")} onClick={() => setPasteOpen(true)}>
            Paste a reel link
          </button>
        </div>
        {pasteSheet}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <header>
          <h1 className={pageTitle}>Library</h1>
          {total !== undefined && <p className="text-[14px] text-muted">{plural(total, "save", "saves")}</p>}
        </header>
        <button type="button" className={cn(btnText, "-mr-3 shrink-0")} onClick={() => setPasteOpen(true)}>
          <Plus aria-hidden="true" className="size-4" />
          Paste a reel link
        </button>
      </div>

      <div className="relative mt-4">
        <label htmlFor={searchId} className="sr-only">
          Search what was said or shown
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted" />
        <input
          id={searchId}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Search what was said or shown"
          className={cn(inputBase, "w-full pl-10")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 py-1" role="group" aria-label="Filter by type">
        {[null, ...TYPE_ORDER].map((t) => {
          const selected = type === t;
          const count = t === null ? me?.counts.saves : me?.counts.by_type[t];
          return (
            <button
              key={t ?? "all"}
              type="button"
              aria-pressed={selected}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[15px]",
                selected ? "border-ink bg-ink font-medium text-ticket" : "border-line-strong bg-ticket text-ink",
              )}
              onClick={() => {
                setType(t);
                setLimit(PAGE);
              }}
            >
              {t === null ? "All" : TYPE_PLURAL[t]}
              {count !== undefined && (
                <span className={cn("tabular text-[13px]", selected ? "text-paper" : "text-muted")}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2" aria-live="polite">
        {active.error && !active.data ? (
          <div role="alert" className="py-4">
            <p className="text-[16px] text-ink">
              {searching ? "Search didn't load. Check your connection." : "Your library didn't load. Check your connection."}
            </p>
            <button type="button" className={cn(btnOutline, "mt-3")} onClick={() => void active.mutate()}>
              Try again
            </button>
          </div>
        ) : !active.data ? (
          <ul aria-hidden="true" className="divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-3 py-3">
                <span className="block h-[75px] w-14 rounded-[8px] bg-line" />
                <span className="flex-1">
                  <span className="mt-1 block h-4 w-3/4 rounded-full bg-line" />
                  <span className="mt-3 block h-3 w-1/3 rounded-full bg-line" />
                </span>
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className="py-4 text-[16px] text-ink">
            {searching
              ? `Nothing matches “${debounced}”. Try a word they said in the video.`
              : type && type !== "other"
                ? `No ${TYPE_PLURAL[type].toLowerCase()} here yet. Share one from Instagram and it lands here.`
                : "Nothing here yet. Share a reel from Instagram and it lands here."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((t) => (
              <li key={t.save_id}>
                <SaveRow ticket={t} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {canShowMore && (
        <button
          type="button"
          className={cn(btnOutline, "mt-3 w-full")}
          onClick={() => setLimit((n) => Math.min(MAX_LIMIT, n + PAGE))}
        >
          Show more
        </button>
      )}

      {pasteSheet}
    </div>
  );
}
