# Build log

Decisions made during the build, newest phase last. One line of why for each.
Failures and their workarounds are in BLOCKERS.md.

## Phase 0: repo reconciliation (2026-11-14)

`git fetch --all --prune` showed one branch, `origin/main` at `4dc4924`. Working branch: `realize-build`, cut from that commit. Main has not moved since.

### Branches
| branch | decision |
|---|---|
| `origin/main` (`4dc4924`) | Base of `realize-build`. Nothing newer to merge. |
| `realize-build` | This build. |

### Top-level paths found on main
| path | what it is | decision |
|---|---|---|
| `SPEC.md` (Reel Brain, 99 KB) | The old end-to-end spec | Archived as `docs/archive/SPEC-reel-brain.md` (git mv, history kept). Replaced by the Realize `SPEC.md`. |
| `Saved Reels Second Brain — System Design.md` | First system design | Archived as `docs/archive/system-design-v1.md`. |
| `mockups/` | Clickable Reel Brain mockup (serif, warm palette) | Archived as `docs/archive/mockups/`. DESIGN.md replaces its look; nothing is built from it. |
| `fetch_reel.py` | yt-dlp + ffmpeg test script for TikTok, Instagram, YouTube | Archived as `docs/archive/fetch_reel.py`. Its yt-dlp option sets and "keep going on failure" handling carried into `server/realize/ytdlp.py`. Frame and audio extraction is not needed: Gemini reads the video file directly. |
| `prototype/` | Node share-from-Instagram test server and Shortcut notes | Untouched. Its URL rules (`extractInstagramUrl`, `reelIdFromUrl`: optional username segment, `www.`/`m.` hosts, link inside other text) are the base of `server/realize/urls.py`. Its tested Shortcut steps and troubleshooting notes go into `shortcut/README.md`. |
| `.claude/skills/` | Five skills | Used as CLAUDE.md says. |
| `.env.example` | Config template | Kept. Matches SPEC section 4 except the model names (see below). |
| `.gitignore` | Ignores `.env`, `secrets/`, venvs, `node_modules`, `.next` | Kept and extended (screenshots, videos, caches). |
| `README.md` | Two lines, UTF-16 | Replaced in phase 6 with a UTF-8 README. |
| `.env`, `secrets/`, `.venv/` | Local only, gitignored | `.env` is the source of truth for config. Root `.venv` (Python 3.14, used for an earlier model test) is left alone; the build uses `server/.venv`. |

### Added in phase 0
`CLAUDE.md`, `SPEC.md`, `DESIGN.md` at the root (the Realize versions), and the build prompt as `docs/PROMPT.md`.

### Open questions and the call made
- **`fixtures/` did not exist.** The prompt says `fixtures/reels.csv` is in place; it is not on main or on disk. Call: built it from 16 real public reels found on public profile pages (two or more per type, including a speech-only one), each checked with yt-dlp. `fixtures/queries.csv` is written after enrichment so spoken-phrase queries are real.
- **Model names.** CLAUDE.md says `.env` has `gemini-3.8-flash`; the real `.env` has `gemini-3.5-flash` for both. `check_models` shows `gemini-3.5-flash` exists for this key and is not Lite, so `.env` stays as it is (CLAUDE.md: change it only if the ID is missing).
- **Python version.** The spec says 3.12. This machine has 3.13 and 3.14 only. Call: `server/.venv` uses 3.13 (closest, all wheels available); the Dockerfile stays on `python:3.12-slim` as specified. Nothing in the code needs newer than 3.12.
- **`INSTAGRAM_COOKIES_PATH=REPLACE_OR_LEAVE_BLANK`.** Not a real file. The code treats a path that doesn't exist as "no cookies" and logs "No Instagram cookies; public access only." `.env` is not edited.
- **No `ffmpeg` on this machine.** yt-dlp's first format choice (`b[ext=mp4]`) is a single file and needs no merge, so downloads work without it. The Docker image installs ffmpeg as specified.

## Phase 1: skeleton and contract

- **Gemini API surface.** The gemini-api-dev skill and current docs make the Interactions API the standard (google-genai 3.x). The planner and Ask use `client.interactions.create(store=False, ...)` in stateless mode: the history is kept client-side and every model step (including `thought` steps with signatures) is resent unchanged, which is the spec's "append each response unchanged" rule. Tool choice uses `generation_config.tool_choice.allowed_tools` (mode `any`) to force the terminal tool. Embeddings still use `client.models.embed_content`, as the docs show.
- **Thinking level.** The docs list `minimal` for some Flash models and `low` as the floor for others (3.8 Flash, Gemini 4). `gemini.lowest_thinking()` probes `minimal` once per process and falls back to `low`. Measured on this key: one forced tool call on `gemini-3.5-flash` took 4.0 to 4.4 s at either level.
- **Quiet hours vs the default workout time.** SPEC 8.3 says skip a slot whose start or end is in quiet hours, but the default prefs put workouts at 7:00 am inside the default quiet window (10 pm to 8 am), which would leave workouts with no slots ever. Call: when the user's own preferred time for a kind sits inside their quiet window it is treated as a deliberate choice and quiet hours don't block that kind. A slot that only runs into quiet hours because of its length (cook at 9:30 pm for an hour) is still skipped. Both cases are unit tested.
- **A slot may end exactly when quiet hours begin.** The end check uses the slot's last minute, so 9:30 to 10:00 pm is allowed with quiet from 10 pm.
- **Sample planning runs on a small thread pool, not a FastAPI BackgroundTask.** BackgroundTasks start after the response is sent, and `/api/save` has to poll for the plan before responding. Same process, same behavior otherwise.
- **`PLANNER_MODE=fake` plans inside the API process** (no jobs, no worker), so the Shortcut contract can be tested with nothing else running.
- **Error mapping order.** yt-dlp's usual Instagram block message reads "Requested content is not available, rate-limit reached or login required". It contains "not available", but it is a block, so `blocked` is checked before `unavailable`.
- **Creator handle.** For Instagram, yt-dlp's `uploader_id` is a numeric account id and the @handle is in `channel`. `creator.handle` uses `channel` when `uploader_id` is numeric.
- **"This week" is a rolling 7 days starting today**, not Monday to Sunday. With a calendar week, a plan made on Saturday for Monday would be hidden under "Coming up" and the home screen would look empty all weekend.
- **Extra modules beyond the SPEC section 3 list:** `accounts.py` (keys and users), `planops.py` (plan transitions), `tickets.py` (the Ticket shape), `runs.py` (agent_runs). They hold code the listed files would otherwise share.
- **Extra read-only routes:** `GET /api/demo/hero` (the landing page's proposed ticket, built from the first recipe sample, writes nothing) and `GET /api/chips` (Ask starter questions from the user's data, no LLM). The spec asks for both behaviors but names no route.
- **Stale proposals.** A proposed plan whose first option has already passed gets fresh options from `slots.py` the next time it is listed, with the old ones kept in `options_prev`, so "Waiting on you" never offers a past time.
- **Atlas.** Server 8.0.37. `create_indexes` reports both search indexes queryable and the `$rankFusion` test query worked, so `HYBRID_MODE=auto` uses `$rankFusion`.

