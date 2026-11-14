"use client";

import { useEffect, useRef } from "react";
import { SWRConfig, useSWRConfig } from "swr";
import { MotionConfig } from "motion/react";
import { ToastProvider } from "@/components/toast";
import { ApiError } from "@/lib/api";
import { useKey } from "@/lib/hooks";

/** A new key is a different account: drop everything cached for the old one. */
function KeyWatcher() {
  const key = useKey();
  const { mutate } = useSWRConfig();
  const prev = useRef(key);
  useEffect(() => {
    if (prev.current !== undefined && prev.current !== key) {
      void mutate((k) => typeof k === "string" && k !== "/api/config", undefined, { revalidate: true });
    }
    prev.current = key;
  }, [key, mutate]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        onErrorRetry: (error, _key, config, revalidate, { retryCount }) => {
          // A bad key, a missing save or a bad link won't fix itself.
          if (error instanceof ApiError && [400, 401, 403, 404, 409, 422, 429].includes(error.status)) return;
          if (retryCount >= 3) return;
          window.setTimeout(() => void revalidate({ retryCount }), config.errorRetryInterval);
        },
      }}
    >
      {/* Motion honors prefers-reduced-motion; each motion moment also swaps to a short cross-fade. */}
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <KeyWatcher />
          {children}
        </ToastProvider>
      </MotionConfig>
    </SWRConfig>
  );
}
