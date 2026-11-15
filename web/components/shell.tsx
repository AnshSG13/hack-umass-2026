"use client";

// App shell, after the mockup: one phone-wide column, the floating bottom bar (Home, the
// orb, Plans), the "Add a reel" sheet and the toast. It also holds what has to survive
// moving between screens: the Ask conversation, a question on its way to Ask, and the
// saves just added (so Home can show them first, still processing).

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AddSheet } from "@/components/add-sheet";
import { Icon } from "@/components/icons";
import { Orb } from "@/components/orb";
import { ToastViewport, useToast } from "@/components/toast";
import { api, ApiError, clearKey, setKey } from "@/lib/api";
import { browserTimezone, useConfig, useKey, useMe, useRefresh } from "@/lib/hooks";
import type { AskCard, SaveResponse, StepLine, Ticket } from "@/lib/types";

// ---- Ask keeps its conversation while you move between screens ----

export interface AskTurn {
  id: number;
  question: string;
  steps: StepLine[];
  cards: AskCard[];
  tickets: Ticket[];
  answer: { text: string; confidence: "high" | "low" | "none"; followUps: string[] } | null;
  error: string | null;
  done: boolean;
  /** The question was dictated with the orb, not typed. */
  spoken?: boolean;
}

/** A question handed to Ask from somewhere else. Held in memory only, so a reload never re-sends it. */
export interface AskHandoff {
  id: number;
  text: string;
  /** true: send it now. false: put it in the input and focus it. */
  send: boolean;
  /** It was said out loud. */
  spoken?: boolean;
}

interface AskStore {
  turns: AskTurn[];
  setTurns: React.Dispatch<React.SetStateAction<AskTurn[]>>;
  /** The kept chat these turns belong to; null until the first answer is kept. */
  chatId: string | null;
  setChatId: (id: string | null) => void;
  handoff: AskHandoff | null;
  /** Hand a question to Ask and go there. */
  ask: (text: string, send: boolean, spoken?: boolean) => void;
  clearHandoff: () => void;
}

const AskContext = createContext<AskStore>({
  turns: [],
  setTurns: () => {},
  chatId: null,
  setChatId: () => {},
  handoff: null,
  ask: () => {},
  clearHandoff: () => {},
});

export function useAskStore(): AskStore {
  return useContext(AskContext);
}

// ---- the rest of what screens share ----

export interface FreshSave {
  save_id: string;
  ticket: Ticket | null;
}

interface AppApi {
  /** Open the "Add a reel" sheet. */
  openAdd: () => void;
  /** Saves added in this session, newest first. */
  fresh: FreshSave[];
  /** Back one screen, or Home when this is the first screen of the visit. */
  goBack: () => void;
  /** A save was deleted: drop it from the just-added list. */
  forget: (saveId: string) => void;
}

const AppContext = createContext<AppApi>({ openAdd: () => {}, fresh: [], goBack: () => {}, forget: () => {} });

export function useApp(): AppApi {
  return useContext(AppContext);
}

/** Screens that keep their earlier layout and get a plain back row on top. */
function isPlain(path: string): boolean {
  return path.startsWith("/demo") || path.startsWith("/save") || path.startsWith("/settings");
}

