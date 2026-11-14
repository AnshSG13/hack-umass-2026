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
