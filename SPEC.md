# Reel Brain: Build Spec

**Date:** 2026-11-14
**Status:** Approved design. This document is the single source of truth for the build. It replaces `Saved Reels Second Brain — System Design.md`.
**Audience:** a coding agent that builds the whole product from this document, and the team reviewing what it builds.

> Working name is **Reel Brain**, the iOS Shortcut is **Save to Brain**, and the in-app assistant is **Brain**. All three come from `APP_NAME` / `ASSISTANT_NAME` constants so they can be renamed in one place.

---

## Table of contents

1. Product
2. Decisions at a glance
3. Architecture
4. Repository layout
5. Data model (MongoDB Atlas)
6. Ingestion: getting reels in
7. Processing worker
8. Extraction agent
9. Card types
10. Categories and subcategories
11. Search
12. Ask: the chat agent
13. Plans
14. Reminders and Web Push
15. Voice input
16. Suggestions and Rediscover
17. API reference
18. Frontend: screens and components
19. Design system
20. PWA and iPhone specifics
21. Error handling
22. Security and privacy
23. Configuration and environment variables
24. Deployment
25. Night-one verification checklist
26. Acceptance criteria
27. Demo script and pitch
28. Out of scope

---

## 1. Product

**Problem.** People save hundreds of reels (recipes, fragrances, travel spots, basketball drills, workouts, lessons, motivation) and almost never find them again. Instagram's and TikTok's saved folders are unsorted, have no search, and never bring anything back. The useful information is locked inside the video: in the voiceover, on-screen text, or a caption that is often unrelated.

**Promise.** *Don't save it. Send it.* Share a reel to Reel Brain and:

1. **You get the useful part back.** The reel becomes a structured card: a recipe with ingredients and steps, a product with notes and price, a place with a map pin, a drill with reps and coaching cues.
2. **It's organized automatically.** It's filed into your categories and subcategories (Food → Thai, Fragrance → Summer), which the AI grows as your tastes grow.
3. **You can just ask.** "Bring up that pad thai recipe." "What was that crossover drill?"
4. **It turns into action.** "Make me a 4-day training week from my saves" or "Grocery list for my Thai recipes" produces a saved plan, with reminders when the plan has dates.

**Users for this build:** the 4-person team and demo iPhones only. No public launch, no App Store.

**Prize targets the design is built around:** Best Gemini use, Best use of MongoDB Atlas, Best UI/UX, Best agentic hack, Best impactful AI hack, Best pitch, Vultr prize.

---

## 2. Decisions at a glance

| Area | Decision |
|---|---|
| Client | Next.js web app, installed to the iPhone home screen as a PWA. Mobile-first; desktop is not a target. |
| Getting reels in | **iOS Shortcut** in the share sheet (primary), **paste link** in the app (backup), **Android Web Share Target** (bonus). |
| Platforms | Instagram Reels and TikTok. |
| Auth | Clerk. Each user also gets a personal API token for the Shortcut. |
| AI | **Gemini only.** Pro model for both agents; Flash model for cheap steps; the **Gemini embedding model** (not an LLM) for vectors. |
| Extraction | **Agentic.** A Gemini agent with tools decides whether the caption is enough, or whether to analyze the full video and/or fetch a linked page. |
| Card types | `recipe`, `product`, `travel`, `sports_drill`, `workout_plan`, `educational`, `motivational`. |
| Categories | AI-grown categories **and subcategories**, seeded from interests chosen at onboarding, fully editable. Category centroid embeddings drive filing and search routing. |
| Database | MongoDB Atlas: documents, Vector Search, Atlas Search, `$rankFusion` hybrid search, Change Streams, and the job queue. |
| Embeddings | Gemini embedding model, 768 dimensions, L2-normalized. |
| Chat | Agent that **reads and acts**: search, open reels, create and update plans, set reminders. Streams responses. |
| Plans | **Dynamic.** The agent composes any plan from a fixed set of renderable blocks. |
| Reminders | **Plan-linked** Web Push only. Rediscover of old saves is an in-app section, not a push. |
| Voice | Hold the orb to record; audio is transcribed by Gemini Flash and sent to Ask as text. |
| Hosting | Next.js on **Vercel**. Python worker and reminder scheduler on a **Vultr** VPS. Same worker can run on a laptop as a fallback. |
| Failure policy | If the video can't be downloaded, the reel is marked **failed** with a reason and a Retry button. No caption-only fallback. |
| Video retention | Videos are deleted after processing. We keep text, embeddings, a small thumbnail, and the original link. |

---

## 3. Architecture

```
 iPhone                                                       Vercel (Next.js, Clerk)
 ┌──────────────────────────────┐   POST /api/ingest          ┌───────────────────────────────┐
 │ Instagram / TikTok           │   Authorization: Bearer     │ PWA pages (App Router)        │
 │  → Share → "Save to Brain"   │ ──────────────────────────▶ │ /api/* route handlers         │
 │    (iOS Shortcut)            │                             │  - ingest, reels, categories  │
 └──────────────────────────────┘                             │  - search ($rankFusion)       │
 ┌──────────────────────────────┐   Clerk session             │  - ask (Gemini chat agent,    │
 │ Reel Brain PWA (home screen) │ ◀─────────────────────────▶ │    streaming, tools)          │
 │  Home · Category · Reel ·    │                             │  - voice transcribe           │
 │  Ask · Plans · Profile       │ ◀── Web Push ─────┐         │  - plans, reminders, push     │
 └──────────────────────────────┘                   │         └──────────────┬────────────────┘
                                                    │                        │
                                                    │                        ▼
                                                    │         ┌───────────────────────────────┐
                                                    │         │ MongoDB Atlas                 │
                                                    │         │ users · reels · thumbnails ·  │
                                                    │         │ jobs · categories · plans ·   │
                                                    │         │ reminders · pushSubscriptions │
                                                    │         │ · conversations               │
                                                    │         │ Vector Search · Atlas Search  │
                                                    │         └──────────────┬────────────────┘
                                                    │                        │ Change Stream on jobs
                                                    │                        ▼
                                                    │         ┌───────────────────────────────┐
                                                    │         │ Vultr VPS (Python, systemd)   │
                                                    └──────── │ worker:                       │
                                                              │  claim job → yt-dlp download  │
                                                              │  → thumbnail → Gemini Files   │
                                                              │  → extraction agent → embed   │
                                                              │  → write reel, update category│
                                                              │ scheduler (every 60 s):       │
                                                              │  due reminders → Web Push     │
                                                              └───────────────────────────────┘
```

**Key rules**

- Vercel route handlers never download video or run the extraction agent. They write to Atlas and return quickly. The only long-running Vercel route is `/api/ask` (streaming, `maxDuration = 60`).
- The worker is the only component that talks to Instagram/TikTok.
- Atlas is the only shared state. The worker and the web app never call each other directly.
- The same worker code runs on Vultr and on a laptop (`python -m worker`). Several workers can run at once safely because job claiming is atomic.

---

## 4. Repository layout

Monorepo. Keep the existing `prototype/` folder untouched as a reference for the Shortcut flow.

```
/
├─ SPEC.md                         ← this document
├─ prototype/                      ← existing tested Shortcut prototype (reference only)
├─ web/                            ← Next.js app (deployed to Vercel, root dir = web)
│  ├─ app/
│  │  ├─ (app)/                    ← signed-in pages, shared layout with bottom bar + orb
│  │  │  ├─ page.tsx               ← Home dashboard
│  │  │  ├─ c/[categoryId]/page.tsx← Category page
│  │  │  ├─ r/[reelId]/page.tsx    ← Reel page
│  │  │  ├─ ask/page.tsx           ← Ask (chat)
│  │  │  ├─ plans/page.tsx         ← Plans & Reminders
│  │  │  ├─ plans/[planId]/page.tsx← Plan page
│  │  │  └─ profile/page.tsx       ← Profile
│  │  ├─ onboarding/page.tsx
│  │  ├─ sign-in/[[...sign-in]]/page.tsx
│  │  ├─ sign-up/[[...sign-up]]/page.tsx
│  │  ├─ share-target/page.tsx     ← Android Web Share Target landing
│  │  ├─ api/…                     ← route handlers (section 17)
│  │  ├─ manifest.ts               ← PWA manifest
│  │  └─ layout.tsx
│  ├─ components/                  ← UI components (section 18)
│  ├─ lib/
│  │  ├─ db.ts                     ← cached MongoClient
│  │  ├─ auth.ts                   ← Clerk + API-token helpers
│  │  ├─ gemini.ts                 ← @google/genai client, model names
│  │  ├─ embeddings.ts             ← embed + normalize
│  │  ├─ search.ts                 ← hybrid search + category routing
│  │  ├─ agent/                    ← chat agent: prompt, tools, loop
│  │  ├─ plans.ts, reminders.ts, push.ts
│  │  ├─ urls.ts                   ← URL extraction + normalization (shared logic with worker)
│  │  └─ types.ts                  ← shared TypeScript types (mirrors section 5 and 9)
│  ├─ public/sw.js                 ← service worker (push + notificationclick)
│  └─ public/icons/…
├─ worker/                         ← Python worker (deployed to Vultr)
│  ├─ worker/
│  │  ├─ __main__.py               ← starts job loop + scheduler
│  │  ├─ config.py
│  │  ├─ db.py
│  │  ├─ jobs.py                   ← claim / complete / fail / retry, change stream
│  │  ├─ download.py               ← yt-dlp wrapper
│  │  ├─ thumbnails.py
│  │  ├─ gemini_client.py
│  │  ├─ video_analysis.py         ← analyze_video tool implementation
│  │  ├─ linked_page.py            ← fetch_linked_page tool implementation
│  │  ├─ agent.py                  ← extraction agent loop
│  │  ├─ cards.py                  ← pydantic card schemas + validation
│  │  ├─ categories.py             ← similarity, filing, centroid updates
│  │  ├─ embeddings.py
│  │  ├─ geocode.py                ← Nominatim for travel places
│  │  ├─ suggestions.py
│  │  ├─ scheduler.py              ← reminders → Web Push
│  │  └─ prompts.py
│  ├─ scripts/
│  │  ├─ create_indexes.py         ← creates all Mongo + Atlas Search/Vector indexes
│  │  ├─ seed.py                   ← enqueue a list of reel URLs for a user (demo data)
│  │  └─ gen_vapid.py              ← generate VAPID keys
│  ├─ deploy/brain-worker.service  ← systemd unit
│  ├─ requirements.txt
│  └─ .env.example
└─ shortcut/README.md               ← how to build and share the "Save to Brain" Shortcut
```

---

## 5. Data model (MongoDB Atlas)

Database name: `reelbrain`. Every user-owned document has `userId` (the Clerk user ID string, e.g. `user_2abc…`), and **every query filters on `userId`.** Timestamps are BSON dates in UTC.

### 5.1 `users`