/** Full-screen pages with no bottom bar and no back row: the guided first open. */
function isBare(path: string): boolean {
  return path.startsWith("/story");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const key = useKey();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { appName } = useConfig();
  const { data: me, error: meError } = useMe(Boolean(key));
  const toast = useToast();
  const refresh = useRefresh();

  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<AskHandoff | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [fresh, setFresh] = useState<FreshSave[]>([]);
  const [restarting, setRestarting] = useState(false);
  const handoffId = useRef(0);

  // No key on an app route: back to the landing page.
  useEffect(() => {
    if (key === null) router.replace("/");
  }, [key, router]);

  // Only a new real account (no intro done and nothing saved yet) goes to the intro first.
  // Accounts that already have saves are left alone; Settings has "Redo the intro" for them.
  useEffect(() => {
    if (me && !me.onboarded && !me.is_demo && me.counts.saves === 0) router.replace("/welcome");
  }, [me, router]);

  // A key the server no longer knows (rotated, or an expired demo) is the same as no key.
  useEffect(() => {
    if (meError instanceof ApiError && meError.status === 401) clearKey();
  }, [meError]);

  // How many screens deep this visit is, so Back knows whether there is anything behind it.
  const depth = useRef(0);
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== firstPath.current) depth.current += 1;
  }, [pathname]);

  const goBack = useCallback(() => {
    if (depth.current > 0 && window.history.length > 1) router.back();
    else router.replace("/home");
  }, [router]);

  const ask = useCallback(
    (text: string, send: boolean, spoken?: boolean) => {
      handoffId.current += 1;
      setHandoff({ id: handoffId.current, text, send, spoken });
      if (!pathname.startsWith("/ask")) router.push("/ask");
    },
    [pathname, router],
  );
  const clearHandoff = useCallback(() => setHandoff(null), []);

  const openAdd = useCallback(() => setAddOpen(true), []);

  const onSaved = useCallback(
    (r: SaveResponse) => {
      setAddOpen(false);
      setFresh((list) => [{ save_id: r.save_id, ticket: r.ticket }, ...list.filter((f) => f.save_id !== r.save_id)]);
      refresh();
      if (!pathname.startsWith("/home")) router.push("/home");
    },
    [pathname, refresh, router],
  );

  const askStore = useMemo(
    () => ({ turns, setTurns, chatId, setChatId, handoff, ask, clearHandoff }),
    [turns, chatId, handoff, ask, clearHandoff],
  );
  const forget = useCallback((saveId: string) => setFresh((list) => list.filter((f) => f.save_id !== saveId)), []);
  const app = useMemo(() => ({ openAdd, fresh, goBack, forget }), [openAdd, fresh, goBack, forget]);

  async function startOver() {
    setRestarting(true);
    try {
      const r = await api<{ api_key: string }>("/api/demo/session", { body: { timezone: browserTimezone() } });
      setTurns([]);
      setFresh([]);
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

  const plain = isPlain(pathname);
  const bare = isBare(pathname);
  const onHome = pathname.startsWith("/home");
  const onPlans = pathname.startsWith("/plans");

  return (
    <AppContext.Provider value={app}>
      <AskContext.Provider value={askStore}>
        <div data-shell="" className="app">
          {plain && !bare && (
            <div className="plain-head gutter">
              <button type="button" className="back-pill" onClick={goBack}>
                <Icon name="back" />
                Back
              </button>
              {me?.is_demo && pathname.startsWith("/demo") && (
                <button type="button" className="text-btn" disabled={restarting} onClick={() => void startOver()}>
                  Start over
                </button>
              )}
            </div>
          )}
          <main className={bare ? "story-screen" : plain ? "screen gutter" : "screen"}>
            {/* A new key is a different account: pages start over with it. */}
            <Fragment key={key}>{children}</Fragment>
          </main>
        </div>

        {!bare && (
          <nav className="bar" aria-label="Main">
            <Link href="/home" className="tab" aria-current={onHome ? "page" : undefined}>
              <Icon name="home" />
              Home
            </Link>
            <Orb
              appName={appName}
              onOpen={() => ask("", false)}
              onHeard={(text) => ask(text, true, true)}
              onProblem={(message) => toast.show(message)}
            />
            <Link href="/plans" className="tab" aria-current={onPlans ? "page" : undefined}>
              <Icon name="plans" />
              Actions
            </Link>
          </nav>
        )}

        {/* On the bare pages it sits above their pinned button, where the bar would be. */}
        <ToastViewport aboveTabBar />

        <AddSheet open={addOpen} onOpenChange={setAddOpen} isDemo={Boolean(me?.is_demo)} onSaved={onSaved} />
      </AskContext.Provider>
    </AppContext.Provider>
  );
}
