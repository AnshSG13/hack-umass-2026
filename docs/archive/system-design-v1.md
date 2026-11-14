# Saved Reels Second Brain — System Design

Nov 13, 2026 · @Anshul Sadh-Gauri

## Overview

Users share Instagram reels to our bot account; we turn each one into searchable, categorized knowledge and link it into a personal knowledge graph.

**Problem.** People save hundreds of reels (recipes, places, workouts, business ideas) and never find them again. Instagram's saved folder has no search.

**Pitch.** "Your saved folder is a graveyard of good ideas. We turn it into a second brain."

**Product template: ReciMe.** We model the app's UX on ReciMe (4.8★, the leading recipe importer), which already proves the loop "share a video → get a clean, structured, actionable card." ReciMe does this for recipes only; we generalize it to every kind of reel. What we borrow:

| ReciMe pattern | Our version |
| --- | --- |
| Share a TikTok/IG video to the app → structured recipe | Share a reel to our bot (or paste a link) → structured card for any type |
| Import fallbacks: caption → audio → linked website | Caption → transcript → on-screen text/visuals |
| Importing modal → save form with cookbook picker → "Open recipe / Done" | Processing card → "Saved to Travel" with a one-tap collection change |
| Cookbooks (grid with cover photos, "New cookbook" tile) | Collections: auto-created categories plus user-made ones |
| Recipe detail: hero, action buttons, ingredients, steps, notes | Reel detail: hero, actions, type-specific card, transcript, notes |
| Ingredients → grocery list sorted by aisle, duplicates merged | Actionables → Lists: groceries, places to visit, things to buy |
| Meal planner (assign recipes to days) | Plan: drop saves into days (meal plan, trip itinerary, workout week); stretch |
| "Ask ReciMe" assistant on a recipe (swaps, questions) | "Ask" on one reel, plus chat across all saves |
| Cook mode (step-by-step, screen stays on) | Step-by-step mode for recipes and workouts; stretch |

**Hackathon scope (must have)**

- Share a reel to the bot (or paste its link in the app) → it appears in the app, processed, within about a minute
- Structured, type-specific cards: recipe → ingredients + steps, place → name + city + map pin, product → name + link, workout → exercises, idea → key points
- Semantic search across transcript, on-screen text, caption and visuals
- Collections (auto-categories, editable) and a knowledge graph view
- Lists: one-tap "Add to groceries / places / wishlist" from any card
- "Chat with your saves" (e.g. plan a trip from saved travel reels)

**Stretch**

- Bulk import of old saves from Instagram's data export
- Plan view (week/trip planner), step-by-step mode, nutrition estimate on recipe cards
- Android PWA share target (Web Share Target API) so "Share → our app" works like ReciMe's share sheet

**Out of scope.** Logging into user accounts, scraping, TikTok/YouTube, payments.

## User flows

The user's only ongoing action is tapping Share → our bot instead of Save; everything else happens in our app.

**1. Onboarding (once)**

Onboarding follows ReciMe's short, value-first sequence: say what you save, see how to share, get one real import before the empty home screen.

1. Welcome screen: one-line pitch, "Get started" / "Log in".
2. "What do you save?" picker (Food, Travel, Fitness, Business, …), multi-select chips. The picks seed the user's first collections.
3. Sign up (email or Google).
4. "Connect Instagram": app shows a link code (e.g. `LINK-4821`) and an "Open bot in Instagram" button. User sends the code; the webhook links their Instagram-scoped ID (IGSID) to their account. The screen flips live to "Connected ✓".
5. "Show me how": a 3-frame illustration (tap Share on a reel → pick our bot → done) and "Try it now". User shares one reel; the screen shows the processing card, then the finished card. This is the "aha" moment, like ReciMe's onboarding import of a sample recipe.
6. Bot replies in the DM: "Connected. Share any reel here and it's saved to your brain."

**2. Save a reel (every time)**