```jsonc
{
  "_id": "user_2abc…",               // Clerk user ID used as _id
  "email": "…",
  "displayName": "Ali",
  "timezone": "America/New_York",    // from Intl.DateTimeFormat().resolvedOptions().timeZone
  "interests": ["Food", "Fragrance", "Basketball"],
  "onboardedAt": ISODate | null,
  "apiTokenHash": "sha256 hex",      // Shortcut token, hashed
  "apiTokenPreview": "rb_…k3F",      // first 3 + last 3 chars, for display
  "createdAt": ISODate
}
```
Indexes: `{ apiTokenHash: 1 }` unique sparse.

### 5.2 `reels`

```jsonc
{
  "_id": ObjectId,
  "userId": "user_…",
  "platform": "instagram" | "tiktok",
  "sourceUrl": "https://www.instagram.com/reel/ABC123/",   // normalized
  "sourceId": "ABC123",              // platform media ID (from URL, then confirmed by yt-dlp)
  "source": "shortcut" | "paste" | "share_target" | "seed",
  "userNote": "save for saturday dinner" | null,           // note typed when sharing
  "status": "queued" | "downloading" | "analyzing" | "ready" | "failed",
  "stage": "Watching the video…",    // human-readable progress text for the UI
  "failureReason": null | "unavailable" | "private" | "blocked" | "too_long" | "unsupported" | "processing_error",
  "failureMessage": null | "Instagram blocked the download. Try again in a few minutes.",

  // Raw metadata from yt-dlp
  "caption": "…",
  "hashtags": ["thaifood"],
  "creator": { "handle": "chefjohn", "name": "Chef John" },
  "durationSec": 48,
  "postedAt": ISODate | null,
  "hasThumbnail": true,

  // Extraction results
  "type": "recipe" | "product" | "travel" | "sports_drill" | "workout_plan" | "educational" | "motivational",
  "title": "Weeknight Pad Thai",
  "summary": "A 20-minute pad thai with tamarind sauce. Key trick: soak noodles in warm, not boiling, water.",
  "card": { /* type-specific, section 9 */ },
  "tags": ["noodles", "thai", "quick"],
  "entities": [{ "name": "tamarind", "kind": "ingredient" }],
  "language": "en",
  "transcript": [{ "startSec": 0.0, "text": "Okay so the secret…" }],   // [] if no speech
  "transcriptText": "Okay so the secret…",                             // flattened for search
  "onScreenText": ["2 tbsp tamarind", "…"],
  "visualSummary": "Close-up of a wok…",
  "captionAssessment": { "relevant": true, "sufficient": false },
  "extraction": {
    "tiersUsed": ["caption", "video"],    // subset of caption, video, linked_page
    "fieldSources": { "card.ingredients": "on_screen", "card.steps": "speech" },
    "agentSteps": 3,
    "linkedUrl": null | "https://…",
    "model": "gemini-…",
    "durationMs": 21450
  },

  // Organization
  "categoryId": ObjectId,             // top-level category
  "subcategoryId": ObjectId | null,
  "userEdited": ["title", "categoryId"],   // fields the user changed by hand; never overwritten

  // Search
  "embedding": [768 floats],

  // Usage
  "savedAt": ISODate,
  "processedAt": ISODate | null,
  "lastViewedAt": ISODate | null,
  "viewCount": 0
}
```

Indexes:
- `{ userId: 1, platform: 1, sourceId: 1 }` **unique** (dedupe)
- `{ userId: 1, savedAt: -1 }`
- `{ userId: 1, categoryId: 1, savedAt: -1 }`
- `{ userId: 1, subcategoryId: 1, savedAt: -1 }`
- `{ userId: 1, status: 1 }`
- `{ userId: 1, lastViewedAt: 1 }`

Atlas Vector Search index **`reels_vector`** on `reels`:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" },
    { "type": "filter", "path": "userId" },
    { "type": "filter", "path": "status" },
    { "type": "filter", "path": "type" },
    { "type": "filter", "path": "categoryId" },
    { "type": "filter", "path": "subcategoryId" }
  ]
}
```

Atlas Search index **`reels_text`** on `reels`:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "userId": { "type": "token" },
      "status": { "type": "token" },
      "title": { "type": "string" },
      "summary": { "type": "string" },
      "caption": { "type": "string" },
      "transcriptText": { "type": "string" },
      "onScreenText": { "type": "string" },
      "tags": { "type": "string" },
      "userNote": { "type": "string" },
      "entities": { "type": "document", "fields": { "name": { "type": "string" } } }
    }
  }
}
```

> The free M0 tier allows only 3 Atlas Search + Vector Search indexes in total. This design uses exactly **2**. Category similarity is computed in application code (a user has under ~100 categories), so categories need no search index.

### 5.3 `thumbnails`

Instagram/TikTok thumbnail URLs expire, so the worker stores a copy.

```jsonc
{ "_id": ObjectId /* = reelId */, "userId": "user_…", "contentType": "image/jpeg", "data": BinData, "width": 480, "height": 853 }
```
Resized to 480 px wide, JPEG quality 80 (~30–60 KB). Served by `GET /api/thumbnails/:reelId`.

### 5.4 `jobs` (the queue)

```jsonc
{
  "_id": ObjectId,
  "kind": "process_reel" | "refresh_suggestions",
  "userId": "user_…",
  "reelId": ObjectId | null,
  "categoryId": ObjectId | null,     // for refresh_suggestions
  "status": "pending" | "running" | "done" | "failed",
  "attempts": 0,
  "maxAttempts": 3,
  "runAfter": ISODate,               // for backoff
  "lockedBy": "vultr-1" | null,
  "lockedUntil": ISODate | null,     // lease; expired leases are reclaimable
  "lastError": null | "…",
  "createdAt": ISODate,
  "updatedAt": ISODate
}
```
Indexes: `{ status: 1, runAfter: 1 }`, `{ reelId: 1 }`, and a TTL index `{ updatedAt: 1 }` with `expireAfterSeconds: 604800` on finished jobs only (partial filter `status: { $in: ["done", "failed"] }`).

### 5.5 `categories`

```jsonc
{
  "_id": ObjectId,
  "userId": "user_…",
  "name": "Food",
  "parentId": null | ObjectId,       // null = top-level category; set = subcategory
  "description": "Recipes, restaurants, cooking techniques",  // AI-written, editable
  "emoji": "🍜",
  "color": "peach",                  // one of the pastel tokens (section 19)
  "origin": "seed" | "auto" | "user",
  "reelCount": 12,                   // ready reels directly in this (sub)category
  "centroid": [768 floats] | null,   // normalized mean of member reel embeddings
  "centroidCount": 12,
  "suggestions": [{ "label": "Grocery list for your 6 Thai recipes", "prompt": "Make a grocery list from my Thai recipes, grouped by aisle" }],
  "suggestionsReelCount": 10,        // reelCount when suggestions were generated
  "suggestionsUpdatedAt": ISODate | null,
  "sortOrder": 0,
  "createdAt": ISODate
}
```
Indexes: `{ userId: 1, parentId: 1, name: 1 }` unique (case-insensitive collation `{ locale: "en", strength: 2 }`), `{ userId: 1, sortOrder: 1 }`.

A built-in top-level category **"Unsorted"** (`origin: "seed"`, color `sand`) exists for every user. Reels from deleted categories move there.

### 5.6 `plans`

```jsonc
{
  "_id": ObjectId,
  "userId": "user_…",
  "title": "4-Day Ball-Handling Week",
  "kind": "training week",           // free text chosen by the agent
  "emoji": "🏀",
  "color": "sky",
  "sourceReelIds": [ObjectId],
  "startDate": "2026-11-17" | null,  // local calendar dates (YYYY-MM-DD) in the user's timezone
  "endDate": "2026-11-20" | null,
  "blocks": [ /* section 13 */ ],
  "createdBy": "agent" | "user",
  "conversationId": ObjectId | null,
  "createdAt": ISODate,
  "updatedAt": ISODate
}
```
Indexes: `{ userId: 1, updatedAt: -1 }`, `{ userId: 1, startDate: 1 }`.

### 5.7 `reminders`

```jsonc
{
  "_id": ObjectId,
  "userId": "user_…",
  "planId": ObjectId | null,
  "reelId": ObjectId | null,
  "title": "Ball-handling week starts tomorrow",
  "body": "Day 1: crossover series + 2-ball dribbling. Tap to open your plan.",
  "url": "/plans/665f…",             // opened when the notification is tapped
  "fireAt": ISODate,                 // UTC
  "status": "scheduled" | "sending" | "sent" | "failed" | "canceled",
  "origin": "auto_plan" | "agent" | "user",
  "sentAt": ISODate | null,
  "error": null | "…",
  "createdAt": ISODate
}
```
Indexes: `{ status: 1, fireAt: 1 }`, `{ userId: 1, fireAt: 1 }`, `{ planId: 1 }`.

### 5.8 `pushSubscriptions`

```jsonc
{ "_id": ObjectId, "userId": "user_…", "endpoint": "https://web.push.apple.com/…", "keys": { "p256dh": "…", "auth": "…" }, "userAgent": "…", "createdAt": ISODate }
```
Index: `{ endpoint: 1 }` unique, `{ userId: 1 }`.

### 5.9 `conversations`

```jsonc
{
  "_id": ObjectId,
  "userId": "user_…",
  "title": "Thai grocery list",      // set from the first user message
  "messages": [
    { "role": "user", "text": "…", "at": ISODate },
    { "role": "assistant", "text": "…", "reelIds": [ObjectId], "planIds": [ObjectId], "reminderIds": [ObjectId], "at": ISODate }
  ],
  "geminiHistory": [ /* raw Gemini Content[] incl. function calls/responses, for multi-turn continuity */ ],
  "updatedAt": ISODate
}
```
Index: `{ userId: 1, updatedAt: -1 }`. Cap `geminiHistory` to the last 40 entries.

---

## 6. Ingestion: getting reels in

### 6.1 Entry points

| Entry point | Who | Request | Auth |
|---|---|---|---|
| **iOS Shortcut "Save to Brain"** | iPhone | `POST /api/ingest` JSON `{ "url": "<Shortcut Input>", "note": "<optional>" }` | `Authorization: Bearer <api token>` |
| **Paste link** (Home "+" sheet) | any | `POST /api/reels` `{ "url", "note" }` | Clerk session |
| **Android Web Share Target** | Android | manifest `share_target` → `GET /share-target?url=&text=&title=` page → `POST /api/reels` | Clerk session |
| **Seed script** | team | `python -m scripts.seed --user <id> --file urls.txt` | direct DB |

All four call one shared function, `ingestReel({ userId, rawInput, note, source })`.

### 6.2 `ingestReel` logic

1. **Extract a URL** from `rawInput`: the share sheet may pass a URL or a block of text containing one. Use the first match of `https?://\S+`.
2. **Normalize and detect the platform:**
   - Instagram: hosts `instagram.com`, `www.instagram.com`. Paths `/reel/{id}`, `/reels/{id}`, `/p/{id}`, `/tv/{id}`. Canonical form `https://www.instagram.com/reel/{id}/`. Drop all query params (e.g. `igsh`).
   - TikTok: `www.tiktok.com/@{handle}/video/{id}` gives canonical `https://www.tiktok.com/@{handle}/video/{id}`. Short links `vm.tiktok.com/…` and `vt.tiktok.com/…` are kept as-is and get `sourceId = null`; the worker fills in the real ID from yt-dlp.
   - Anything else returns `400 { error: "unsupported_url" }`.
