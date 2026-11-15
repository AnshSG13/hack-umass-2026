"use client";

// The guided first open (/story). Whether it was seen is kept in this browser only, and
// only decides whether Home offers "Replay the story" to a demo account. Nothing waits on it.

import { useSyncExternalStore } from "react";

const SEEN = "rl_story_seen";
const EVENT = "rl-story-seen";

/** GET /api/demo/story (demo accounts only). */
export interface DemoStory {
  recipe: {
    url: string;
    shortcode: string;
    title: string | null;
    creator: string | null;
    thumb_url: string | null;
    save_id: string | null;
    has_answer: boolean;
  } | null;
  trip_save_id: string | null;
}

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}

export function markStorySeen(): void {
  try {
    window.localStorage.setItem(SEEN, "1");
  } catch {
    /* private mode: Home just won't offer the replay */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** false while rendering on the server and before hydration. */
export function useStorySeen(): boolean {
  return useSyncExternalStore(subscribe, readSeen, () => false);
}

/** Where "Replay the story" goes: the first beat, even after the reel was saved. */
export const STORY_REPLAY_HREF = "/story?at=start";
