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