3. **Dedupe:** if a reel with the same `(userId, platform, sourceId)` exists (or the same `sourceUrl` when `sourceId` is null):
   - If it's `failed`, reset it to `queued` and enqueue a new job.
   - If a `note` was given, append it to `userNote` (newline-separated).
   - Return the existing reel with `duplicate: true`.
4. **Insert** the reel with `status: "queued"`, `stage: "In line…"`, `savedAt: now`.
5. **Insert** a `process_reel` job with `status: "pending"`, `runAfter: now`.
6. **Respond** `201 { reelId, status: "queued", duplicate: false }`. The Shortcut shows "Saved ✓".

The worker may later find that a short-link reel duplicates an existing one (same resolved `sourceId`). In that case it merges: it keeps the older reel, appends the note, deletes the newer reel and its job.

### 6.3 iOS Shortcut "Save to Brain"

This builds on the tested flow in `prototype/README.md`. Document the steps in `shortcut/README.md` and show them in the app's Profile → "Set up sharing" sheet.

1. Shortcuts → **+** → name it **Save to Brain**, icon: brain glyph.
2. **ⓘ** → turn on **Show in Share Sheet**. Receive **URLs** and **Text**. If there's no input: **Stop and respond**.
3. Action **Ask for Input** (Text). Prompt: "Add a note? (optional)". Default answer: empty.
4. Action **Get Contents of URL**:
   - URL: `https://<vercel-domain>/api/ingest`
   - Method: `POST`
   - Headers: `Authorization` = `Bearer ` + **Import Question** value "Paste your token from Reel Brain → Profile"
   - Request Body: JSON. `url` (Text) = **Shortcut Input** (the blue variable). `note` (Text) = **Provided Input**.
5. Action **Show Notification**: "Saved to Reel Brain ✓".
6. Shortcut details → **Setup** → add an **Import Question** on the Authorization header value, so anyone installing from the iCloud link is asked for their token.
7. Share → **Copy iCloud Link** and set it as `NEXT_PUBLIC_SHORTCUT_URL`.

The first time it runs, iOS asks "Allow Save to Brain to connect to …?". Tap **Always Allow**.

### 6.4 API tokens

- Format: `rb_` + 32 random bytes in base64url.
- Generated on first visit to Profile, or when the user taps **Regenerate token**. The plaintext is shown **once**, with a Copy button.
- Stored as `sha256(token)` in `users.apiTokenHash`. `/api/ingest` hashes the bearer value and looks it up.

---

## 7. Processing worker

Python 3.12. Single process with two concurrent parts: the **job loop** (a thread pool, `WORKER_CONCURRENCY`, default 3) and the **reminder scheduler** (section 14).

### 7.1 Job claiming

- **Wake-up:** open a Change Stream on `jobs` for inserts with `status: "pending"`. Also poll every 5 s as a safety net, in case the change stream drops or the job's `runAfter` is in the future.
- **Claim atomically:**
  ```python
  jobs.find_one_and_update(
      {"status": {"$in": ["pending", "running"]},
       "runAfter": {"$lte": now},
       "$or": [{"lockedUntil": None}, {"lockedUntil": {"$lt": now}}]},
      {"$set": {"status": "running", "lockedBy": WORKER_ID, "lockedUntil": now + 120s, "updatedAt": now},
       "$inc": {"attempts": 1}},
      sort=[("runAfter", 1)], return_document=AFTER)
  ```
- **Heartbeat:** extend `lockedUntil` by 120 s every 30 s while working.
- **Success:** `status: "done"`.
- **Transient failure** (network error, Gemini 429/5xx, Mongo timeout) with `attempts < maxAttempts`: `status: "pending"`, `runAfter = now + [10 s, 30 s, 90 s][attempts-1]`, clear the lock, record `lastError`.
- **Permanent failure** (or attempts used up): job `status: "failed"`, and the reel gets `status: "failed"` plus `failureReason` and `failureMessage`.

### 7.2 `process_reel` steps

At each step, update `reels.status` and `reels.stage` so the app can show progress.

| # | Reel status / stage | What happens |
|---|---|---|
| 1 | `downloading` / "Grabbing the reel…" | **yt-dlp** (Python API) downloads to a temp dir. Options: `format: "best[ext=mp4]/best"`, `outtmpl: "{tmp}/%(id)s.%(ext)s"`, `max_filesize: 150MB`, `noplaylist: True`, `quiet: True`, `socket_timeout: 20`. For Instagram, also `cookiefile: INSTAGRAM_COOKIES_PATH`. Read `info`: `id`, `description`, `title`, `uploader`, `uploader_id`, `channel`, `duration`, `timestamp`, `thumbnail`, `tags`. Fill in `sourceId`, `caption` (`description`, falling back to `title`), `hashtags` (parsed from the caption plus `tags`), `creator`, `durationSec`, `postedAt`. Then dedupe for short links (section 6.2). |
| 1a | | **Error mapping:** "Private video", "login required" → `private`. "Video unavailable", 404 → `unavailable`. "rate-limit", "Please wait a few minutes", HTTP 429 → `blocked` (**transient**, retried). `durationSec > 600` → `too_long`. |
| 2 | `analyzing` / "Reading the caption…" | Download the thumbnail (`info.thumbnail`), resize with Pillow, upsert into `thumbnails`. If it's missing, take the video's first frame with `ffmpeg -ss 0.5 -frames:v 1` (ffmpeg is installed on the VPS). |
| 3 | `analyzing` / (set by tools) | Run the **extraction agent** (section 8). Tools update `stage` themselves: "Watching the video…", "Checking the linked page…". |
| 4 | `analyzing` / "Filing it away…" | Validate the card (pydantic). Resolve or create the category and subcategory (section 10). Geocode `travel` places (section 7.4). |
| 5 | | **Embed** (section 11.1). |
| 6 | `ready` | Write all results to the reel. Set `processedAt`. Respect `userEdited` (never overwrite those fields on reprocessing). Update category counts and centroids. If a category's `reelCount - suggestionsReelCount >= 3`, or it has no suggestions yet, enqueue `refresh_suggestions`. |
| 7 | | **Cleanup:** delete the temp dir and the uploaded Gemini file (`client.files.delete`). This runs in a `finally` block. |

### 7.3 yt-dlp operational notes

- Install `yt-dlp[default,curl-cffi]` so TikTok's browser impersonation works. Without it, yt-dlp warns about impersonation and TikTok downloads can fail.
- Pin a recent version, but run `pip install -U "yt-dlp[default,curl-cffi]"` at the start of the event, because Instagram changes often break the extractor.
- Instagram cookies come from a **throwaway** Instagram account, exported in Netscape format (e.g. with the "Get cookies.txt LOCALLY" browser extension). The file is copied to the VPS at `INSTAGRAM_COOKIES_PATH` with mode `600` and never committed.
- TikTok needs no cookies.

### 7.4 Geocoding (travel only)

For each `travel.places[]` item without coordinates:
- Query Nominatim `https://nominatim.openstreetmap.org/search?q={name}, {city}, {country}&format=json&limit=1` with header `User-Agent: ReelBrain-Hackathon/1.0`.
- Rate limit: 1 request per second, globally across the worker.
- Store `lat`/`lng` if found. Otherwise leave them null; the map block skips places without coordinates.

---

## 8. Extraction agent

Runs in the worker. It uses the Gemini **Pro** model (`GEMINI_PRO_MODEL`) with function calling via the `google-genai` Python SDK, in a **manual tool loop** (automatic function calling disabled) so every step can be logged and limited.

### 8.1 Inputs in the first message

- **Caption**, hashtags, creator handle, platform, duration.
- **The user's note**, marked as a focus instruction: "The user said: '…'. Prioritize what they asked for."
- **Thumbnail** as an inline image part.
- **The user's category tree**, compact: `Food (id …) > [Thai, Baking]; Fragrance (id …) > [Summer]; …`, with each category's description.
- **The card schemas** (the section 9 field lists in compact form).

### 8.2 Tools

| Tool | Parameters | What it does / returns |
|---|---|---|
| `analyze_video` | `focus: string` (what to pay attention to, e.g. "exact ingredient amounts", "the drill sequence at 0:30") | Uploads the downloaded MP4 to the Gemini Files API, if it isn't uploaded yet for this job. Polls `files.get` until `state == ACTIVE` (max 90 s). Calls the **Flash** model (`GEMINI_FLASH_MODEL`) with the video plus a structured-output schema (8.4). Returns `{ hasSpeech, musicOnly, language, transcript[{startSec,text}], onScreenText[], visualSummary, keyMoments[{startSec,description}] }`. Called at most **once** per reel (a second call returns the cached result). |
| `fetch_linked_page` | `url: string` | Only allowed for URLs that appear in the caption, or that `analyze_video` reported in on-screen text. Uses httpx with a 10 s timeout and the same User-Agent. If the page has `application/ld+json` `Recipe` or `Product` schema, returns it as JSON. Otherwise returns the readable text (BeautifulSoup, scripts and styles stripped), truncated to 15,000 characters. |
| `find_similar_categories` | `text: string` | Embeds `text` (RETRIEVAL_QUERY) and returns the top 5 categories/subcategories by cosine similarity to their `centroid`: `[{id, path: "Food > Thai", similarity, reelCount}]`. Categories without a centroid are skipped. |
| `finalize_card` | the full result (8.3) | Validates against the pydantic schemas. If invalid, returns `{ ok: false, errors: [...] }` so the agent can fix it. If valid, returns `{ ok: true }` and the loop ends. |

### 8.3 `finalize_card` parameters

```jsonc
{
  "type": "recipe | product | travel | sports_drill | workout_plan | educational | motivational",
  "title": "≤ 60 chars, specific and human (\"Weeknight Pad Thai\", not \"Recipe video\")",
  "summary": "2 sentences max: what it is + the single most useful takeaway",
  "card": { "recipe": {…} | "product": {…} | … },   // exactly one key, matching type
  "tags": ["3–8 lowercase tags"],
  "entities": [{ "name": "…", "kind": "ingredient|product|brand|place|person|exercise|skill|topic" }],
  "language": "en",
  "captionAssessment": { "relevant": true, "sufficient": false },
  "fieldSources": { "card.ingredients": "caption|speech|on_screen|visual|linked_page" },
  "category": {
    "existingCategoryId": "…" | null,
    "newCategory": { "name": "…", "emoji": "…", "description": "…" } | null,
    "existingSubcategoryId": "…" | null,
    "newSubcategory": { "name": "…", "description": "…" } | null
  }
}
```
Exactly one of `existingCategoryId` / `newCategory` must be set. At most one of `existingSubcategoryId` / `newSubcategory` may be set.

For Gemini's function-declaration schema, declare `card` as an object whose properties are the seven type keys, all optional. Pydantic enforces "exactly one, matching `type`".

