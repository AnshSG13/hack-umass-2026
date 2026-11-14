"use client";

// App shell (DESIGN.md section 4): 56 px header, 64 px bottom tab bar, a 440 px app column,
// and at 1100 px or wider the 560 px "How it was planned" side panel.

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarCheck, Library, MessageCircle, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { ToastViewport, useToast } from "@/components/toast";
import { TraceBody, TraceContext, type TraceApi } from "@/components/trace";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { api, ApiError, clearKey, setKey } from "@/lib/api";
import { browserTimezone, useConfig, useIsDesk, useKey, useMe } from "@/lib/hooks";
import { btnText } from "@/lib/styles";
import type { AskCard, StepLine, Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---- Ask keeps its conversation while you move between tabs ----

export interface AskTurn {
  id: number;
  question: string;
  steps: StepLine[];
  cards: AskCard[];
  tickets: Ticket[];
  answer: { text: string; confidence: "high" | "low" | "none" } | null;
  error: string | null;
  done: boolean;
}

interface AskStore {
  turns: AskTurn[];
  setTurns: React.Dispatch<React.SetStateAction<AskTurn[]>>;
}

const AskContext = createContext<AskStore>({ turns: [], setTurns: () => {} });

export function useAskStore(): AskStore {
  return useContext(AskContext);
}

// ---- tabs ----

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
}

const TABS: Tab[] = [
  { href: "/plans", label: "Plans", icon: CalendarCheck, match: (p) => p.startsWith("/plans") },
  { href: "/library", label: "Library", icon: Library, match: (p) => p.startsWith("/library") || p.startsWith("/s/") },
  { href: "/ask", label: "Ask", icon: MessageCircle, match: (p) => p.startsWith("/ask") },
];
const SAMPLES_TAB: Tab = { href: "/demo", label: "Samples", icon: Sparkles, match: (p) => p.startsWith("/demo") };

export function AppShell({ children }: { children: React.ReactNode }) {
  const key = useKey();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { appName } = useConfig();
  const { data: me, error: meError } = useMe(Boolean(key));
  const isDesk = useIsDesk();
  const toast = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [restarting, setRestarting] = useState(false);

  // No key on an app route: back to the landing page (SPEC 13.2).
  useEffect(() => {
    if (key === null) router.replace("/");
  }, [key, router]);

  // A key the server no longer knows (rotated, or an expired demo) is the same as no key.
  useEffect(() => {
    if (meError instanceof ApiError && meError.status === 401) clearKey();
  }, [meError]);

  const select = useCallback((id: string | null) => setSelectedId(id), []);
  const show = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (!isDesk) setSheetOpen(true);
    },
    [isDesk],
  );
  const trace = useMemo<TraceApi>(
    () => ({ available: true, selectedId, select, show }),
    [selectedId, select, show],
  );
  const ask = useMemo(() => ({ turns, setTurns }), [turns]);

  async function startOver() {
    setRestarting(true);
    try {
      const r = await api<{ api_key: string }>("/api/demo/session", { body: { timezone: browserTimezone() } });
      setTurns([]);
      setSelectedId(null);
      try {
        window.sessionStorage.removeItem("rl_demo_added");
      } catch {
        /* private mode */
      }
      setKey(r.api_key);
    } catch {
      toast.show("A new demo didn't start. Try again.");
    } finally {
      setRestarting(false);
    }
  }

  if (!key) return <div className="min-h-dvh bg-paper" />;

  const isDemo = Boolean(me?.is_demo);
  const tabs = isDemo ? [SAMPLES_TAB, ...TABS] : TABS;

  return (
    <TraceContext.Provider value={trace}>
      <AskContext.Provider value={ask}>
        <div
          data-shell=""
          className="mx-auto w-full max-w-[440px] desk:grid desk:max-w-[1024px] desk:grid-cols-[440px_560px] desk:gap-6"
        >
          <div className="flex min-h-dvh min-w-0 flex-col">
            <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 bg-paper px-4">
              <div className="flex min-w-0 items-center gap-2">
                <Link href="/plans" className="wide inline-flex min-h-11 items-center rounded-[4px] text-[20px] leading-none text-ink">
                  {appName}
                </Link>
                {isDemo && (
                  <span className="inline-flex h-[22px] items-center rounded-full border border-line-strong px-2 text-[13px] leading-none text-muted">
                    Demo
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center">
                {isDemo && pathname.startsWith("/demo") && (
                  <button type="button" className={btnText} disabled={restarting} onClick={() => void startOver()}>
                    Start over
                  </button>
                )}
                <Link
                  href="/settings"
                  aria-label="Settings"
                  aria-current={pathname.startsWith("/settings") ? "page" : undefined}
                  className="-mr-2 inline-flex size-11 items-center justify-center rounded-[12px] text-ink"
                >
                  <Settings aria-hidden="true" className="size-[22px]" />
                </Link>
              </div>
            </header>

            <main className="flex-1 px-4 pt-2 pb-[calc(64px+32px+env(safe-area-inset-bottom))]">
              {/* A new key is a different account: pages start over with it. */}
              <Fragment key={key}>{children}</Fragment>
            </main>
          </div>

          <aside className="sticky top-0 hidden h-dvh overflow-y-auto py-4 desk:block" aria-label="How it was planned">
            <div className="min-h-full rounded-[16px] border border-line bg-ticket p-6">
              <h2 className="text-[20px] leading-[1.3] font-semibold text-ink">How it was planned</h2>
              <div className="mt-4">
                {selectedId ? (
                  <TraceBody key={selectedId} saveId={selectedId} />
                ) : (
                  <p className="text-[15px] text-muted">
                    Pick a ticket to see each step the agent took to plan it.
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>

        <nav
          aria-label="Main"
          className="sheet-frame fixed bottom-0 z-40 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]"
        >
          <ul className="flex h-16">
            {tabs.map((tab) => {
              const active = tab.match(pathname);
              const Icon = tab.icon;
              return (
                <li key={tab.href} className="flex-1">
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex h-16 flex-col items-center justify-center gap-1 text-[13px] leading-none -outline-offset-2",
                      active ? "font-semibold text-ink" : "text-muted",
                    )}
                  >
                    {active && <span aria-hidden="true" className="absolute top-[-1px] right-4 left-4 h-0.5 bg-ink" />}
                    <Icon aria-hidden="true" className="size-[22px]" strokeWidth={active ? 2.25 : 2} />
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <ToastViewport aboveTabBar />

        <Sheet open={sheetOpen && !isDesk} onOpenChange={setSheetOpen}>
          <SheetContent aria-describedby={undefined}>
            <SheetTitle>How it was planned</SheetTitle>
            <div className="mt-3">{selectedId && <TraceBody saveId={selectedId} />}</div>
            <SheetClose className={cn(btnText, "mt-3 w-full")}>Close</SheetClose>
          </SheetContent>
        </Sheet>
      </AskContext.Provider>
    </TraceContext.Provider>
  );
}