## Phase 2: real propose

`git fetch` before the phase: main unchanged at `4dc4924`.

- **Instagram works without cookies from this laptop.** yt-dlp read metadata for 60 public reels in a row at about 1.3 s each and downloaded every video it was asked for. No block was seen. Cookies stay optional.
- **First live save (two model turns):** 21.0 s from POST /api/save to the proposal; the worker took 17.8 s. Command: `python -m scripts.simulate_shortcut --url https://www.instagram.com/reel/DfYi19kRNT0/ --base http://localhost:8000 --key <key> --choose 1`. The menu was "Cook Mon 6:30 pm + 7 groceries", "Cook Tue 6:30 pm + 7 groceries", "Not now", "Just vibes"; the event landed at Nov 16, 2026 at 6:30 PM with groceries at 12:00 PM and a check-in at 9:30 PM.
- **The Gemini free-tier quota ran out during the full fixture run** (BLOCKERS.md item 1). Of the first five planner runs, three finished normally and two hit the 15 s budget and fell back. The run was stopped there.
- **The SDK retries 429 and 5xx four times with backoff by default.** With a per-request timeout that turned one rate-limited call into a hang that held a job lease for minutes. Retries are now off (`sdk_configuration.retry_config`), every call runs under a hard wall-clock deadline, and jobs.py is the only place that retries.
- **Planner prompt, step 3, differs from the spec text.** The spec says "Call search_saves ... call find_free_slot". Code now runs both before the first model turn and puts the results in the message (SIMILAR SAVES, FREE SLOTS); the prompt tells the model to call the tools only for a different search, window or duration. Why: each extra model turn measured 4 to 9 s on this key, and the Shortcut only waits 20 s. Both precomputed calls are still recorded as agent steps, and the model still has the tools.
- **Propose-time fields are brief.** The schema description asks for every ingredient but at most 6 short steps and 2 tips; the video pass fills in the rest about 20 s later. The second model turn was 9 s mostly because of long step text.
- **Status flips to `planned` before the caption embedding**, so a waiting Shortcut doesn't also wait on the embedding call. The save is searchable half a second later.
- **A rate-limited planner retries the job** (8 s, then 25 s) instead of falling back at once; the last attempt uses the spec's deterministic fallback. A fallback plan of kind `other` is replaced by the replan after enrichment when the video shows a different type.
- **`GEMINI_MODEL_FAST_FALLBACKS` and `GEMINI_MODEL_VIDEO_FALLBACKS`** are new optional settings (blank by default, documented in `.env.example`). They are not model names in code: the lists come from config.
- **No thinking-level probe.** The first real request tries `minimal` and drops to `low` for a model that rejects it, so no quota is spent finding out.
- **`scripts/run_fixtures.py`** is new: it runs the phase 2 and 3 checks over `fixtures/reels.csv` and prints the median save-to-proposal time.

## Phase 3: enrich

- **Verified live on 5 saves (4 reels)** with `gemini-3.5-flash`: each reached `ready` in 16 to 35 s with a timestamped transcript; `agent_runs` held a propose run and an enrich run with download, analyze, grounding and embed steps; the uploaded Gemini file was deleted each time.
- **Spoken-only search works.** "let the fridge do the rest", "rolling pin" and "lonely bag of spinach" appear in the transcripts and not in the captions of three reels; `/api/search?q=ladyfingers dipped in coffee` returned the tiramisu reel first in `rankfusion` mode.
- **Instagram's metadata has no duration** for these reels (yt-dlp returns `None`), so `duration_sec` is usually empty and the 600 s limit relies on the 100 MB download cap.
- **Search falls back to text only** when the query can't be embedded (quota, outage), and says so in `mode`.
- **The other 12 fixtures were enriched by a Lite video model** (`gemini-3.5-flash-lite` or `gemini-3.1-flash-lite`, through `GEMINI_MODEL_VIDEO_FALLBACKS`) because the configured model had no quota left. Lite is allowed for video by CLAUDE.md, but its output is weaker: it typed the Somssi restaurant reel as `other`. Rebuild with `python -m scripts.build_samples --no-reuse` when quota returns.

## Phase 5: demo mode (server side)

- **`build_samples` reuses work.** A reel that some account already has fully enriched is copied into the cache instead of being downloaded and watched again, and a plan the live planner already wrote for it supplies the cached question and why. `--no-reuse` turns this off; `--missing` skips reels already cached; `--plans-only` reruns the planner for cached plans that were derived by code.
- **Cached plans hold no day words.** A planner question like "Make tiramisu Mon 6:30 pm?" would be wrong on any other day, so a cached question or why that names a day or a time is replaced by a fixed sentence for its type.
- **Invalid key check.** With `GEMINI_API_KEY=invalid-key-for-test` and no worker: demo session, save a sample, the run ends as `fallback`, the ticket proposes "Cook Wed 6:30 pm + 6 groceries", and confirm answers "Added to Wednesday."

## Phase 6: ship files

- `docker compose config` validates. `docker compose build` was not run: Docker is installed (29.7.2) but the daemon was not running on this machine.
- The web image bakes `API_INTERNAL_URL=http://api:8000` at build time, because Next.js resolves rewrites when it builds.
- README prize sections follow the prize list in `docs/archive/SPEC-reel-brain.md` (Gemini, MongoDB Atlas, agentic, UI/UX, impact, Vultr).

## Phase 7: eval

- `python -m scripts.eval_recall` (2026-11-14): 20 of 20 queries at rank 1 over the 16-reel sample library, mode `rankfusion`. Full table in `eval/results.md`. Six of the queries use phrases that are spoken in the video and absent from the caption. The library is small and each query was written for one reel, so this is a smoke test of the hybrid search wiring, not a benchmark.

## State of the sample cache (2026-11-14)

- 16 of 16 fixture reels are cached. 4 recipes were enriched by `gemini-3.5-flash` and carry plans from the live planner. 12 were enriched by a Lite video model after the daily quota ran out, and their cached plans were derived by code because every non-Lite Flash model was out of quota (`gemini-3.8-flash` is also 20 requests per day on this key) or answering 503.
- 15 of 16 types match `expected_type` in `fixtures/reels.csv`. The miss: the Somssi restaurant reel (`DfmpjJVNa85`) came back as `other` from the Lite model.
- The Lite pass did not extract a start time for the two event reels, so their cached plans offer "Remind me to check dates".
- To redo all of that with the configured models once quota is back: `python -m scripts.build_samples --no-reuse`.