### 8.4 `analyze_video` output schema (pydantic, passed as `response_schema`)

```python
class TranscriptSegment(BaseModel): startSec: float; text: str
class KeyMoment(BaseModel): startSec: float; description: str
class VideoAnalysis(BaseModel):
    hasSpeech: bool
    musicOnly: bool
    language: str
    transcript: list[TranscriptSegment]   # verbatim speech, in the original language
    onScreenText: list[str]               # every distinct overlay/caption text, in order
    visualSummary: str                    # what is shown, step by step, ≤ 120 words
    keyMoments: list[KeyMoment]           # ≤ 8
```

Prompt for this call: *"Transcribe all speech verbatim with timestamps. List every on-screen text overlay exactly as written, including quantities and units. Describe what is physically shown, step by step. Pay special attention to: {focus}. If there is no speech, return an empty transcript and set hasSpeech=false. If audio is only music, set musicOnly=true."*

### 8.5 System prompt (extraction agent)

```
You turn a short-form video (Instagram Reel or TikTok) into one structured, genuinely useful card
for the person who saved it. Be accurate: never invent quantities, names, prices or steps.

How to work (tiers, cheapest first):
1. Read the caption, hashtags and thumbnail. Decide two things and record them in captionAssessment:
   - relevant: is the caption actually about this video? Captions are often unrelated
     ("follow for more", song lyrics, jokes, hashtag spam).
   - sufficient: does the caption alone contain everything needed for a complete card of the
     right type (e.g. a recipe caption that lists ingredients AND steps)?
2. If the caption is relevant AND sufficient, you may finalize without analyzing the video.
   Otherwise call analyze_video with a focus describing exactly what's missing.
3. If the caption or the on-screen text points to a link with the full content
   ("full recipe at the link", a URL), and important fields are still missing, call fetch_linked_page.
4. Call find_similar_categories with a short description of the reel before choosing a category.
5. Call finalize_card exactly once with the complete result.

Source priority when sources disagree: speech and on-screen text in the video > linked page >
caption. Ignore the caption entirely if it is not relevant. Record where each important field
came from in fieldSources.

Choosing the type: pick the single best of recipe, product, travel, sports_drill, workout_plan,
educational, motivational. A basketball skills video is sports_drill; a gym routine is workout_plan;
a fragrance review is product; a restaurant or destination is travel; a lesson, explainer, tip or
how-to (including gaming strategy) is educational; quotes, speeches and mindset content is motivational.

Choosing the category: strongly prefer an existing category or subcategory when it fits
(similarity from find_similar_categories helps). Create a new top-level category only when the
reel clearly belongs to a new interest; create a new subcategory when a category has a clear,
recurring theme the reel fits (e.g. Food > Thai). Names are short, Title Case, 1–2 words.

If the user left a note, it tells you what they care about. Make sure the card captures it.

Write all card text in English. If the video is in another language, translate, and set language
to the original language code.
```

### 8.6 Loop limits and fallback