1. User taps Share on a reel → selects our bot. *(Alternative: paste a reel link into the app's "+" sheet.)*
2. Webhook receives an `ig_reel` attachment with URL, caption and video ID.
3. Bot replies instantly: "Got it, processing." In the app, a card with a progress state appears at the top of "Recently saved".
4. About 30–60 seconds later the card fills in, and the bot replies "Saved to Travel → Lisbon. Open: <deep link>".
5. Tapping the card in the app shows a small "Saved to Travel · Change" bar, the equivalent of ReciMe's cookbook picker on its save form. Moving a reel is one tap and is remembered as a user edit.

**2b. Act on a save**

- "Add to groceries" on a recipe card → ingredients are added to the Groceries list, merged with existing items and grouped by aisle.
- "Add to places" on a place card → place is added to the Places list for that city, shown on a map.
- "Add to wishlist" on a product card → product with link.
- "Ask" on any card → chat scoped to that reel ("make this vegetarian", "how long is this hike?").

**3. Bulk import (stretch)**

1. User requests Instagram's "Download your information" export (JSON).
2. Uploads the zip in our app.
3. We parse saved posts, queue each URL, and process in the background with a progress bar.

**4. Use the brain**

- **Search:** type "cheap dinner ideas" → ranked reels with the matching moment highlighted.
- **Browse:** collection grid → collection → reels (filter by type or concept, sort by newest / most related).
- **Graph:** zoom from categories to concepts to reels.
- **Chat:** "Plan 3 days in Lisbon from my saves" → answer citing the reels it used.

## Architecture

Four moving parts we run — API server, queue, worker, web app — around one Atlas cluster, with Meta and AI providers as external services.

&#91;embedded content: system architecture · 8 components\]

The webhook only records and enqueues; all slow work happens in the worker, and the app reads everything from Atlas through the API. The worker also DMs the user "Saved under …" via the bot when a reel is ready.

## Ingestion

Reels arrive only through Meta's official Instagram Messaging webhook; the export import is a separate batch path.

**Bot account setup (Friday night, do first)**

1. Create an Instagram account for the bot; switch it to a Professional (Creator or Business) account.
2. Create a Meta developer app and add the Instagram API with Instagram Login product (no Facebook Page needed).
3. Request messaging permissions (`instagram_business_basic`, `instagram_business_manage_messages`).
4. Subscribe to the `messages` webhook field; point it at `POST /webhooks/instagram`.
5. Add every teammate's personal Instagram as an app tester. In development mode only testers trigger webhooks; a public launch needs App Review.
6. Test immediately: share a reel to the bot and log the raw payload. Some developers report reel shares arriving as `is_unsupported`.

**Webhook handler** (must answer within a few seconds, so it does no processing)

1. Verify the `X-Hub-Signature-256` header with the app secret.
2. For each message: if text matches a link code → link the account; if an attachment is `ig_reel` → continue.
3. Upsert a `reels` document (`status: queued`) keyed on `(userId, reelVideoId)` so duplicate shares are ignored.
4. Push a job `{reelId}` onto the queue and send the "Got it" reply via the Send API.
5. Return 200.

**Export import (stretch)**

- Parse saved-post entries (URL + timestamp) from the uploaded JSON.
- Create `reels` documents with `source: export`, then queue them with a low priority and a rate limit.
- Videos behind export links are not covered by the webhook; start with caption + thumbnail, fetch video only if time allows.

**Unlinked senders.** A share from an IGSID with no linked account gets a reply with a signup link and is stored for 7 days in case they sign up.

## Processing pipeline

A worker takes each queued reel through seven steps and keeps only text, embeddings and a thumbnail; the video file is deleted at the end.

1. **Download.** Fetch the MP4 from the webhook's CDN URL right away (signed links expire). Save to a temp dir. Status → `downloading`.
2. **Split media.** ffmpeg extracts mono 16 kHz audio and one keyframe every 3 seconds (max 8), plus a thumbnail.
3. **Transcribe.** Whisper (API or `faster-whisper` locally) → timestamped segments. Skip if there is no speech.
4. **See.** Send the keyframes to a vision LLM in one call: describe each scene and read all on-screen text.
5. **Extract.** One LLM call with caption + transcript + frame notes, returning JSON:
   - `title` (short, human-readable), `summary` (2 sentences)
   - `type`: one of `recipe`, `place`, `product`, `workout`, `idea`, `other`. This selects the card template in the UI.
   - `category` and `subcategory` (from the user's existing list, or a new one)
   - `entities`: list of `{name, type}` where type is place, food, product, person, technique, topic, brand
   - `actionable`: typed by `type`:
     - recipe: `{servings, timeMin, ingredients:[{qty, unit, item, aisle}], steps:[]}`
     - place: `{places:[{name, city, country, why, lat?, lng?}]}`
     - product: `{products:[{name, brand, priceHint, url?}]}`
     - workout: `{exercises:[{name, sets, reps, durationSec}]}`
     - idea: `{keyPoints:[]}`
   - Source priority follows ReciMe: trust the caption first when it contains the full recipe or list, then fill gaps from the transcript, then from on-screen text. Mark each field's `source` so the UI can show "from video" hints.
6. **Embed.** Build one search text (title + summary + transcript + on-screen text + caption) and embed it. Also embed each transcript chunk of about 30 seconds so search can jump to the right moment.
7. **Write.** Update the `reels` document, upsert `concepts`, update `edges`, set status → `ready`, delete temp files, and DM the user "Saved under …".

**Failure handling.** Each step retries 3 times with backoff. On final failure set `status: failed` with the error; the app shows a retry button. If the video download fails, still run steps 5–7 on the caption alone.

**Speed target.** About 30–60 seconds per reel; run 3–4 workers in parallel for imports.

## Data model (MongoDB Atlas)

Seven collections in one Atlas cluster; every document carries `userId` and every query filters on it.

| Collection | Purpose | Key fields |
| --- | --- | --- |
| `users` | App accounts | `_id`, `email`, `igsid`, `linkCode`, `interests[]`, `createdAt` |
| `reels` | One per shared reel | `userId`, `reelVideoId`, `sourceUrl`, `source` (`dm` \| `paste` \| `export`), `caption`, `thumbnailUrl`, `status`, `type`, `title`, `summary`, `transcript[]`, `onScreenText`, `categoryId`, `entities[]`, `actionable`, `notes`, `userEdited[]`, `embedding[]`, `savedAt` |
| `chunks` | Transcript chunks for moment-level search | `userId`, `reelId`, `startSec`, `endSec`, `text`, `embedding[]` |
| `concepts` | Graph nodes | `userId`, `name`, `normName`, `type`, `reelIds[]`, `count`, `embedding[]`, `categoryId` |
| `edges` | Concept-to-concept links | `userId`, `a`, `b`, `weight` (number of reels both appear in) |
| `categories` | Collections shown in the UI (ReciMe's "cookbooks") | `userId`, `name`, `parentId`, `origin` (`auto` \| `user`), `coverReelId`, `reelCount`, `color` |
| `lists` | Groceries / Places / Wishlist | `userId`, `kind` (`groceries` \| `places` \| `wishlist`), `items[]`: `{text, qty, unit, group (aisle or city), checked, reelId}` |

`userEdited[]` lists fields the user changed by hand (e.g. `categoryId`, `title`) so re-processing and re-clustering never overwrite them. Adding items to `lists` merges on normalized item text within a group, like ReciMe combining duplicate ingredients.

**Indexes**

```
reels:      { userId: 1, reelVideoId: 1 } unique
reels:      { userId: 1, categoryId: 1, savedAt: -1 }
concepts:   { userId: 1, normName: 1 } unique
edges:      { userId: 1, a: 1, b: 1 } unique

Vector index "reels_vec" on reels.embedding
  (cosine, dims = embedding model size, filter fields: userId, categoryId)
Vector index "chunks_vec" on chunks.embedding (filter: userId)
Atlas Search index "reels_text" on title, summary, caption, onScreenText, transcript.text
```

**Why edges are a separate collection.** It keeps concept documents small and lets the graph view load all edges for a user in one query; `$graphLookup` can still walk `edges` for "related to X" queries.

## Knowledge graph and categories

The graph has three layers — categories, concepts, reels — and is updated incrementally each time a reel finishes processing.

**Concepts (nodes)**

- Each extracted entity is normalized (lowercase, trimmed, singular) into `normName`.
- Merge near-duplicates: if a new entity's embedding has cosine similarity above 0.9 with an existing concept of the same type, reuse that concept ("NYC" = "New York City").
- Add the reel to the concept's `reelIds` and bump `count`.

**Links (edges)**

- Every pair of concepts in the same reel gets an edge; `weight` += 1 each time they co-occur again.
- Reels are linked implicitly through shared concepts, so "related reels" = reels sharing the most high-weight concepts.

**Categories**

- On ingest, the extraction prompt gets the user's current category names and must pick one or propose a new one. This keeps the list stable and small.
- A nightly (or on-demand) re-cluster job runs k-means or HDBSCAN on reel embeddings, asks the LLM to name each cluster, and suggests merges. Users can rename, merge or move reels; their changes are never overwritten.
- Default seed list: Food, Travel, Fitness, Business, Tech, Style, Home, Learning, Funny.

**Insights (demo wow)**

- "You saved 34 Japan reels this month — plan the trip?"
- Top concepts per category this week; forgotten saves older than 90 days resurfaced.

## Search, chat and APIs

Search is hybrid (vector + keyword) and chat is retrieval-augmented over the same index, so both share one retrieval function.

**Search**

1. Embed the query.
2. Run `$vectorSearch` on `reels_vec` (top 50, filter `userId`, optional `categoryId`) and `$search` on `reels_text` in parallel.
3. Merge with reciprocal rank fusion; return top 20.
4. For each hit, run `$vectorSearch` on `chunks_vec` limited to that reel to find the best moment, and return its `startSec`.

**Chat with your saves**

1. Retrieve the top 10 reels for the question (same function as search).
2. Expand with graph neighbours: reels sharing the top concepts.
3. Send summaries + actionable data to the LLM with an instruction to cite reel IDs.
4. Stream the answer; the UI turns citations into reel cards.
5. With `reelId` set ("Ask" on one card), skip retrieval and answer from that reel's full transcript and actionable data, with quick-action chips per type (recipe: "Substitutions", "Scale to 2"; place: "Best time to go"; workout: "Make it easier").

**REST API**

| Method | Path | Does |
| --- | --- | --- |
| GET / POST | `/webhooks/instagram` | Verification handshake / receive messages |
| POST | `/auth/signup`, `/auth/login` | App accounts |
| GET | `/me/link-code` | Code to send to the bot |
| POST | `/reels` | Paste a reel link from the app; same queue as the webhook |
| GET | `/reels?category=&type=&concept=&sort=&cursor=` | Feed and collection pages |
| GET | `/reels/:id` | Detail: transcript, entities, actionable |
| PATCH | `/reels/:id` | Edit title, collection, actionable, notes (marks `userEdited`) |
| POST | `/reels/:id/retry` | Re-queue a failed reel |
| GET | `/search?q=` | Hybrid search with moments |
| GET / POST | `/categories` | Collection grid with counts / create a collection |
| PATCH | `/categories/:id` | Rename or merge |
| GET | `/lists/:kind` | Groceries, places or wishlist, grouped |
| POST | `/lists/:kind/items` | Add items (e.g. `{fromReelId}` adds a reel's ingredients) |
| PATCH / DELETE | `/lists/:kind/items/:itemId` | Check off, edit, remove |
| GET | `/graph?level=categories\|concepts&focus=` | Nodes + edges for the graph view |
| POST | `/chat` | Streamed answer with citations; optional `reelId` for single-reel Ask |
| POST | `/import` | Upload export zip (stretch) |

## Frontend screens

A mobile-first web app (installable PWA) structured like ReciMe: a bottom tab bar, a collection grid as home, rich detail cards, and bottom sheets for every secondary action.

**Navigation.** Bottom tab bar with four tabs plus a floating "+" button.

| Tab | ReciMe equivalent | Contents |
| --- | --- | --- |
| Home | Cookbooks | Search bar, "Recently saved" row, insight card, collection grid |
| Lists | Groceries | Segmented control: Groceries · Places · Wishlist |
| Ask | Ask ReciMe | Chat with all saves |
| Graph | (none, our differentiator) | Knowledge graph |
| **+** (floating) | Import sheet | Bottom sheet: "Share from Instagram" guide · "Paste link" · "Import export" (stretch) |

**Screens**

| Screen | What it shows | Notes |
| --- | --- | --- |
| Onboarding | Welcome → "What do you save?" chips → sign up → link code + "Open bot in Instagram" with live "Connected ✓" → "Show me how" + first save | Polls `/me` until `igsid` is set; see User flows §1 |
| Home | Search bar; "Recently saved" horizontal row (processing cards show a progress shimmer); one insight card; 2-column collection grid with cover thumbnail, name and count, plus a "New collection" tile | Default screen |
| Collection | Header with cover and count; filter chips (type, top concepts); sort sheet; 2-column reel grid (thumbnail, title, type badge) | Empty state: illustration + "Add your first reel" opening the + sheet |
| Reel detail | Hero thumbnail with "Open in Instagram"; title, collection pill ("Travel · Change"); action row (Add to list · Ask · Share); summary; **type card** (below); notes; transcript with tappable timestamps; related reels | Edit menu (⋯) for title, collection, card fields |
| Type cards | Recipe: servings stepper, metric/imperial toggle, ingredient checklist, numbered steps, "Add to groceries". Place: list with map, "Add to places". Product: items with links, "Add to wishlist". Workout: exercise table. Idea: key points | One component per `type`; fall back to summary-only |
| Lists | Groceries grouped by aisle with source-reel thumbnails; Places grouped by city with a map toggle; Wishlist with links; swipe to check off; "Clear checked" | Mirrors ReciMe's aisle-sorted grocery list |
| Ask | Chat thread with suggested prompts per collection; answers include tappable reel cards; from a reel detail it opens scoped to that reel with quick-action chips | Single-reel mode = ReciMe's "Ask ReciMe" |
| Graph | Force-directed graph: collections first, tap to expand concepts, then reels | `react-force-graph-2d`; size = count, colour = collection |
| Search results | Reel cards with the matched moment ("at 0:42: …") highlighted | Opens from the Home search bar |

**Visual style (borrowed from ReciMe).** One bright brand colour for headers and the tab bar, one warm accent (orange) reserved for primary CTAs ("Add to groceries", "Create collection"), white rounded cards with large photos, friendly illustrated empty states, and bottom sheets instead of new pages for pickers, sort and import. Every collection gets a colour that is reused in its type badges and graph nodes.

**Live updates.** The "Recently saved" row listens on a Server-Sent Events stream (or polls every 3 s), so a reel shared during the demo appears on screen within a minute and animates from "Processing…" to the finished card.

## Build plan

One backend service, one worker, one frontend and Atlas — split across four people, with the webhook proven by Saturday morning.

**Tech stack**

| Layer | Choice | Why |
| --- | --- | --- |
| Backend API + webhook | Node (Fastify) or Python (FastAPI) | Whatever the team knows best |
| Queue | BullMQ on Redis (Node) or RQ (Python) | Retries and concurrency built in |
| Worker | Python | ffmpeg, Whisper and ML libraries are easiest here |
| Database | MongoDB Atlas free tier | Documents, vector search and text search in one place |
| LLM + vision | Any multimodal model with JSON output | One model for extraction, vision and chat |
| Transcription | Whisper API or `faster-whisper` | API is faster to set up |
| Frontend | Next.js + Tailwind, `react-force-graph-2d` | PWA works on phones for the demo |
| Hosting | Render / Railway / Fly for API + worker; Vercel for frontend | Webhook needs a public HTTPS URL (use ngrok locally) |

**Team split (4 people)**

- **A — Instagram + backend:** Meta app, webhook, account linking, Send API replies, REST endpoints.
- **B — Pipeline:** worker, ffmpeg, Whisper, vision, extraction prompt, embeddings.
- **C — Data + graph:** Atlas indexes, search and RRF, concept merging, edges, categories, chat retrieval.
- **D — Frontend + pitch:** tab shell, collection grid, reel detail + type cards, Lists, graph view, demo script, slides. (If D is overloaded, A takes Lists after the endpoints are done.)

**Weekend timeline**

1. **Fri night:** Meta app + bot account + tester accounts; log a real `ig_reel` payload. Atlas cluster up. Repo skeleton.
2. **Sat morning:** webhook → queue → worker end to end on one reel (even with stub AI steps). Frontend shell on mock data.
3. **Sat afternoon:** real transcription, vision, typed extraction, embeddings. Search endpoint. Collection grid and recipe/place type cards with real data.
4. **Sat night:** Lists (groceries first), graph + concepts, chat + single-reel Ask. Seed 50–100 reels across teammates' accounts.
5. **Sun morning:** onboarding flow, insights card, empty states, polish. Feature freeze by noon.
6. **Sun afternoon:** rehearse the demo 3+ times; record a backup video.

**Demo script (2 minutes)**

1. Problem in one line + show a messy saved folder.
2. Live: share a recipe reel to the bot on stage; bot replies "Got it."
3. While it processes: search "cheap dinner ideas" across 100 seeded reels; jump to the exact moment.
4. The new reel turns into a full recipe card in "Recently saved", in the right collection. Tap "Add to groceries"; the Lists tab shows the ingredients merged and grouped by aisle. ("ReciMe does this for recipes; we do it for everything you save.")
5. Open the graph; zoom from Travel → Lisbon → reels.
6. Chat: "Plan 2 days in Lisbon from my saves" → cited itinerary.
7. Close with business model + roadmap (YouTube via official login, export import).

**Risks and fallbacks**

| Risk | Fallback |
| --- | --- |
| Reel shares arrive as unsupported / no URL | Test Friday night; fall back to users pasting the reel link into the DM or the app |
| Webhook only fires for testers | Fine for the demo; mention App Review on the roadmap |
| CDN URL expires before download | Download in the webhook's first job step; caption-only processing if it fails |
| Processing too slow on stage | Pre-seed reels; demo the live share while showing other features |
| Venue Wi-Fi fails | Backup screen recording of the full flow |
| Instagram / copyright concerns | Delete videos after processing; store only derived text, embeddings and thumbnail |