## Smaller calls made along the way

- **Undo gives fresh times.** `POST /api/saves/{id}/unconfirm` recomputes the options, because the ones stored at proposal time can collide with plans accepted since.
- **`GET /api/saves/{id}/slots`** returns up to 3 free slots for the Change sheet ("Sun 12 pm · You're free"). The spec describes the sheet but no route for its data.
- **`fixtures/queries.csv`** was written after enrichment: 20 queries, at least one per reel.

## Phase 4: web core

Built by a parallel agent from DESIGN.md and SPEC section 13, then reviewed. `npm run build` passes and `npm run lint` is clean. Screenshots for every DESIGN section 9 state at 390x844 and 1440x900 are in `screenshots/phase4/` (gitignored), except the three Ask answer states, which could only be rendered from a mocked stream because `/api/chat` was out of Gemini quota (see BLOCKERS.md item 3).

Decisions (one line of why each):
- **`radix-ui` is the one added dependency**, pulled in by the shadcn sheet, switch and dropdown primitives. The `cn` npm package that `shadcn add` installed was removed; `web/lib/utils.ts` joins class names itself.
- **Playwright lives in the root `.venv`**, not in `server/requirements.txt`: it is tooling for the webapp-testing skill, not part of the product.
- **The landing hero ticket has no buttons**, so "Try the demo" is the only yellow button and nothing on the page is a dead control. On desktop the landing is two columns.
- **"How it was planned" is a link on full tickets**: it selects the save in the side panel at 1100 px and opens the bottom sheet below that.
- **A printing ticket starts with a "Saved" line**, so the stub is never empty before the first real step arrives.
- **Follow-up-due plans on Plans render as full tickets**, so Done can tear in place.
- **The list refresh waits 600 ms after an Add**, so the punch finishes before the ticket moves.
- **The second "This week" heading shows only when "Waiting on you" is present**, to avoid repeating the page title.
- **"Coming up: n more" expands in place** using `?range=upcoming`.
- **SWR deduping is 500 ms**: the default 2 s window stretched the 700 ms poll to about 2 s.
- **Event dates show the reel's own `date_text` first**, the normalized date only when there is none.
- **Setup step 4 falls back to "open a reel in Instagram"** while `FIRST_SAVE_REEL_URL` is empty, and detects the first save by a new newest save id, not by clock, to avoid phone and server clock skew.
- **Copy written where DESIGN has none:** confirm-sheet buttons ("Keep this key", "Sign out", "Stay signed in"), the side panel's empty line, "Show more", the empty type-filter line, a note for seeded samples that have no trace, and "Couldn't read this reel yet" on failed Library rows.
- **Library keeps a "Paste a reel link" button in the header** when it isn't empty.
- **Ticket titles on Plans and Samples link to the detail page.**

Backend fixes that came out of the UI review:
- **Search has a relevance floor.** Vector search returns its nearest neighbours even for nonsense ("zebra unicycle" returned four reels). Measured over the eval queries, the right reel scored 0.565 to 0.80 cosine and unrelated queries topped out at 0.578, so cosine alone can't separate them. A result is now kept when it shares a word with the query or has cosine of at least 0.60. `eval_recall` after the change: still 20 of 20 at rank 1; "zebra unicycle" returns nothing.
- **Event years are sanity checked.** The Lite video model wrote "2023-11-14" for a show announced on Nov 12, 2026. A start more than 60 days before the post date is moved to the post's year (`actions.fix_event_year`).
- **An event that has started but is still running** (the train show runs to Jan 10) gets a weekend reminder and "It runs until Jan 10." instead of "It's passed."
- **An undated event's reason line** now says the date isn't clear, to match its "Remind me to check dates" button.
- **A new account's saves take about 5 seconds to appear in search**, because Atlas Search indexes asynchronously. Measured on a fresh demo session.

## Phase 5: demo mode (browser check)

With the built-in browser at 375 px wide, logged out: landing showed the real hero ticket; "Try the demo" opened `/demo`; "Save to Realize" on the chickpea curry sample printed "Saved" and "Checking your saves", then proposed "Wed 6:30 pm" with "Add to Wednesday"; tapping it showed "Added to Wednesday", the two reminder lines and both calendar links; `/plans` listed it under Wednesday, Nov 18 next to the two seeded plans; `/ask` showed three chips built from the account's data. Tapping a chip was not verified to return cards (Gemini quota).

## 2026-11-14: web app on iPhone becomes the main path

The user's direction after the build: "we're making this a web app for ios". SPEC.md is written around the iOS Shortcut; where they differ, this direction wins. Decisions:

- **Saving happens inside the web app.** A web app on iOS can't appear in Instagram's share sheet, so the flow is copy link, open the app, paste. New `/save` page with a one-tap "Paste the link I copied" button (shown only on https, where the browser allows clipboard reads) and the paste box. `/save?url=` saves a link handed over in the address, so a bookmark or a one-step Shortcut can open it.
- **Real accounts get a Save tab** where demo accounts have Samples. Plans' empty state points to it.
- **Installable.** Web app manifest, Apple Home Screen tags and three icons drawn from the DESIGN tokens by `server/scripts/make_icons.py`. The name in the manifest and the title is read from `GET /api/config`.
- **The key has to follow the app to the Home Screen.** An installed web app on iOS has its own storage, so it would open signed out. The manifest has no `start_url`; while `/setup` is open in Safari on an iPhone the key sits in the link's fragment, the Home Screen icon keeps that link, and the installed app reads the key on first launch and goes to Plans. A key already stored in the app wins over the one in the link, so "New key" in Settings doesn't lock the app out. Not tested on a real iPhone yet. Fallback: "Already have a key?" on `/setup`.
- **Calendar.** A web page can't write Reminders. The ticket's .ics link is now served `inline` so Safari opens its "Add to Calendar" sheet, opens in a new tab so an installed app keeps its own page, and reads "Add to Apple Calendar". The file already carries the alerts.
- **The Shortcut is optional.** `/setup` on iPhone shows the web steps first and offers the Shortcut only when `SHORTCUT_URL` is set.
- **README was UTF-16** in the repo; converted to UTF-8.
- **No new dependencies.**

Checked at 375 px with an iPhone user agent in the built-in browser: `/setup` created an account, showed the three steps and kept the key in the link; `/save?url=` saved the tiramisu reel and printed its ticket; "Add to Monday" showed both calendar links; no sideways scroll. `npm run build`, `npm run lint` and 49 unit tests pass.

## 2026-11-14: fixes from the test pass