- **Max 6 model turns.** On turn 5, if `finalize_card` hasn't been called yet, set `tool_config.function_calling_config = { mode: "ANY", allowed_function_names: ["finalize_card"] }` to force it.
- If `finalize_card` fails validation 2 times in a row, or the loop ends without a valid card: **deterministic fallback.**
  1. Call `analyze_video` (if it hasn't run).
  2. Make one Gemini Pro call with `response_mime_type: "application/json"` and the pydantic `FinalizeCard` schema, using the caption, the video analysis, and the category tree.
  3. If that fails too, the reel becomes `failed` / `processing_error`.
- Log every turn (tool name, arguments truncated, latency) to stdout. Store `agentSteps`, `tiersUsed` and `durationMs` on the reel. These numbers are also the demo's "agentic" evidence.

---

## 9. Card types

Every card field is optional unless marked required (`*`). Arrays default to `[]`. Free-text fields stay short and scannable.

### 9.1 `recipe`
```jsonc
{ "servings": 2, "totalTimeMin": 20, "difficulty": "easy|medium|hard",
  "cuisine": "Thai",
  "ingredients*": [{ "qty": 2, "unit": "tbsp", "item": "tamarind paste", "note": "or lime juice", "aisle": "International" }],
  "steps*": ["Soak noodles in warm water 10 min.", "…"],
  "tips": ["Don't overcrowd the wok."],
  "equipment": ["wok"] }
```
`aisle` is one of: Produce, Meat & Seafood, Dairy & Eggs, Bakery, Pantry, International, Spices, Frozen, Beverages, Other.

**UI:** a servings stepper that scales `qty`, a metric/imperial toggle (only for convertible units), an ingredient checklist, numbered steps, tips. Actions: **Make a grocery list** (Ask prefilled), **Cook mode** (full-screen steps, screen kept awake with the Wake Lock API where supported).

### 9.2 `product`
```jsonc
{ "productCategory*": "fragrance",           // fragrance, skincare, tech, clothing, …
  "items*": [{ "name*": "Bleu de Chanel EDP", "brand": "Chanel", "priceHint": "$$$ (~$150)",
               "notes": { "top": ["citrus"], "middle": ["ginger"], "base": ["sandalwood"] },   // fragrance only
               "keySpecs": ["long-lasting", "office-safe"],
               "verdict": "Best all-rounder for fall",
               "whereToBuy": "Sephora", "url": null }],
  "comparison": "…" }
```
**UI:** item cards. Fragrances show a notes pyramid (top/middle/base chips). Action: **Compare with my other saves** (Ask prefilled).

### 9.3 `travel`
```jsonc
{ "destination": "Lisbon, Portugal",
  "places*": [{ "name*": "Time Out Market", "kind": "food|sight|stay|activity|nightlife|shop",
                "city": "Lisbon", "country": "Portugal", "why": "Best spot to try 10 vendors at once",
                "tip": "Go before 12pm", "priceHint": "$$", "lat": 38.707, "lng": -9.146 }],
  "bestTime": "Spring or early fall" }
```
**UI:** a map (react-leaflet with OpenStreetMap tiles) with pins, plus a place list. Action: **Plan a trip with this** (Ask prefilled).

### 9.4 `sports_drill`
```jsonc
{ "sport*": "basketball", "skill*": "ball handling", "level": "beginner|intermediate|advanced",
  "equipment": ["1 ball", "cones"],
  "drills*": [{ "name*": "Pound crossover", "reps": "3×30s", "durationSec": 30,
                "cues": ["Stay low", "Eyes up"], "startSec": 12 }],
  "focusPoints": ["Keep the ball below the knee"] }
```
**UI:** drill list with reps and cue chips. `startSec` shows as a "jump to 0:12" pill that opens the original link. Action: **Add to a training week** (Ask prefilled).

### 9.5 `workout_plan`
```jsonc
{ "goal*": "hypertrophy", "split": "push", "durationMin": 45, "level": "intermediate",
  "equipment": ["dumbbells"],
  "exercises*": [{ "name*": "Incline DB press", "sets": 4, "reps": "8–10", "durationSec": null, "restSec": 90, "notes": "2s eccentric" }] }
```
**UI:** exercise table (name, sets × reps, rest). Action: **Build a weekly plan** (Ask prefilled).

### 9.6 `educational`
```jsonc
{ "topic*": "Pokémon VGC: Tailwind teams", "format": "tip|explainer|how_to|strategy|story",
  "keyPoints*": ["Lead with Tornadus to set Tailwind turn 1", "…"],
  "steps": ["…"],                              // for how-tos
  "takeaway*": "Speed control wins most games",
  "resources": [{ "label": "…", "url": "…" }] }
```
**UI:** key-points list, optional steps, a highlighted takeaway.

### 9.7 `motivational`
```jsonc
{ "coreMessage*": "Discipline is choosing what you want most over what you want now.",
  "quotes": [{ "text": "…", "speaker": "Kobe Bryant" }],
  "speaker": "Kobe Bryant", "theme": "discipline",
  "actionPrompt": "Write down one thing you'll do today even if you don't feel like it." }
```
**UI:** a large serif quote card on a pastel gradient, with the speaker and action prompt.

### 9.8 Shared Reel page parts (all types)

- Hero thumbnail with platform badge.
- Title, and a category pill ("Food › Thai · Change").
- Summary.
- The **type card** above.
- **Your note**, editable.
- **What's in the video**, a collapsible section with the transcript (timestamps open the original link) and on-screen text.
- "Open in Instagram/TikTok" button.
- "How Brain read this": small print listing `tiersUsed` and `fieldSources` as chips, e.g. "from the caption", "from the video's speech", "from on-screen text".
- Overflow menu: edit title, move category, reprocess, delete.

---

## 10. Categories and subcategories

### 10.1 Seeding (onboarding)

"What do you save?" offers multi-select chips:

| Chip | Emoji | Color |
|---|---|---|
| Food | 🍜 | peach |
| Fragrance | 🌸 | rose |
| Travel | ✈️ | sky |
| Basketball | 🏀 | butter |
| Fitness | 💪 | mint |
| Learning | 📚 | lavender |
| Motivation | ✨ | sage |
| Style | 👟 | sand |
| Gaming | 🎮 | lavender |
| Home | 🏡 | sage |

There's also a "+ Add your own" text chip. Each selected chip becomes a top-level category (`origin: "seed"`) with an AI-free default description. "Unsorted" is always created.

### 10.2 Filing a reel

The agent chooses existing or new (section 8). Then the worker applies these safeguards:

1. **Near-duplicate guard:** if the agent proposes a **new** category/subcategory but an existing sibling has centroid similarity ≥ `NEW_CATEGORY_DUP_THRESHOLD` (default 0.86) to the reel embedding, **or** a case-insensitive name match, use the existing one instead.
2. **Cap:** at most 12 top-level categories and 8 subcategories per category. Beyond that, the agent's new-category proposal falls back to the closest existing one.
3. New categories get the next unused pastel color, the agent's emoji, and `origin: "auto"`.

### 10.3 Centroids

After a reel becomes ready (or moves category), update the centroid of its category **and** subcategory:

```
new = normalize((centroid * count + embedding) / (count + 1)); count += 1
```

When a reel leaves a category (move or delete), recompute that category's centroid from its member reels. This is cheap at this scale.

### 10.4 User edits (Profile → Categories)

- Rename, change emoji or color, reorder (drag), delete. Deleting moves reels to "Unsorted", and a deleted subcategory's reels go to its parent.
- **Merge A into B:** move all reels and subcategories from A to B, recompute B's centroid, delete A.
- **Promote a subcategory** to top-level, or **demote** a top-level category under another.
- Moving a reel adds `categoryId` / `subcategoryId` to its `userEdited` list.

---

## 11. Search

### 11.1 Embeddings

- Model: `GEMINI_EMBED_MODEL` (default `gemini-embedding-001`), `output_dimensionality: 768`.
- Task types: `RETRIEVAL_DOCUMENT` for reels, `RETRIEVAL_QUERY` for searches and `find_similar_categories`.
- **L2-normalize** every vector after it's returned (reduced-dimension Gemini embeddings are not normalized).
- Reel embedding text (keep under ~7,000 characters, because the model's input limit is ~2,048 tokens):
  ```
  {title}
  Type: {type}. Category: {category} > {subcategory}.
  {summary}
  {card rendered as compact plain text: ingredients, items, places, drills, key points, quote…}
  Note: {userNote}
  Tags: {tags}
  On screen: {onScreenText joined, ≤ 1,000 chars}
  Said: {transcriptText, truncated to fill the remaining budget}
  ```
- The web app and the worker share the same embedding helper behavior (TypeScript `@google/genai` in `web/lib/embeddings.ts`, Python `google-genai` in `worker/embeddings.py`).

### 11.2 Category routing (the "hierarchy" in retrieval)

Given a query embedding `q` and all of the user's categories with centroids:

1. Compute the cosine similarity of `q` against every category and subcategory centroid, in application code.
2. Let `top` and `second` be the two best scores.
3. If `top.score ≥ ROUTE_MIN_SIM` (default 0.55) **and** `top.score − second.score ≥ ROUTE_MARGIN` (default 0.06), use `top` as a **filter** (`categoryId`, or `subcategoryId` if the match is a subcategory).
4. Run the hybrid search (11.3). **If the filtered search returns fewer than 3 results, run it again unfiltered** and append the new results after the filtered ones.
5. An explicit filter from the UI (on a Category page) or from the agent always wins over routing.

The default thresholds are starting points. Tune them on the seeded demo data (section 25).

### 11.3 Hybrid query

```js
db.reels.aggregate([
  { $rankFusion: {
      input: { pipelines: {
        vector: [
          { $vectorSearch: {
              index: "reels_vector", path: "embedding", queryVector: q,
              numCandidates: 200, limit: 40,
              filter: { userId: uid, status: "ready", /* + categoryId | subcategoryId | type */ } } }
        ],
        text: [
          { $search: {
              index: "reels_text",
              compound: {
                must: [{ text: { query: queryText,
                                 path: ["title","summary","caption","transcriptText","onScreenText","tags","userNote","entities.name"],
                                 fuzzy: { maxEdits: 1 } } }],
                filter: [{ equals: { path: "userId", value: uid } },
                         { equals: { path: "status", value: "ready" } }] } } },
          { $limit: 40 }
        ]
      } },
      combination: { weights: { vector: 0.65, text: 0.35 } }
  } },
  { $limit: 20 },
  { $project: { embedding: 0, transcript: 0 } }
])
```

The text pipeline can't filter on `categoryId` (it isn't in the text index). When a category filter applies, add a `$match` on `categoryId`/`subcategoryId` after `$rankFusion`.

**Fallback:** if `$rankFusion` is unavailable on the cluster (check on night one), run both pipelines separately and merge them in code with reciprocal rank fusion: `score = Σ w / (60 + rank)`, using the same weights.

**Result item:** `{ reelId, title, type, categoryPath, summary, thumbnailUrl, snippet }`. `snippet` is the best matching sentence from the summary/transcript (pick the sentence with the most query-term overlap).

---

## 12. Ask: the chat agent

### 12.1 Runtime

- `POST /api/ask` (Vercel route handler, Node runtime, `export const maxDuration = 60`).
- Body: `{ conversationId?: string, message: string, context?: { reelId?: string, categoryId?: string } }`.
- Model: `GEMINI_PRO_MODEL` via `@google/genai`, with `functionDeclarations` for the tools below. Manual loop, **max 8 tool calls per user turn**.
- **Response:** a stream of newline-delimited JSON events:
  ```
  {"type":"status","text":"Searching your saves…"}
  {"type":"reels","reels":[{reelId,title,type,thumbnailUrl,categoryPath}]}
  {"type":"text","delta":"Here's your grocery list…"}
  {"type":"plan","plan":{planId,title,kind,emoji,color}}
  {"type":"reminder","reminder":{reminderId,title,fireAt}}
  {"type":"done","conversationId":"…"}
  {"type":"error","message":"…"}
  ```
- The conversation (user text, assistant text, created object IDs, and the raw Gemini history) is saved to `conversations` after each turn.

### 12.2 Tools

Every tool is scoped to the authenticated `userId` on the server. The model never supplies `userId`.

| Tool | Parameters | Returns |
|---|---|---|
| `search_saves` | `query: string`, `category?: string` (name or path, e.g. "Food > Thai"), `type?: CardType`, `limit?: number` (default 8, max 20) | `[{ reelId, title, type, categoryPath, summary, savedAt }]` via section 11 |
| `get_reel` | `reelId: string` | Full reel: title, summary, card, userNote, tags, onScreenText, transcriptText (truncated to 4,000 chars), sourceUrl |
| `list_categories` | none | Tree with names, ids, reel counts |
| `get_category_reels` | `category: string`, `limit?: number` (default 20) | `[{ reelId, title, type, summary }]`, most recent first |
| `create_plan` | `title`, `kind`, `emoji`, `sourceReelIds[]`, `blocks[]` (section 13), `startDate?`, `endDate?` | `{ planId }`. Also creates auto reminders (section 14.2) |
| `update_plan` | `planId`, plus any of the `create_plan` fields, plus `appendBlocks?` | `{ planId }` |
| `create_reminder` | `title`, `body`, `fireAt` (ISO local datetime, interpreted in the user's timezone), `planId?`, `reelId?` | `{ reminderId, fireAtUtc }` |
| `list_plans` | `limit?` | `[{ planId, title, kind, startDate, endDate }]` |

### 12.3 System prompt (chat agent)

```
You are Brain, the user's friendly second brain for everything they've saved from Instagram and
TikTok. You are warm, concise and practical, like a friend who remembers everything they sent you.

Today is {date} ({weekday}); the user's timezone is {timezone}. Their categories: {category tree}.
{If context.reelId: The user is currently looking at reel {id}: {title}. Questions likely refer to it.}
{If context.categoryId: The user is currently in the {category path} category.}

Rules:
- Ground every answer in the user's saves. Use search_saves / get_category_reels / get_reel before
  answering questions about their content. Never invent details that aren't in their saves; if
  something isn't there, say so and offer to help anyway with general knowledge, clearly labeled.
- When you mention a saved reel, cite it inline as [[reel:<reelId>]] so the app can show it as a card.
- When the user wants something they can act on (a plan, routine, list, itinerary, comparison,
  schedule, summary), build it with create_plan using the block types available, then reply with a
  one- or two-sentence summary. Do not repeat the whole plan in text.
- If the plan has dates, include startDate/endDate. Ask for dates only if they truly matter and
  weren't given; otherwise make a sensible assumption and say what you assumed.
- When the user asks to be reminded, use create_reminder. Confirm the time in their timezone.
- Keep text replies short: lead with the answer, use short lists, no filler.
```

### 12.4 Rendering

- Assistant text is rendered as Markdown (react-markdown).
- `[[reel:ID]]` tokens become inline **ReelChips** (thumbnail, title, tap opens the Reel page).
- `plan` events render as a **PlanCard** (emoji, title, kind, "Open plan").
- `reminder` events render as a small **ReminderPill** ("🔔 Sun 6:00 PM").
- `status` events show as a subtle animated line above the typing indicator.

### 12.5 Entry points with context

- Reel page action buttons open `/ask?reel=<id>&q=<prefill>`, which sends `context.reelId`.
- Category page suggestion chips open `/ask?category=<id>&q=<prompt>` and send immediately.
- The orb opens `/ask` (tap) or records voice (hold), section 15.

---

## 13. Plans

### 13.1 Block schema

Every plan is an ordered list of blocks. Each block and each list item has a stable `id` (nanoid), which lets checklist toggles and edits target them.

```ts
type Block =
  | { id; type: "heading"; text: string }
  | { id; type: "text"; markdown: string }
  | { id; type: "checklist"; title?: string;
      groups: { name?: string; items: { id; text: string; checked: boolean; reelId?: string }[] }[] }
  | { id; type: "steps"; title?: string; steps: { id; text: string; reelId?: string }[] }
  | { id; type: "table"; title?: string; columns: string[]; rows: string[][]; reelIds?: (string|null)[] }
  | { id; type: "schedule"; title?: string;
      days: { id; label: string; date?: "YYYY-MM-DD";
              items: { id; time?: "HH:mm"; text: string; detail?: string; reelId?: string; done: boolean }[] }[] }
  | { id; type: "map"; title?: string;
      places: { id; name: string; lat?: number; lng?: number; note?: string; reelId?: string }[] }
  | { id; type: "reels"; title?: string; reelIds: string[] }
  | { id; type: "callout"; tone: "tip" | "warning" | "info"; text: string };
```

The agent produces blocks without ids. The server assigns ids, validates with zod, and drops invalid blocks while logging them. For `map` blocks, places missing coordinates are geocoded on the server (Nominatim, same rules as 7.4) before saving.

### 13.2 Typical compositions (guidance in the agent's tool description)

| Request | Blocks |
|---|---|
| Grocery list from recipes | `checklist` grouped by aisle (items merged and summed when units match), `reels` |
| Trip itinerary | `schedule` (one day per date, items with times), `map`, `callout` tips |
| Training week | `schedule` (days with drills/exercises, `detail` = sets × reps), `table` summary |
| Compare products | `table` (columns: name, notes, price, verdict), `text` recommendation |
| Study summary | `heading`, `steps` or `checklist`, `callout` takeaway |

### 13.3 Plan page

- Header: emoji, title, kind, date range, and source reel thumbnails.
- Blocks render in order. Checklist items and schedule items are tappable to check/uncheck (`PATCH`, optimistic update).
- Actions: **Ask about this plan** (opens Ask with plan context in the prefill), **Edit dates**, **Delete**.

---

## 14. Reminders and Web Push

### 14.1 Permission and subscription

- Push only works when the app is opened from the home screen (iOS 16.4+). Profile → Notifications shows:
  - "Add to Home Screen first" if `navigator.standalone !== true`.
  - Otherwise an **Enable notifications** button. It must be a user gesture: `Notification.requestPermission()` → `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })` → `POST /api/push/subscribe`.
- Onboarding also offers this step, which can be skipped.

### 14.2 Auto reminders for plans (plan-linked)

When a plan is created or its dates change, delete its `scheduled` reminders with `origin: "auto_plan"` and create new ones:

- **Day before start,** 18:00 local: "{emoji} {title} starts tomorrow". Body: the first schedule day's first 2 items.
- **Each dated schedule day,** 08:00 local (max 7): "Today: {day label}". Body: that day's first 3 items.
- Skip any reminder whose `fireAt` is already in the past.

The agent can also create one-off reminders (`origin: "agent"`).

### 14.3 Scheduler (worker)

Every 60 s:
1. Claim due reminders one at a time: `find_one_and_update({ status: "scheduled", fireAt: { $lte: now } }, { $set: { status: "sending" } })`.
2. Send a payload to every subscription of that user with `pywebpush`: `{ "title", "body", "url", "tag": "reminder-<id>" }`. VAPID claims: `{ "sub": VAPID_SUBJECT }`.
3. A 404 or 410 response deletes that subscription. If at least one send succeeds, mark the reminder `sent`; otherwise mark it `failed` with the error.

### 14.4 Service worker (`public/sw.js`)

- `push` event → `self.registration.showNotification(title, { body, tag, data: { url }, icon: "/icons/icon-192.png", badge: "/icons/badge-72.png" })`.
- `notificationclick` event → focus an existing client and navigate it to `data.url`, or open a new window.
- No offline caching beyond what Next.js does by default.

---

## 15. Voice input

- The **orb** (center of the bottom bar) uses pointer events:
  - `pointerdown` starts a 250 ms timer.
  - **Released before 250 ms (tap):** navigate to `/ask`.
  - **Held 250 ms or longer:** start recording via `MediaRecorder` (request the mic on first use). The orb grows and pulses, and a live level ring follows the audio volume (AnalyserNode).
  - **Release:** stop recording, show "Transcribing…", `POST /api/voice/transcribe` (multipart, field `audio`). Then navigate to `/ask?q=<text>&send=1`.
  - **Slide off the orb and release:** cancel.
  - Max recording 60 s.
- The orb CSS needs `touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;` so iOS doesn't show the long-press menu.
- **Recorder format:** use `MediaRecorder.isTypeSupported` to pick the first of `audio/mp4`, `audio/webm;codecs=opus`, `audio/webm` (iOS Safari produces `audio/mp4`).
- **`/api/voice/transcribe`:** send the audio inline (base64) to `GEMINI_FLASH_MODEL` with the prompt: *"Transcribe this voice message exactly. Return only the transcript text."* Pass the recorder's MIME type. If Gemini rejects `audio/mp4`, retry with `audio/aac`.
- **Fallback (night-one check):** if server transcription fails on iPhone, use the browser's `webkitSpeechRecognition` when available. Otherwise show the text field with an error toast.

---

## 16. Suggestions and Rediscover

### 16.1 Category suggestions (Plan it chips)

- **`refresh_suggestions` job (worker):** send `GEMINI_FLASH_MODEL` the category path and its ready reels' `title` + `type` + one-line summary (max 40). Ask for **3 suggestions**, each `{ label ≤ 45 chars, prompt }`, that turn several saves into something actionable: plans, lists, comparisons, routines, summaries. Each must reference real counts/themes from the list (e.g. "Grocery list for your 6 Thai recipes"). Use structured output. Store them on the category with `suggestionsReelCount = reelCount`.
- **Home** shows up to 3 chips: one from each of the 3 categories with the most recent `savedAt`.
- Tapping a chip opens `/ask?category=<id>&q=<prompt>&send=1`.

### 16.2 Rediscover (in-app only)

`GET /api/rediscover` returns up to 5 ready reels where `savedAt < now − 14 days` **and** (`lastViewedAt` is null **or** `lastViewedAt < now − 30 days`). They're randomly ordered with a seed of `userId + today's date`, so the list stays stable for the day. It's shown on the Plans & Reminders page as "From your archive", with a "Why you saved it" line (the summary).

`POST /api/reels/:id/viewed` sets `lastViewedAt` and increments `viewCount` whenever a Reel page is opened.

---

## 17. API reference

All routes are under `web/app/api`. Unless noted, they require a Clerk session (`auth()` → `userId`) and return JSON. Errors use the shape `{ error: "<code>", message: "<human text>" }` with the appropriate HTTP status.

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/ingest` | **Bearer API token** | Shortcut ingest `{ url, note? }` → `201 { reelId, status, duplicate }`. `401 invalid_token`, `400 unsupported_url`. |
| `POST /api/reels` | session | Paste/share-target ingest `{ url, note? }` (same response) |
| `GET /api/reels` | session | `?categoryId&subcategoryId&type&status&cursor&limit=24` → `{ items, nextCursor }` (cursor = last `savedAt` + `_id`) |
| `GET /api/reels/recent` | session | The 10 most recent reels in any status, for the "Recently saved" row |
| `GET /api/reels/:id` | session | Full reel (without embedding) |
| `PATCH /api/reels/:id` | session | `{ title?, userNote?, categoryId?, subcategoryId?, card? }`, adds edited fields to `userEdited`, updates centroids/counts on move |
| `DELETE /api/reels/:id` | session | Delete the reel and its thumbnail, update counts and centroid |
| `POST /api/reels/:id/retry` | session | For `failed` reels: reset to `queued`, enqueue a job |
| `POST /api/reels/:id/reprocess` | session | Re-run extraction (keeps `userEdited` fields) |
| `POST /api/reels/:id/viewed` | session | Update `lastViewedAt`, `viewCount` |
| `GET /api/thumbnails/:reelId` | session | Image bytes, `Cache-Control: private, max-age=86400` |
| `GET /api/categories` | session | Tree: `[{ id, name, emoji, color, reelCount, totalCount, subcategories: [...] }]` (`totalCount` includes subcategories) |
| `POST /api/categories` | session | `{ name, parentId?, emoji?, color? }` |
| `PATCH /api/categories/:id` | session | `{ name?, emoji?, color?, description?, parentId?, sortOrder? }` |
| `POST /api/categories/:id/merge` | session | `{ intoId }` |
| `DELETE /api/categories/:id` | session | Moves reels to the parent or "Unsorted" |
| `GET /api/categories/:id/suggestions` | session | Cached suggestions |
| `GET /api/suggestions` | session | Home suggestions (16.1) |
| `GET /api/search` | session | `?q&categoryId?&type?` → `{ items, routedTo?: { id, path } }` |
| `POST /api/ask` | session | Streaming chat agent (section 12) |
| `GET /api/conversations` | session | Recent conversations `[{ id, title, updatedAt }]` |
| `GET /api/conversations/:id` | session | Messages for display |
| `POST /api/voice/transcribe` | session | multipart `audio` → `{ text }` |
| `GET /api/plans` | session | `[{ id, title, kind, emoji, color, startDate, endDate, updatedAt }]` |
| `GET /api/plans/:id` | session | Full plan |
| `PATCH /api/plans/:id` | session | `{ title?, startDate?, endDate?, blocks? }` (regenerates auto reminders when dates change) |
| `PATCH /api/plans/:id/items/:itemId` | session | `{ checked }` or `{ done }`, toggles a checklist/schedule item |
| `DELETE /api/plans/:id` | session | Also cancels its reminders |
| `GET /api/reminders` | session | `?status=scheduled` → upcoming reminders, sorted by `fireAt` |
| `PATCH /api/reminders/:id` | session | `{ status: "canceled" }` or `{ fireAt }` (snooze) |
| `POST /api/push/subscribe` | session | Save a subscription (upsert by endpoint) |
| `DELETE /api/push/subscribe` | session | `{ endpoint }` |
| `GET /api/me` | session | Creates the user document on first call (lazy, from the Clerk profile). Returns the profile, `hasToken`, `apiTokenPreview`, `onboarded` |
| `PATCH /api/me` | session | `{ displayName?, timezone?, interests? }` |
| `POST /api/me/onboard` | session | `{ interests[] }`: seeds categories, sets `onboardedAt` |
| `POST /api/me/token` | session | Create or regenerate the API token → `{ token }` (shown once) |
| `GET /api/rediscover` | session | Section 16.2 |

**Clerk middleware** protects everything except `/sign-in`, `/sign-up`, `/api/ingest`, `/manifest.webmanifest`, `/sw.js`, and `/icons/*`. Signed-in users without `onboardedAt` are redirected to `/onboarding`.

---

## 18. Frontend: screens and components

**Stack:** Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui (Radix primitives), **vaul** for bottom sheets, **framer-motion** for motion, **lucide-react** icons, **react-leaflet** + OpenStreetMap tiles for maps, **react-markdown**, **SWR** for data fetching, **zod** for validation, **nanoid**.

### 18.1 App shell (signed-in layout)

- **Top area:** page title in the display serif. On Home, a greeting plus an avatar button (→ Profile).
- **Bottom bar,** fixed and floating, with a white frosted background (`backdrop-blur`), rounded 28 px, padded by `env(safe-area-inset-bottom)`:
  - Left: **Home** (house icon + label).
  - Center: **the Orb**, 72 px, raised 16 px above the bar. Soft pastel conic gradient (peach → lavender → sky → mint), slowly rotating (20 s loop), with a gentle breathing scale (1 → 1.03, 4 s). Accessible label: "Ask Brain (hold to speak)". Tap and hold behavior is in section 15.
  - Right: **Plans** (calendar-check icon + label). A small dot appears when a reminder fires within 24 h.
- Bottom bar hidden on: Ask (it has its own composer), onboarding, sign-in.

### 18.2 Home (dashboard of your tastes)

Top to bottom:
1. **Greeting:** "Good evening, Ali", plus a subline: "{n} saves · {m} categories".
2. **Search bar** (rounded, pastel-tinted). As you type (debounced 250 ms), an overlay sheet shows results from `/api/search` as ReelRows, plus a final row **"Ask Brain: '{query}' →"** that sends the query to Ask.
3. **Recently saved:** a horizontal scroll of **ReelTiles** (thumbnail 3:4, title, type badge). Processing reels show a shimmer skeleton with the live `stage` text, refreshed every 3 s while any reel is not `ready`/`failed`. When one becomes ready it cross-fades in, with a soft confetti puff on the first ready of the session. Failed tiles show a muted card with "Couldn't grab this reel · Retry".
4. **Suggested for you:** up to 3 suggestion chips (pastel pills with a sparkle icon).
5. **Your tastes:** a 2-column grid of **CategoryTiles**. Each tile has a pastel background in its color, the emoji large, the name in the display serif, "{totalCount} saves", and up to 3 overlapping mini thumbnails. The last tile is **"+ New category"**.
6. A **"+"** floating action (small, top-right of "Recently saved") opens the **Add sheet**: "Share from Instagram/TikTok" (how-to with Shortcut steps, if not set up) and **Paste link** (text field with a paste button using `navigator.clipboard.readText()` on tap, plus an optional note).

**Empty state (no reels):** an illustration-style composition from pastel shapes and the orb, "Your saved reels will live here", and two buttons: **Set up sharing** and **Paste a link**.

### 18.3 Category page (`/c/[categoryId]`)

- **Header:** a full-width pastel band in the category color with the emoji, name, description (one line, muted) and count. Overflow menu: rename, change color/emoji, merge, delete.
- **Subcategory chips** (horizontal): "All", then each subcategory with its count. Selecting one filters the grid. Long-press a chip to rename it.
- **Plan it row:** that category's 3 suggestion chips.
- **Reel grid:** 2 columns of ReelCards (thumbnail, title, 1-line summary, type icon). Infinite scroll.
- **Empty:** "Nothing here yet. Share a reel and Brain will file it."

### 18.4 Reel page (`/r/[reelId]`)

Layout per section 9.8.
- **Hero:** a 16:9 crop of the thumbnail with a soft gradient at the bottom, platform badge, and duration.
- **Sticky action row** under the hero: **Open original**, **Ask about this**, plus a type-specific primary action (Make grocery list, Plan a trip, Add to training week, Build weekly plan, Compare, Save quote).
- **Category pill** opens a bottom sheet to move the reel (categories, then subcategories, with "+ New subcategory").
- **Processing state:** if not ready, show the live stage with step dots (Grabbing → Reading → Watching → Filing).
- **Failed state:** reason, message, **Retry**.

### 18.5 Ask (`/ask`)

- Full-screen chat. **Header:** back, "Brain" with a small orb avatar, and a "New chat" button.
- **Empty state:** the large orb in the middle, "Ask anything about your saves", and 4 starter chips built from the user's top categories (e.g. "What did I save about fragrances?", "Make a training week from my drills").
- **Messages:** user bubbles in ink-on-pastel; assistant messages on white, without bubble chrome, with the small orb avatar. ReelChips, PlanCards and ReminderPills render inline (12.4).
- **Composer** (bottom, safe-area aware): a text field, a **mic button** (same hold-to-speak behavior as the orb), and Send.
- **Query params:** `q` prefills the composer; `send=1` sends automatically; `reel`/`category` set the context, shown as a removable chip above the composer ("About: Weeknight Pad Thai ✕").
- A conversation list is available from the header ("History" sheet).

### 18.6 Plans & Reminders (`/plans`)

Three sections:
1. **Coming up:** the next 5 scheduled reminders (time, title, plan emoji). Swipe to cancel.
2. **Your plans:** PlanCards in a single column (emoji, title, kind, date range, source thumbnails), sorted by `updatedAt`.
3. **From your archive:** Rediscover reels (16.2) as a horizontal row.

Empty state: "Ask Brain to turn your saves into a plan", with a button that opens Ask with a suggestion.

### 18.7 Plan page (`/plans/[planId]`)

Per section 13.3. Block components: `HeadingBlock`, `TextBlock`, `ChecklistBlock`, `StepsBlock`, `TableBlock` (horizontal scroll on narrow screens), `ScheduleBlock` (day cards with time chips), `MapBlock`, `ReelsBlock`, `CalloutBlock`.

### 18.8 Profile (`/profile`)

Sections, as grouped rounded lists:
1. **You:** name, timezone (auto-detected, editable).
2. **Your tastes:** category manager. Drag to reorder; tap a category to edit name, emoji, color (pastel swatches), and description, and to manage its subcategories (rename, promote, merge, delete). "Merge into…" and "Delete" open confirmation sheets.
3. **Interests:** the onboarding chips, editable. Adding a chip creates a category.
4. **Sharing:** shows the token state ("Token ending …k3F"), **Copy token / Regenerate**, an **Install "Save to Brain"** button (opens `NEXT_PUBLIC_SHORTCUT_URL`), and a step-by-step guide with small illustrations.
5. **Notifications:** status and the Enable button (14.1).
6. **Account:** Clerk `<UserButton>` / sign out.

### 18.9 Onboarding (`/onboarding`)

Four short steps with a progress dot row:
1. **Welcome:** the orb, "Don't save it. Send it.", and one line about what Brain does.
2. **What do you save?** Interest chips (10.1).
3. **Connect sharing:** generate the token (shown with Copy), the **Install Shortcut** button, and "I'll do it later".
4. **Try it:** "Share any reel to Save to Brain now." The page polls `/api/reels/recent`. When a reel appears, show its live processing tile and then the finished card. Also offers **Paste a link instead** and **Skip**. Optional: enable notifications.

### 18.10 Shared components

`Orb`, `BottomBar`, `CategoryTile`, `ReelTile`, `ReelCard`, `ReelRow`, `ReelChip`, `TypeBadge`, `CategoryPill`, `SuggestionChip`, `PlanCard`, `ReminderPill`, `ProcessingShimmer`, `StageDots`, `BottomSheet` (vaul), `EmptyState`, `Toast` (sonner), the per-type card components (`RecipeCard`, `ProductCard`, `TravelCard`, `SportsDrillCard`, `WorkoutPlanCard`, `EducationalCard`, `MotivationalCard`), and the plan block components.

---

## 19. Design system

**Feel:** bright, friendly, calm. White space, soft pastels, elegant serif headings, and tactile motion. Built for a phone held in one hand.

### 19.1 Color tokens (CSS variables, Tailwind theme)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FFFFFF` | page |
| `--surface` | `#FAF9F7` | grouped lists, inputs |
| `--line` | `#EFEDE9` | hairlines |
| `--ink` | `#1E1F24` | primary text, primary buttons |
| `--ink-2` | `#5C5F6A` | secondary text |
| `--ink-3` | `#9A9CA5` | placeholder, meta |
| `--focus` | `#7C6CF2` | focus rings |

Pastel pairs for categories, badges and the orb (background / ink-on-pastel):

| Name | Pastel | Deep |
|---|---|---|
| peach | `#FFE3D3` | `#B4532A` |
| butter | `#FFF3C4` | `#8A6A00` |
| mint | `#D6F2E2` | `#1F7A4D` |
| sky | `#D8EBFF` | `#1F5FA8` |
| lavender | `#E7E0FF` | `#5B48C2` |
| rose | `#FFDDE7` | `#B23A63` |
| sage | `#E3ECD6` | `#4D6B2E` |
| sand | `#F2E8DA` | `#7A5B34` |

Card type colors: recipe = peach, product = rose, travel = sky, sports_drill = butter, workout_plan = mint, educational = lavender, motivational = sage.

Primary button: `--ink` background, white text, fully rounded. Secondary: white with a `--line` border. Destructive: rose-deep text.

**Light theme only.** The design is intentionally white. Set `color-scheme: light`, and set `theme-color` to `#FFFFFF`.

### 19.2 Typography

- Display: **Fraunces** (Google Fonts, opsz axis, weights 500–600) for page titles, category names, card titles, and quotes.
- UI/body: **Plus Jakarta Sans** (400, 500, 600).
- Scale (px): 34 / 28 / 22 / 18 / 16 (body) / 14 / 12. Line-height 1.25 for headings, 1.5 for body.
- Load with `next/font/google`.

### 19.3 Shape, depth, spacing

- Radii: 12 (chips, inputs), 20 (cards, tiles), 28 (sheets, bottom bar), full (buttons, pills, orb).
- Shadows: very soft. Cards `0 1px 2px rgba(30,31,36,.04), 0 8px 24px rgba(30,31,36,.06)`; orb `0 10px 30px rgba(124,108,242,.35)`.
- Spacing on a 4-pt grid. Page side padding 20 px. Section gaps 28 px.
- Minimum tap target 44 × 44 px.

### 19.4 Motion

- framer-motion springs (`stiffness 400, damping 32`) for sheets, tiles and press states. Pressed elements scale to 0.97.
- Page transitions: a subtle 8 px slide plus fade.
- Processing shimmer: a pastel gradient sweep, 1.6 s.
- The orb animates as described in 18.1. While recording, its scale is driven by the audio level.
- Respect `prefers-reduced-motion` (disable rotation, confetti and shimmer movement).

### 19.5 Accessibility

- All text contrast meets WCAG AA. Pastels are backgrounds only; text on pastel uses the matching deep color or `--ink`.
- Every icon button has an `aria-label`. Focus rings are visible. The orb has a keyboard alternative (Enter opens Ask).

---

## 20. PWA and iPhone specifics

- **`app/manifest.ts`:** `name: "Reel Brain"`, `short_name: "Brain"`, `display: "standalone"`, `start_url: "/"`, `background_color: "#FFFFFF"`, `theme_color: "#FFFFFF"`, icons 192/512 plus a maskable icon, and `share_target`:
  ```json
  { "action": "/share-target", "method": "GET",
    "params": { "title": "title", "text": "text", "url": "url" } }
  ```
- **Head:** `apple-touch-icon` (180 px), `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=default`, and viewport `width=device-width, initial-scale=1, viewport-fit=cover`.
- **Layout:** use `env(safe-area-inset-*)` paddings. Use `100dvh` heights (not `100vh`). Inputs use 16 px font size to prevent iOS zoom on focus. `overscroll-behavior: none` on the shell.
- **Service worker:** register `/sw.js` on app load (needed for push).
- **Install prompt:** if on iOS Safari and not standalone, show a dismissible banner: "Add Reel Brain to your Home Screen: tap Share → Add to Home Screen".
- **Clerk inside a home-screen app:** sign-in must complete inside the standalone app (Clerk's embedded `<SignIn>` component, no OAuth redirect to an external browser). Use email + password or an email code, not Google OAuth, to avoid iOS standalone redirect issues.

---

## 21. Error handling

| Situation | Behavior |
|---|---|
| Unsupported URL (not Instagram/TikTok) | `400 unsupported_url`. The Shortcut notification shows the response body's `message`: "Only Instagram and TikTok links work right now." |
| Invalid/missing token | `401 invalid_token`, message "Open Reel Brain → Profile to copy your token." |
| Duplicate share | `200` with `duplicate: true`. The note is appended. |
| Private/unavailable reel | Reel `failed` (`private`/`unavailable`), message shown on the tile and Reel page, Retry available. |
| Instagram rate-limit/login wall | Transient: retried 3× with backoff. Then `failed` (`blocked`), message "Instagram blocked the download. Try again in a few minutes." The worker logs a loud warning (switch to the laptop worker or refresh cookies). |
| Video longer than 10 min | `failed` (`too_long`). |
| Gemini errors (429/5xx) | Transient retry (job backoff). In `/api/ask`: one retry after 2 s, then an `error` event with "Brain is overloaded, try again in a moment." |
| Agent produced no valid card | Deterministic fallback (8.6), then `failed` (`processing_error`). |
| Worker crash mid-job | The lease expires after 120 s and another worker (or the restarted one) reclaims the job. |
| Change stream disconnect | Resume with the stored resume token. The 5 s polling covers any gap. |
| Push subscription expired | Deleted on 404/410. Profile shows notifications as off. |
| Category routing filtered too much | The unfiltered re-run covers it (11.2 step 4). |
| `$rankFusion` unsupported | Manual RRF fallback (11.3). |

UI conventions: toasts for transient errors; inline error states with Retry for failed loads; never a blank screen.

---

## 22. Security and privacy

- Every database query includes `userId` from the server session or token, **never** from the request body.
- API tokens: random, stored hashed, regenerable. `/api/ingest` is rate-limited per token to 30 requests/minute (in-memory map is fine for this build).
- `fetch_linked_page` only fetches `http(s)` URLs found in the reel's own caption or on-screen text. It blocks private IP ranges and `localhost`, caps responses at 2 MB, and has a 10 s timeout.
- Instagram cookies live only on the worker host (`chmod 600`) and are listed in `.gitignore`. Secrets go in environment variables, never in the repo.
- Videos are deleted from disk and from Gemini Files right after processing. Only derived text, embeddings, and a small thumbnail are kept, and every card links back to the original creator's post.

---

## 23. Configuration and environment variables

### 23.1 `web/.env.local` (and Vercel project env)

```
MONGODB_URI=mongodb+srv://…
MONGODB_DB=reelbrain
GEMINI_API_KEY=…
GEMINI_PRO_MODEL=           # newest Pro model listed by the Gemini API (e.g. gemini-2.5-pro or newer)
GEMINI_FLASH_MODEL=         # newest Flash model (e.g. gemini-2.5-flash or newer)
GEMINI_EMBED_MODEL=gemini-embedding-001
EMBED_DIM=768
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=…
CLERK_SECRET_KEY=…
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_VAPID_PUBLIC_KEY=…
NEXT_PUBLIC_SHORTCUT_URL=https://www.icloud.com/shortcuts/…
NEXT_PUBLIC_APP_NAME=Reel Brain
NEXT_PUBLIC_ASSISTANT_NAME=Brain
ROUTE_MIN_SIM=0.55
ROUTE_MARGIN=0.06
```

> Gemini model names change often. On night one, list the available models (`client.models.list()`) and set `GEMINI_PRO_MODEL` / `GEMINI_FLASH_MODEL` to the newest Pro and Flash models that support function calling, structured output, and video input. Code must read models only from these variables.

### 23.2 `worker/.env`

```
MONGODB_URI=mongodb+srv://…
MONGODB_DB=reelbrain
GEMINI_API_KEY=…
GEMINI_PRO_MODEL=…
GEMINI_FLASH_MODEL=…
GEMINI_EMBED_MODEL=gemini-embedding-001
EMBED_DIM=768
WORKER_ID=vultr-1            # "laptop-ali" when running locally
WORKER_CONCURRENCY=3
INSTAGRAM_COOKIES_PATH=/opt/reelbrain/secrets/instagram_cookies.txt
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=mailto:<team contact email>
NEW_CATEGORY_DUP_THRESHOLD=0.86
HTTP_USER_AGENT=ReelBrain-Hackathon/1.0
```

### 23.3 Python dependencies (`worker/requirements.txt`)

`yt-dlp[default,curl-cffi]`, `google-genai`, `pymongo[srv]`, `pydantic>=2`, `pywebpush`, `Pillow`, `httpx`, `beautifulsoup4`, `python-dotenv`, `numpy`. System packages: `ffmpeg`.

### 23.4 Web dependencies

`next`, `react`, `@clerk/nextjs`, `@google/genai`, `mongodb`, `zod`, `swr`, `nanoid`, `tailwindcss`, shadcn/ui components, `vaul`, `framer-motion`, `lucide-react`, `react-leaflet`, `leaflet`, `react-markdown`, `sonner`.

---

## 24. Deployment

### 24.1 MongoDB Atlas

1. Create a cluster (M0 is fine), a database user, and a network access rule. Allow `0.0.0.0/0` for the hackathon, since Vercel IPs are dynamic.
2. Run `python -m scripts.create_indexes`. It creates every regular index from section 5 and the two search indexes (`reels_vector`, `reels_text`) through `collection.create_search_index(...)` (the Vector Search index uses `type="vectorSearch"`). It waits until both report `queryable: true`.

### 24.2 Vercel (web)

1. Import the repo with Root Directory `web`. Add all variables from 23.1.
2. Deploy. Copy the production domain into the Shortcut URL.
3. The Clerk dashboard: add the Vercel domain and enable email + password / email code.

### 24.3 Vultr (worker and scheduler)

1. Create a Cloud Compute instance: Ubuntu 24.04 LTS, 1 vCPU / 2 GB RAM is enough. Add an SSH key.
2. `apt update && apt install -y python3.12-venv ffmpeg git`
3. `git clone` the repo to `/opt/reelbrain`, then `python3.12 -m venv /opt/reelbrain/venv` and `pip install -r worker/requirements.txt`.
4. Create `/opt/reelbrain/worker/.env` (23.2) and `scp` the Instagram cookies file to `INSTAGRAM_COOKIES_PATH` (`chmod 600`).
5. Install `worker/deploy/brain-worker.service`:
   ```ini
   [Unit]
   Description=Reel Brain worker
   After=network-online.target
   [Service]
   WorkingDirectory=/opt/reelbrain/worker
   EnvironmentFile=/opt/reelbrain/worker/.env
   ExecStart=/opt/reelbrain/venv/bin/python -m worker
   Restart=always
   RestartSec=5
   [Install]
   WantedBy=multi-user.target
   ```
   Then `systemctl enable --now brain-worker` and follow logs with `journalctl -u brain-worker -f`.
6. In the Atlas network access list, add the VPS's IP (or rely on `0.0.0.0/0`).

### 24.4 Laptop fallback

From `worker/`: create a venv, `pip install -r requirements.txt`, copy `.env` with `WORKER_ID=laptop-<name>`, then `python -m worker`. Both workers can run at the same time. If Instagram blocks the VPS, stop the VPS worker (`systemctl stop brain-worker`) so it doesn't keep claiming Instagram jobs and failing them.

Optional improvement: a `WORKER_PLATFORMS=instagram,tiktok` env filter, so the VPS can handle only TikTok while a laptop handles Instagram.

### 24.5 Demo data

`python -m scripts.seed --user <clerkUserId> --file demo_urls.txt` enqueues 40–80 real public reels across the team's interests (recipes, fragrances, Lisbon/travel, basketball drills, gym splits, Pokémon/educational, motivational speeches). Run it on night one so the demo account is full.

---

## 25. Night-one verification checklist

Do these before building features on top of them. Each one has a fallback already designed in.

1. **Instagram download from the Vultr IP** with throwaway cookies, tested on 5 real reels. If blocked, use the laptop worker (24.4).
2. **TikTok download** with `curl-cffi` impersonation, on 3 real videos.
3. **Shortcut to production:** Instagram → Share → Save to Brain → `/api/ingest` → reel appears on Home.
4. **Gemini video analysis:** upload a 60 s reel, poll until ACTIVE, and get a structured `VideoAnalysis` back. Note the latency.
5. **Gemini function calling** in Python with a manual loop, and forcing `finalize_card` with `mode: ANY`.
6. **Embeddings:** `gemini-embedding-001` at 768 dims, normalized. Similar reels score higher than unrelated ones.
7. **Atlas:** both search indexes queryable. Check whether `$rankFusion` runs on the cluster; if not, switch on the RRF fallback.
8. **Change stream** on `jobs` works on the cluster tier (polling covers it either way).
9. **Web Push on iPhone:** install to the home screen, enable notifications, and receive a test push sent from the worker.
10. **Voice:** iPhone `MediaRecorder` audio → `/api/voice/transcribe` → correct text.
11. **Clerk sign-in** completes inside the home-screen app.
12. **Routing thresholds:** on the seeded data, run 15 test queries and adjust `ROUTE_MIN_SIM` / `ROUTE_MARGIN` so obvious queries route and ambiguous ones don't.

---

## 26. Acceptance criteria

The build is done when all of these hold on an iPhone using the home-screen app:

1. Sharing an Instagram reel through the Share sheet → Save to Brain shows "Saved ✓" in under 3 s. The reel then appears on Home with live stage text and becomes a complete, correct card within ~60 s.
2. The same works for a TikTok link and for a pasted link.
3. A reel with an irrelevant caption ("follow for part 2 #fyp") still produces a correct card from the video. Its "How Brain read this" chips show the video as the source.
4. A reel whose caption contains the full recipe finishes without analyzing the video (`tiersUsed: ["caption"]`) and is noticeably faster.
5. A silent reel with only on-screen text produces a correct card from that text.
6. New reels are filed into existing categories when they fit. A new interest creates a new category, and a recurring theme creates a subcategory. Moving a reel by hand is never undone by reprocessing.
7. Searching "pad thai" finds the pad thai reel first. Searching "that crossover drill" finds the basketball reel even though those exact words aren't in it.
8. In Ask, "Bring up the pad thai recipe I saved" answers with the recipe and a ReelChip.
9. "Make me a 4-day ball-handling week starting Monday from my saves" creates a plan with a schedule block linked to the source drills. Auto reminders are created, and the day-before reminder arrives as a push notification. (For the demo, test with a plan starting tomorrow, or set a reminder 2 minutes out via Ask.)
10. "Grocery list for my Thai recipes" creates a checklist grouped by aisle with merged quantities. Items can be checked off.
11. Holding the orb, speaking a question, and releasing sends the transcribed question to Ask.
12. Categories and subcategories can be renamed, recolored, merged, and deleted in Profile, and reels follow correctly.
13. A private or unavailable reel shows as failed with a clear reason and a working Retry.
14. Every screen looks right at 375–430 px wide, respects safe areas, has no horizontal scroll, and matches the design system.

---

## 27. Demo script and pitch

### 27.1 One-liner

> **Instagram's Save is where good ideas go to die. Send them to Brain instead: you get the useful part back instantly, you can ask for it anytime, and it comes back when you need it.**

Add a stat from a quick survey of hackathon attendees: how many reels they've saved, and when they last opened their saved folder.

### 27.2 Two-minute demo

1. **Problem (15 s):** scroll a real, messy Instagram saved folder. "Where was that pad thai recipe?"
2. **Send it (25 s):** live on stage, Instagram reel → Share → Save to Brain → "Saved ✓". Switch to Reel Brain: the tile shows "Watching the video…".
3. **While it processes (25 s):** show Home: tastes as pastel tiles. Open Basketball → Ball Handling. Search "that crossover drill" and it's found.
4. **The card lands (20 s):** the live reel becomes a full recipe card in Food › Thai. Point out "How Brain read this": the caption was irrelevant, so Brain watched the video and read the on-screen text. (This is the agentic and Gemini story.)
5. **Plan it (25 s):** hold the orb and say "Make me a 4-day ball-handling week starting tomorrow." A plan appears with a schedule linked to the saved drills, and a reminder is set. Show the push notification arriving on the phone.
6. **Close (10 s):** architecture in one slide. Gemini (video understanding, two agents, embeddings) + MongoDB Atlas (vector + keyword hybrid search with `$rankFusion`, Change Streams, the job queue) + Vultr (the AI worker and scheduler) + Vercel.

### 27.3 Prize talking points

- **Gemini:** native video understanding, tiered agentic extraction, embedding-based category routing, and a chat agent with tools.
- **MongoDB Atlas:** one cluster as document store, vector store, search engine, job queue (Change Streams + atomic leases), and thumbnail store. Hybrid search with `$rankFusion` and pre-filtered vector search.
- **Agentic:** two agents. One decides how much of the video it needs to watch; the other turns saves into plans and reminders.
- **Impact:** converts passive consumption into action: cooking, training, and traveling from what you already saved.
- **UI/UX:** pastel tastes dashboard, hold-to-speak orb, live processing, per-type cards.
- **Vultr:** always-on worker for video processing and the reminder scheduler.

---

## 28. Out of scope

- Public launch, App Store, TestFlight, native iOS code.
- YouTube Shorts and other platforms.
- Bulk import of past saves from Instagram's data export.
- Instagram DM bot, Telegram, iMessage.
- Knowledge graph view.
- Proactive "rediscover" push notifications (the in-app section only).
- Sharing plans with friends, collaboration, payments.
- Dark mode, desktop layout, offline mode.
