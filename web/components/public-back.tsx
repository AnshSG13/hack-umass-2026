"use client";

// A way back from the pages made to be shared (a recipe card, an itinerary, a plan). Someone
// signed in reached it from inside the app, and in the iPhone Home Screen app there is no
// browser bar: without this the page is a dead end. A friend who got the link sees nothing.

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { useKey } from "@/lib/hooks";

export function PublicBack({ className }: { className?: string }) {
  const router = useRouter();
  const key = useKey();
  if (!key) return null; // signed out, or still hydrating
  return (
    <button
      type="button"
      className={["back-pill", className].filter(Boolean).join(" ")}
      onClick={() => {
        // Back where they came from when there is somewhere to go; otherwise Home.
        if (window.history.length > 1) router.back();
        else router.push("/home");
      }}
    >
      <Icon name="back" />
      Back
    </button>
  );
}