- **Two plans can't take the same time.** Options are computed when a plan is proposed, so two waiting recipes could both hold "Wed 6:30 pm" and both be confirmed into it. `planops.slot_taken` checks a cook, train or visit time against the other accepted plans (overlap and the daily cap). Confirm refuses a taken time, recomputes the options and sends the ticket back with "That time was just taken. Pick another."; the web ticket shows the new times. Waiting tickets are also refreshed when a time of theirs gets taken, not only when it has passed. Events keep their own date and reminders take no time, so neither is checked.
- **Events whose days are known but whose time is not.** The video pass returned `date_text: "November 13th and 14th"` with no `start_local` for the Carrie reel, and the code offered "Remind me to check dates" for two days after the show closed. `actions.event_date_range` now reads the days from `date_text` in code (month names, "13 and 14 November", "11/21", ISO dates; a number counts as a day only next to a month or joined to another day). Then: passed means not actionable; a run of up to 3 days gets the planner's own rule, 7 pm as a best guess on the next of its days still ahead; a longer run gets a reminder and "It runs until Jan 10." When no day can be read, "check dates" stays.
- **The reason line follows the options** when a plan is recomputed (`replan_code` used to keep the old one).
- **Search includes saves from the last two minutes.** Atlas Search indexes a document a few seconds after it is written, so a new demo session or a reel saved a moment ago was missing from search. `search._fresh` reads those saves straight from the collection (same `user_id` filter), applies the same relevance floor and merges them by similarity. Measured: a search 0.4 s after a demo session was created returned its results; before, one at about 10 s returned none.
- **Model-written titles.** One sample title used a word the copy rules ban ("Leveraging Parallel Pathways..."). The video and planner prompts now ask for plain titles and list the words; that sample is renamed "Exercise and Cold Exposure for Focus and Learning" and re-embedded (cache and the 15 saves copied from it).
- **Not fixed here:** the Somssi restaurant reel is still typed `other`. That needs the video pass rerun with Gemini (`python -m scripts.build_samples --only DfmpjJVNa85 --no-reuse`).

Checks: 70 unit tests pass (21 new). A live script against the API passed 13 of 13: search right after session start, the Carrie ticket ("Add Today 7 pm", reason "It's on Nov 13 to Nov 14. The reel gives no time, so 7 pm is a guess."), and the double booking refused with new times offered. `python -m scripts.eval_recall`: hit@1 20/20, hit@3 20/20.

## 2026-11-14: the mockup becomes the front end

The user's instruction: "use the mockup as the front end specifically and wire up the buttons". The mockup is `docs/archive/mockups/index.html` (Home and the Reel page). This overrides two earlier rules for the web app: CLAUDE.md's "never build from docs/archive" and DESIGN.md's ticket look. Decisions:

- **Ported into the Next app, not served as a static page.** The mockup's stylesheet (`web/app/mock.css`), icon sprite and two fonts (Hedvig Letters Serif, Figtree) are copied; the markup is React components on the existing data layer. None of the mockup's sample content is used.
- **Screens:** Home (`/home`, the landing screen after sign-in) with the greeting, search, the "Recently saved" rail, idea chips and "Your tastes"; the Reel page (`/s/[id]`); the bottom bar with the orb; the "Add a reel" and "File under" sheets. Plans, Ask and the saves list are redrawn in the same look. Landing, setup, demo, save, settings and the public plan page keep their layout and take the new colours and fonts.
- **Every mockup button does something real.** Add saves through `/api/save` and shows the processing tile; tiles open the Reel page; idea chips and the orb go to Ask (hold the orb to dictate where the browser supports it); taste tiles and search open the saves list; the category chip changes the type; the note saves; servings rescale and ticks persist; "Make a grocery list" builds the list by aisle with Copy and Share; "Open original" opens Instagram; the more menu has Plan again and Delete.
- **The plan card is new.** The mockup has no plan. The product's core (suggested time, confirm, change time, not now, calendar links, done, undo) is drawn as a card on the Reel page and on Plans, in the mockup's style.
- **Tastes are the seven types.** The mockup's custom categories and sub-categories ("Food > Thai") don't exist in the data, so "Your tastes" shows the types with counts, thumbnails and top tags (`GET /api/tastes`), and the "New taste" tile is left out.
- **New API for the buttons:** `GET /api/tastes`, `PATCH /api/saves/{id}` (type, note), `name` on `/api/me`.
- **No new dependencies.**

Checked by a subagent in headless Chromium at 390x844 and 1440x900 and again by hand in the built-in browser at 375 px on a fresh demo account: Home showed 8 real saves and 6 tastes; Add with a sample link showed "Planning it" and became a card; the Reel page's plan confirmed ("Added to Wednesday") and showed both calendar links; Plans listed it under Wednesday; Ask answered "what can I make with canned chickpeas and coconut milk" with the right reel. `npx tsc --noEmit` and `npm run lint` pass. Not checked: dictation with a real microphone, Share on the grocery list (needs a phone), and any of it on a real iPhone.

## 2026-11-14: landing headline

The owner asked for the line "Bring back intentional scrolling" somewhere strong. It is now the landing headline, the first thing anyone sees before the demo. "Every save becomes a plan." stays as the bold lead of the paragraph under it. The word "intentional" carries the same highlighter mark as a ticket's planned time, so the promise and the plan read as one idea. Checked at 375, 800 and 1280 px wide: two lines at each, no sideways scroll.

## 2026-11-14: trip plans for travel reels

The user asked for more to do with a travel reel than one visit slot: an itinerary, dates, weather, costs, sources, and more detail when a day is tapped. First slice, for `place` and `event` saves. Decisions:

- **Built on request, not on save.** A trip build is two model calls plus web searches, so it runs when the person taps "Build the trip plan", and a day's detail runs when they open that day. Demo accounts get 3 trips.
- **Search grounding, then structure.** Call 1 uses Gemini's `google_search` tool and returns notes with cited spans. Code turns each cited span into a `[n]` marker and a numbered source list, and follows each search redirect once so the saved link is the real page. Call 2 turns the marked notes into JSON with no tools. `gemini-api-dev` docs were read for the tool and the citation format; one test request confirmed it (`url_citation` annotations with `end_index`, `url`, `title`).
- **Code decides what is kept** (`trip.clean_trip`, `trip.clean_day`): a price, opening time, booking note, start time, place to stay or heads-up is kept only when its source number exists; an added stop with no source is dropped; a stop is "from the reel" only when its name matches one the video pass recorded, whatever the model says; every reel place is in the plan even if the model left it out; at most 3 days and 5 stops a day.
- **Code makes every date, time and link.** Place trips start on the first free weekend day (`slots.find_free_slot`) and can be moved to any of the next four Saturdays without a model call. An event keeps its own date and its trip covers only the event's remaining days. Clock times come from part-of-day starts, each stop's minutes and a 30 minute gap; a start time the search found (with a source) replaces the default. Maps, directions, Google Calendar and the per-day calendar file are built from names and times.
- **Weather is Open-Meteo** (free, no key; `WEATHER_API_URL`, `GEOCODE_API_URL` in config). Only real forecast days are shown; outside the 16 day window the trip says when the forecast opens. The geocoder's first hit for "Rockaway Beach" is in Oregon, so the lookup matches on country and then on state.
- **No new Python dependencies.** `httpx` was already in the stack.
- **Not in this slice:** frames from the reel as stop photos (needs `ffmpeg`, which this laptop doesn't have), online images, flight and hotel prices, and the cooking equivalent.

Measured live (`gemini-3.5-flash`): the Rockaway Hotel reel built in 23.7 s with 4 stops and 11 sources, its day detail in 28.8 s (8 sourced highlights, 2 places to eat); moving the dates took 0.2 s; 21 of 21 checks passed. The Carrie event built in 13.4 s and 17.2 s on two runs. Prices differed between those two runs because the search cited different pages; each number links to its page. 94 unit tests pass (21 for trips and weather).

## 2026-11-14: email and password accounts

- **Why:** a key with no password was easy to lose and hard to use on a second device. People now create an account with an email and password and sign in anywhere.
- **Server:** `POST /api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, and `/api/auth/credentials` (gives a key-only account an email and password). Passwords use stdlib `hashlib.scrypt` (no new dependency). Sign-in returns a session token (`rs_...`, 30 days, stored as sha256 in a new `sessions` collection with a TTL index). `accounts.find_by_key` accepts either a session token or an API key, so every existing route and its `user_id` filter is unchanged. Unique partial index on `users.email`. Login is rate limited per IP and per email; an unknown email still runs one scrypt check so timing doesn't reveal it.
- **Web:** `/signup` and `/login`. The landing "Use it for real" goes to `/signup`, with a "Sign in" link. `/setup` no longer makes keyless accounts; for email accounts the QR code opens `/login` and no key is shown. Settings shows "Signed in as" and Sign out (ends the session on the server); key-only accounts get an "Add an email and password" form. The Shortcut key is still made in Settings and shown once.
- **Kept:** API keys, `POST /api/users`, demo sessions and the judge user work as before.

Checks: a live script against Atlas passed 17 of 17 (signup, duplicate email, bad email and short password refused, login with a case-changed email, wrong password, user B can't list or open user A's save, logout ends only that session, key account adds credentials and its key still works, login rate limit). In the browser at 390x844: sign up, Settings, sign out, wrong password message, sign in, setup QR. 70 unit tests, `tsc` and `eslint` pass.

## 2026-11-14: sub-categories

- **Why:** the mockup files saves as "Food › Thai", and the owner asked for sub-categories. Until now the data had only the seven types, so the Home taste tile showed tags in its sub-category row.
- **How:** the planner and the video pass each return a `subcategory`, shown the account's existing labels so they reuse one; no extra Gemini calls. `server/realize/subcats.py` tidies the label and snaps it onto an existing one that differs only in case, punctuation or a plural. Hand-set labels are `user_edited` and never overwritten; moving a save to another type clears its label.
- **UI:** "Food › Dessert" on the save page chip (tap to pick, add or remove) and on list rows; a sub-category chip row in Library under a picked type; sub-categories in the Home taste tile, falling back to tags.
- **Backfill:** `python -m scripts.backfill_subcategories --all-users | --user u_... | --samples [--dry-run]`, one text call per account and type.
- **No new dependencies.**

Checks: 3 live reels labelled Dessert, Curry, Appetizers by the planner and kept by the video pass; 11 of 11 API checks on editing, snapping, filtering and clearing; the screens checked at 390x844; 77 unit tests, `tsc` and `eslint` pass. Steps to merge are in `docs/merge-subcategories.md`.

## 2026-11-14: discussions on the Reel page

The owner's ask: "Ask about this" sent you to the general chat, which had to find the reel again, repeated its summary back, and kept nothing. Now the Reel page has its own chat.

- **A discussion knows its reel.** `server/realize/discuss.py` puts the reel (fields, caption, on-screen text, transcript with start seconds, the person's note, the plan) in the prompt. One structured-output call, no tools, no search. The prompt says the person can already see the page, so the answer starts with the answer. General knowledge is allowed and is labelled "Not from the reel."
- **Saved with the reel.** New `discussions` collection (`user_id`, `save_id`, bounded `messages`, TTL for demo accounts; indexes in `create_indexes.py`). A question and its answer are written together, so a failed call leaves nothing. Deleting a save deletes its discussions.
- **API:** `GET` and `POST /api/saves/{id}/discussions`, `GET` and `DELETE /api/discussions/{id}`. Demo chat limit now counts Ask and discussions together (`demo.chats_used`).
- **The model may point at a spoken line; code checks it.** `at_sec` is snapped to a real transcript line within 3 s or dropped. The page shows "Said at 0:05", which opens the transcript at that line. `/s/{id}?t=5` does the same.
- **Reel page:** "Ask about this" takes the orb's colours (deepened so white text passes 4.5:1) and opens the chat as a full layer. "Discussions" lists saved ones under the actions. The transcript, on-screen text and "How it was planned" sit behind one closed "Details" row.
- New styles go in `web/app/v2.css`, so `mock.css` stays the port of the first mockup.

Measured on the poutine reel (demo account, `gemini-3.5-flash`): three questions answered in 2.0 to 3.6 s. 97 unit tests pass (3 new). Checked in headless Chrome at 390x844: new discussion, reopening a saved one, a follow-up, "Said at 0:05" opening the transcript, Escape closing the layer, no console or network errors. Not checked: a real iPhone.

## 2026-11-14: Home headings, Ask's answer, and the voice layer

- **Section headings** on Home and Plans use the display face, so "Recently saved" no longer reads like a tile's title. A pill beside it says "1 saving" (with a pulsing dot) while a reel is being read and "1 new" after; "Your tastes" shows its count.
- **Ask's answer** arrives word by word (`Streamed`: pacing only, the API still answers in one piece; whole text at once under reduced motion). Order is now answer, source reels, plan cards, then up to 2 next questions as buttons. The next questions come from the model through `respond.follow_ups`, cleaned in code (`ask.clean_follow_ups`).
- **Moments.** When a card's snippet is a line spoken in the video, the card carries its second (`search.moment`, token overlap against the transcript, never the opening line) and the tile opens `/s/{id}?t={sec}`, which shows that transcript line.
- **Voice.** Holding the orb already dictated through the browser's speech recognition. It now opens a full layer with the words as they are heard: settled words in ink, the tail in grey while it can still change. On release the question goes to Ask marked "Said out loud". No new dependency; browsers without speech recognition still treat a hold as a tap.

99 unit tests pass (2 new). Checked in headless Chrome at 390x844 with a scripted speech recogniser: hold, words appearing, release, the spoken bubble, the streamed answer, next-question buttons. Not checked: a real microphone, or iOS Safari, where dictation needs https.

## 2026-11-14: taste boards

A taste tile on Home now opens a board (`/t/{type}`), not the plain saves list: two staggered columns of reel thumbnails, each with a short title and one line of facts. The saves list stays as the search screen and is one tap away from the board.

- `GET /api/tastes/{type}` (`server/realize/board.py`), no model call. The facts line is built from fields the reel gave ("20 min · 7 ingredients", "Lisbon · 2 places", "6 products"); a save with none shows who posted it. Times of 90 minutes or more read as hours.
- Filter chips are the tags the board's saves carry: shared tags first, never a tag that is on every save, never generic hashtags (`board.DULL_TAGS`).
- Marks on a card: "New" for the last day, a pen for a save with your note.
- Reel thumbnails all have one shape, so the board crops them to five heights chosen from the save's id (stable between visits), and fills the shorter column first so reading order stays left to right.

101 unit tests pass (2 new). Checked in headless Chrome at 390x844 on a demo account: Food board with 3 saves, a chip narrowing it to 1, a board for another type, and an unknown type.

## 2026-11-14: Actions and "Ready for you"

The owner renamed Plans to Actions (the route stays `/plans`) and asked for plans built from several saves at once.

- **Bundles** (`server/realize/bundles.py`, `bundles` collection): per type (recipes, workouts, places, products), up to 4 of the newest saves that aren't on the calendar yet. Code decides the grouping, every time (the same `find_free_slot` a single plan uses, each one reserving its slot for the next) and the merged grocery list (same item from two recipes is one line; quantities add when units match, both amounts kept when they don't). A bundle is keyed by a signature of its saves, so it is rebuilt only when they change, and "Not now" holds until they do.
- **Gemini writes words only**, once per bundle, after the response: a name, one line, a note per save, an order, and for products the one the reels back most. `checked_polish` keeps the order a permutation of the real saves, drops notes for ids that aren't there, and drops a product pick that no reel names. Without the model the bundle still shows with plain code-made words.
- **Start** accepts one plan per save through the existing `propose_plans` and `planops.accept`, one at a time, so they never collide. Nothing is added before the tap.
- **API:** `GET /api/bundles` (grouping runs here, no model wait), `GET /api/bundles/{id}`, `POST .../start`, `POST .../dismiss`.
- **Screens:** Actions has Ready for you, Waiting on you, Coming up, Started, Done. Home has a Ready for you rail. A taste board shows a strip when that taste has a ready plan. A plan's page (`/b/{id}`) has the reels with their times, one Start button, and either the merged grocery list (ticks, progress bar, the recipes each item is for) or products side by side.

Measured on a demo account: listing 0.8 to 0.9 s, the model's words arrive within about 9 s. Start on a 2-workout bundle added both (Mon 7 am, Wed 7 am). 104 unit tests pass (3 new). Checked in headless Chrome at 390x844 with no console or network errors.

Found while testing, not changed: a sample save is planned in a thread inside the API, so a dev reload (`--reload`) while one is planning leaves it in "planning" with no job to resume it. Production doesn't reload; locally, `demo.plan_sample` finishes it.

## 2026-11-14: reanalyze and re-sort

The user asked for a small button at the end of each reel that reanalyzes and re-sorts it. `POST /api/saves/{id}/reanalyze` queues the video pass again. A type or sub-category set by hand is let go so the new reading can re-file the reel; the note and an accepted plan stay; a plan still waiting follows a new type (the video pass already did that). It refuses while a reading is queued or running, and is limited to 5 per 10 minutes per account, because each one is a paid video pass. Checked live: a recipe hand-filed as a tip with a wrong label came back as Food > Dessert in 15.7 s. The first run found that a second tap during the queued state started a second pass; the guard now counts "planned" and a pending job as busy.

## 2026-11-14: deliverables

The user asked for the chat to suggest something to export at the end, "such as an itinerary that I can message someone", and to think of others. Decisions:

- **Nine kinds, each tied to what the reel has:** itinerary (place or event, from the trip plan), invite (an event, or any accepted plan with a time), grocery list and recipe (recipe), workout, shortlist (product), places list, key points (tip), and notes from the chat (the questions and answers of one discussion).
- **Built in code, no model call.** Each is assembled from stored data: the video pass's fields, the accepted plan, the sourced trip plan, the discussion. So it is instant and free, and it can't say more than the reel, the plan or the trip already said. `server/realize/deliverables.py`.
- **A message and a page.** Each deliverable is plain text that reads well in a text thread, ending with a link to a public page (`/d/{id}?t=token`) that shows the same content to someone with no account. Map links stay on the page so the message stays short. Remaking one keeps its link.
- **The itinerary needs the trip plan.** Until one is built, the option says so (`needs: "trip"`), and the chat builds the trip first when that chip is tapped. That is the only paid step.
- **Option order:** what is about the reel first, then an invite for a plan with a time, then chat notes.
- **No new dependencies.**

Checked live on a demo account, 14 of 14: a grocery list by aisle, an event invite, the itinerary refused before the trip existed and made after it (five timed stops with prices, hours, forecast and the sources named), the public data opening with the token and no key, a wrong token and another account refused. 117 unit tests pass (15 new).

## 2026-11-14: Home leads with what's ready, New chat, the orb's tap

- **Home order:** Ready for you, then Your tastes, then Recently saved. People open the app for what's ready, not for the list of what they saved.
- **New since last time.** `server/realize/visits.py` keeps `visits.last` and `visits.prev` on the user (a visit ends after 30 minutes of no activity, counted when Home loads `/api/tastes`). Each taste tile shows a badge with the saves added since the previous visit; opening that taste's board clears its badge (`visits.taste_seen`). Kept on the server so a phone and a laptop agree.
- **The greeting says what was done for them:** "New since last time: 3 recipes, 4 workouts and 3 product picks", or "This week: ..." when nothing is new. Largest first, at most three kinds, "Just vibes" left out.
- **Ask has New chat**, which clears the conversation (it lived only in memory, so nothing on the server changes).
- **Tapping the orb lights it** the way holding it does (a short scale and halo), then settles; a hold still opens the voice layer.

110 unit tests pass (2 new; the commit message for this entry said 112, which was wrong). Checked in headless Chrome at 390x844 with the account's last visit moved back 90 minutes: badges on four tastes, the recap line, the Food badge gone after opening Food, the orb's tap state, New chat emptying Ask.

## 2026-11-14: recipes are for cooking now, nutrition, price research

The owner's calls: a saved recipe is opened when someone wants to cook it, so it should not be asked for a calendar slot; the demo leads with travel, recipes (with nutrition) and shopping; price research runs only when asked and must avoid sketchy sites.

- **Recipes.** The Reel page shows a "Ready when you are" card (time, ingredients, steps) with Start cooking and Shopping list, in place of the plan card. A recipe already on the calendar keeps its plan card so it can still be moved or marked done. Recipes are left out of "Waiting on you" (`/api/plans`). The planner and the Shortcut are unchanged for now.
- **Cook mode:** one step at a time in large type, an ingredient checklist first, Back and Next (arrow keys too), the screen kept awake where the browser allows. `/s/{id}?cook=1` opens it directly.
- **Dinner bundles** are no longer scheduled: "Start now" opens the first recipe in cook mode, "Shop the list" goes to the merged list, each dinner has Cook. Workout and place bundles still start on free slots (`bundles.SCHEDULED`).
- **Nutrition** (`server/realize/nutrition.py`, `GET /api/saves/{id}/nutrition`): Gemini estimates each ingredient line for its stated amount; code drops impossible values and made-up line numbers, refuses to show anything when fewer than 60% of lines are usable, sums, divides by servings, and recomputes calories from the macros when the two disagree by more than 40%. Kept on the save until the ingredients change. Shown per serving with a calorie split bar and labelled as an estimate. Measured: 6.0 s the first time, 0.08 s after.
- **Price research** (`server/realize/shop.py`, `GET`/`POST /api/saves/{id}/shop`): only on a tap. A search-grounded call (the trip code's `research`) for prices at major US stores, brand sites and review sites, then a structured pass. Code keeps a price only when its source page is on the store or review allowlist or is the brand's own site, and a dollar amount can be read. The store name comes from the source page when that page is a store's. Demo accounts get 3. Measured on the curling irons reel: 12 s, 5 prices kept (Target, Walmart, Kohl's), 3 dropped as unknown sites.
- **Badges** count the last 24 hours when there is no earlier visit, so a new account sees them.

114 unit tests pass (4 new). Checked in headless Chrome at 390x844: recipe page with cook card and nutrition, cook mode pages, price research results, the dinners plan with Start now. No console or network errors.

## 2026-11-14: interests and hobbies are the folders
- **Owner asked for it directly:** "i want each of the interest or hobbies to just be used as created categories". Starters are no longer invented by Gemini; each interest and hobby is kept as written and Gemini only picks its type. One that fits no type is left out. Checked live: Baking > Food, Travel > Places, Broadway musicals and Comedy > Events, Strength training and Pickleball > Fitness.

## 2026-11-14: intro asks what you like first; no gender question
- **Gender question removed.** Nothing read the answer: `profile.taste_lines` (the only profile text sent to Gemini) skips it, and no server or web code read `profile.identity`. Asking something personal before the app shows any value makes people quit, so it went, server and client. An `identity` stored earlier is never read and is dropped the next time the intro is finished; a client that still sends one has it ignored.
- **New order:** interests, hobbies (they become the folders), then "A bit about you": age range (optional, feeds the planner's "ABOUT THE USER" line) and ethnicity (optional, stored only, the screen says it isn't used). The progress bar follows the step list.
- **Only new accounts are sent to the intro:** not onboarded, not demo, and no saves yet (`me.counts.saves === 0` in `web/components/shell.tsx`). Accounts that already have saves keep using the app; Settings still has "Redo the intro".
- Checked at 390 px on a throwaway account (deleted afterwards): /home sends it to /welcome, each of the 4 steps renders, and a demo key opening /home stays on /home.

## 2026-11-14: intro screens and starter sub-categories

The user asked for intro pages like a video app's onboarding (how you identify, age, ethnicity, hobbies, skills, interests) and for categories the model makes, with a new one whenever a saved reel fits none. Decisions:

- **One question per screen, three sections:** "Tell us about yourself" (how you identify, age, ethnicity), "Choose what you like" (interest chips plus your own), "Your hobbies" (chips plus your own). A first version also asked "What are you good at?"; the owner cut it to keep the intro short. A progress bar, Back and Skip on every screen; single choices move on by themselves. `web/app/welcome/page.tsx`.
- **Gemini in two places.** While interests are picked, "More for you" adds more specific chips. At the end, Gemini proposes starter sub-categories inside each type, shown as "Your folders".
- **Built on the existing sub-categories, not a second system.** The owner asked for type first (Food) and sub-categories under it. A first version kept its own categories collection; it was dropped for `profile.starters`, which `subcats` offers to the model next to the labels in use. So the hierarchy, the library chips, Home's taste tiles and "File under" all work unchanged.
- **Identity and ethnicity never reach Gemini.** They are stored on the profile only, so filing follows what someone likes, not who they are.
- **Who sees it:** new accounts after signup, then `/setup` as before; existing real accounts once, on their next visit; demo accounts never. Settings has "Redo the intro".
- **No new dependencies.**

Checked live against Atlas with a throwaway account (deleted afterwards): the intro end to end at 390 px; Gemini made sentence-case starters in 6 types; six real sample reels were filed as Food > Weeknight dinners (2) and Food > Baking (2) from the starters, and Events > Theater and Events > Holiday events as new ones. The first run returned Title Case starters; the prompt now asks for sentence case, checked on two more runs. 127 unit tests pass (10 new).

## 2026-11-14: knowledge graph

The user asked for a knowledge graph that helps retrieval of the vector embeddings and a page where people see how their categories, sub-categories and interests relate. Decisions:

- **Built on what exists.** Types and sub-categories already form the hierarchy, and every save already has an embedding, so the graph is computed in code (`server/realize/graph.py`): sub-category centroids from the saves' embeddings, "related" edges between sub-categories, "likes" edges from intro interests. The only model call embeds interests once. This replaces the spec's phase 8 clustering idea, so scikit-learn is not added.
- **Relative edges, measured first.** On a temporary demo account holding the 16-reel sample library, labelled with `scripts.backfill_subcategories`, the median centroid-to-centroid cosine was 0.717 (10th percentile 0.667, 90th 0.803), and a fixed cutoff linked "Quick dinners" to "Bags & Luggage" (0.794). Mutual nearest neighbours (k = 2, floor 0.75) keep 7 pairs such as Desserts ~ Appetizers, Cardio ~ Strength and Staycation ~ Holiday exhibit, and drop that one. Interest links keep matches within 0.05 of the best one, which drops "Food and cooking" > "Hair care" (0.56 against a best of 0.642).
- **Retrieval, measured honestly.** `python -m scripts.eval_recall --user <temp account>`: hit@1 20/20 and hit@3 20/20 with `GRAPH_EXPAND=false` and with it on, so no regression, and no gain this set can show (it was already 20/20). A first expansion rule (neighbours with query cosine at least 0.55) added 10 results over 24 queries, several off topic ("something sweet to bring to a party" pulled in two dinners). Query cosine alone didn't separate good additions from bad ones, so neighbours now also need their sub-category's centroid to match the query within 0.03 of the anchor's; that left 1 addition over the same 24 queries (the chickpea question adds the other quick dinner). Expansion only fills empty slots after the direct hits. It is behind `GRAPH_EXPAND` so it can be turned off.
- **The page** is `/graph` ("How your saves connect"), linked from Home's "Your tastes". react-force-graph-2d is the dependency CLAUDE.md lists for this (1.29.2, pinned). The canvas has a text list of every connection under it, so the page works without the canvas.

Checked at 390 and 1440 px on that temporary account (deleted afterwards): the graph draws 41 nodes and 51 links, tapping a node on the canvas or in the list highlights its neighbours and opens its details with links to its reels. 136 unit tests pass (9 new in `server/tests/test_graph.py`).

## 2026-11-15: pressing fixes after the design review

- **Demo limit.** "Try the demo" allowed 10 sessions an hour per address. A venue's Wi-Fi puts a room behind one address, and locally the web app's `/api` pass-through made every phone look like 127.0.0.1. The count is now `DEMO_SESSIONS_PER_HOUR` (default 60; a session costs no model call). The local API start trusts forwarded addresses from 127.0.0.1 only. Next's rewrite does not send the visitor's address, so locally all phones still share one count; behind Caddy each visitor is counted on their own.
- **One calorie number per recipe.** The reel page estimated 386 kcal for the curry while the chat quoted the 484 Budget Bytes publishes. Published numbers the chat finds are kept on the save (`published_nutrition`) and the page shows them with their source. With none published, the chat answers with the page's estimate instead of a second estimate. Nine existing saves got their published numbers from earlier chats.
- **Actions page.** Events whose dates have passed leave "Waiting on you" for a collapsed Missed group (`actions.is_missed`, the same rule that writes "It's passed"). "Just vibes" reads "Save without a plan" on the web, which is what it does; the Shortcut menu keeps the old words. Only the first waiting card keeps the dark button.
- **Samples rebuilt** with the live models; see BLOCKERS.md for the measured numbers.

## 2026-11-15: saved chats

The owner asked for a better chat flow, perhaps with saved chats. Before: Ask (the orb) lived in memory only, so "New chat" or a reload lost it, and reel chats were kept but folded away in a collapsed "Discussions" box on each reel. Decisions:

- **One collection, two kinds.** Ask chats go in `discussions` with `save_id: null`; each answered turn is kept with its reels (the cards as shown) and next questions. The stream's last line is `{"type": "saved", "chat_id"}`, and the client sends `chat_id` to continue; the server then uses the chat's own messages as history. A turn that fails is not kept.
- **Every chat in one list.** `GET /api/chats` returns Ask and reel chats together, newest first (index `user_id, updated_at`). The Ask page's start screen shows "Your chats" under the idea chips; a row reopens an Ask chat in place or a reel chat over its reel (`/s/<id>?chat=`). A question handed over from Home or the orb starts its own chat.
- **Reel chats are easy to pick up.** The reel page shows "Your chats about this" open, three at a time. The chat's start screen offers "Pick up where you left off", and an open chat has New chat and Delete in its header. Ask chats can be deleted too.
- **Next questions in reel chats.** The reel chat's answer now asks the model for up to 2 follow-ups in the same call (no extra request); code keeps them short, distinct and in sentence case. Web and nutrition answers have none.

Checked live on a fresh demo session at 390 px (`scratchpad/chats_look.py`): one Ask question was kept and listed, reopened with its turn and 2 reel tiles; one reel question came back with 2 follow-ups, showed under "Pick up where you left off", on the reel page and in the Ask list; no page errors. `pytest`: 165 passed.

## 2026-11-15: web search when you ask for it

The owner asked for the chat to go to the internet when you explicitly ask for a web search.

- **What counts as asking.** `server/realize/websearch.py` matches plain requests: "search the web for", "look it up online", "google how", "web search", "check online", "what does the internet say". Questions like "I bought it online" or "is it open on Mondays" don't count. The words are taken off the front of the search.
- **Reel chat.** Such a question skips the reel-only answer and goes straight to the sourced web answer about that reel (its title is added to the search when missing). With no linkable source it says so instead of guessing.
- **Ask.** Such a question gets a Google Search grounded answer instead of a search of the saves; the closest 3 saves go along as context so "the place I saved" means something. The answer shows its sources and is kept in the chat with them.
- **One helper.** Both use `websearch.grounded`: [n] markers where the model cited, Google redirect links resolved to the real pages, and text that comes back twice kept once (seen live: a reel answer printed its sentence twice).

Checked live on fresh demo sessions: Ask "Search the web for whether the NYBG holiday train show needs timed tickets" answered with 2 nybg.org sources, kept them when reopened; a plain Ask question still searched the saves; a reel chat "look it up online: is the pool open in December?" answered with 3 sources (the hotel's pool page first). pytest: 170 passed.

## 2026-11-15: Home for doing, Folders for browsing

The owner asked to move the categories off Home, keep action items on Home, and make the third tab the folders; Home and Actions had shown the same reels. Each tab now has one job (DESIGN.md 4, 7.4, 7.5):

- **Home** (`/home`; `/plans` redirects): Save a reel; Just saved; "Did you do it?"; the week strip with the chosen day's plans or its free time; Waiting on you, Ready for you, Missed; the shopping list; Started, Done this week, After this week.
- **`GET /api/week`** (server/realize/week.py), all in code: plan counts per day for the rolling week; the first free slot per day from the person's settings (`slots.find_free_slot`) with up to two saves of that kind that have no time yet (waiting ones first, then ones saved without a plan); and the ingredients of this week's planned recipes merged into one list (same units add up, "count" reads as a plain number, sorted by name). "Add to Thu" confirms with that slot's `start_local`, the path "Change time" already uses, so no model call.
- **Folders** (`/library`): the remember card, Recently saved, Your folders, See how they connect, Ask about your saves, All saves; search as before. Adding a reel from Folders stays on Folders.
- **Tab bar:** Home, the Ask orb, Folders (new folder icon). Links that said Actions now say Home; the folder board and the graph go back to Folders.
- **Why ringed days can be few on a demo account:** a free slot only shows when a save of that kind has no time yet; the demo's two recipes are already planned, so its weekday evenings show nothing to fill.

Checked on the branch's own servers (API 8010, web 3010, worktree on branch home-folders): pytest 173 passed; the live suites 23/23, 22/22 and 8/8; Home at 390x844 and 375x667 with one Add to tomorrow and its Undo, the list ticking, and /plans landing on Home; 12 screens opened with no page errors or horizontal overflow; the web-design-guidelines pass found one issue (the Add button's spoken name didn't contain its visible words), fixed.
