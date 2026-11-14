"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { AppConfig } from "@/lib/types";

// Phase 1 skeleton: tokens, fonts and the config round trip. The landing page replaces this in phase 4.
export default function Home() {
  const { data } = useSWR<AppConfig>("/api/config", fetcher);
  return (
    <main className="mx-auto max-w-[440px] px-4 py-10">
      <p className="wide text-[20px]">{data?.app_name ?? ""}</p>
      <h1 className="wide mt-6 text-[34px] leading-[1.1]">Every save becomes a plan.</h1>
      <p className="mt-4 text-muted">
        Share a reel from Instagram. {data?.app_name ?? "It"} reads it, checks your week, and asks before it adds
        anything.
      </p>
      <p className="mt-6">
        <span className="wide tabular bg-highlighter px-1 text-[28px] leading-[1.1]">Thu 6:30 pm</span>
      </p>
    </main>
  );
}
