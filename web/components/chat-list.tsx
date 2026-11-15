"use client";

// Every chat in one place: Ask chats (about all the saves) and reel chats (about one reel),
// newest first. A row picks the chat up where it was left: Ask chats open on the Ask page,
// reel chats open over their reel's page.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useNow } from "@/components/bits";
import { Icon } from "@/components/icons";
import { fetcher } from "@/lib/api";
import { plural, relativeTime } from "@/lib/format";
import { kindTint } from "@/lib/kinds";
import type { ChatSummary } from "@/lib/types";

export const CHATS_KEY = "/api/chats";
const FIRST = 5;

export function chatHref(c: ChatSummary): string {
  return c.reel ? `/s/${c.reel.save_id}?chat=${c.id}` : `/ask?chat=${c.id}`;
}

export function ChatList({ current }: { current?: string | null }) {
  const { data } = useSWR<{ chats: ChatSummary[] }>(CHATS_KEY, fetcher, { revalidateOnFocus: false });
  const now = useNow();
  const [all, setAll] = useState(false);
  const chats = (data?.chats ?? []).filter((c) => c.id !== current);
  if (chats.length === 0) return null;
  const shown = all ? chats : chats.slice(0, FIRST);
  return (
    <section className="chats" aria-labelledby="chats-h">
      <h2 className="chats-h" id="chats-h">
        Your chats
      </h2>
      <ul className="chats-list">
        {shown.map((c) => (
          <li key={c.id}>
            <Link href={chatHref(c)} className="chat-row">
              {c.reel ? (
                <span className="chat-thumb" style={kindTint(c.reel.type)} aria-hidden="true">
                  {c.reel.thumb_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.reel.thumb_url} alt="" />
                  ) : (
                    <Icon name="bookmark" />
                  )}
                </span>
              ) : (
                <span className="chat-thumb is-ask" aria-hidden="true">
                  <Icon name="spark" />
                </span>
              )}
              <span className="chat-text">
                <span className="chat-title">{c.title}</span>
                {c.preview && <span className="chat-preview">{c.preview}</span>}
                <span className="chat-meta">
                  {relativeTime(c.updated_at, now)} · {plural(c.questions, "question", "questions")} ·{" "}
                  {c.reel ? c.reel.title : "Across your saves"}
                </span>
              </span>
              <Icon name="right" />
            </Link>
          </li>
        ))}
      </ul>
      {chats.length > FIRST && (
        <button type="button" className="chats-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${chats.length}`}
        </button>
      )}
    </section>
  );
}
