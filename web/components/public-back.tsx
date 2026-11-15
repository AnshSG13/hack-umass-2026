"use client";

// Ways out of the pages made to be shared (a recipe card, an itinerary, a plan). In the
// iPhone Home Screen app there is no browser bar, and a friend who got the link has no app
// around the page at all: without these the page is a dead end.
//
// PublicClose is an X everyone gets, pinned to the top right. PublicBack is the app's own
// Back pill, for someone signed in who came from inside the app.

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { useKey } from "@/lib/hooks";

type Router = ReturnType<typeof useRouter>;

/** True when this tab came here from inside the app (the shell marks the tab), so going
 *  back lands on the screen they opened this from. */
function cameFromApp(): boolean {
  try {
    return window.sessionStorage.getItem("rl_in_app") === "1" && window.history.length > 1;
  } catch {
    return false;
  }
}

/** Leave the page. From inside the app: back to the screen it was opened from. Opened by
 *  itself (a link from Messages, a new tab): close it if the browser allows, and otherwise
 *  go Home when signed in, or to the app's front page for a friend. Never a blind
 *  history.back(), which could step out of the site. */
function leave(router: Router, signedIn: boolean) {
  if (cameFromApp()) {
    router.back();
    return;
  }
  window.close(); // only works for a tab a script opened; the next line covers the rest
  window.setTimeout(() => router.push(signedIn ? "/home" : "/"), 120);
}

export function PublicBack({ className }: { className?: string }) {
  const router = useRouter();
  const key = useKey();
  if (!key) return null; // signed out, or still hydrating
  return (
    <button type="button" className={["back-pill", className].filter(Boolean).join(" ")} onClick={() => leave(router, true)}>
      <Icon name="back" />
      Back
    </button>
  );
}

export function PublicClose({ className }: { className?: string }) {
  const router = useRouter();
  const key = useKey();
  return (
    <button
      type="button"
      className={["public-x", className].filter(Boolean).join(" ")}
      aria-label="Close"
      onClick={() => leave(router, Boolean(key))}
    >
      <Icon name="x" />
    </button>
  );
}
