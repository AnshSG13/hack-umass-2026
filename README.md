# Realize

Every save becomes a plan.

People save reels on autopilot and rarely act on them. Realize turns a saved reel into one small, concrete plan: share a reel from Instagram, an agent reads it, checks your week and asks "Cook Thu 6:30 pm + 3 groceries?". You confirm with one tap. Nothing is added to your calendar or reminders without that tap. Later it asks whether you did it.

- Demo video: TODO
- Live demo: TODO (the landing page has a "Try the demo" button that needs no login)
- Real saved-count stat: TODO (count from the production database before the pitch; no number is quoted until then)

Built at HackUMass XIV.

## What it does

Realize is a web app you add to your iPhone's Home Screen. An iOS Shortcut is an optional extra for saving straight from Instagram's share sheet.

1. **Save.** Copy a reel's link in Instagram, open Realize, tap Save and paste. No Instagram API and no Instagram login for the user. (With the Shortcut, Share then Realize sends the link in one step.)
2. **Plan.** A planner agent reads the caption and thumbnail, works out what the reel is (recipe, event, place, workout, product, tip or just vibes), looks at your week and proposes a plan with real times from your free slots. It shows up as a ticket.
3. **Confirm.** One tap adds it to your week. The ticket then offers "Add to Apple Calendar" (an .ics file with alerts) and "Add to Google Calendar". The Shortcut path writes a native Calendar event and Reminders instead.
4. **Watch.** In the background a second pass watches the actual video with Gemini: full transcript with timestamps, on-screen text, ingredients, steps. Facts that aren't in the video or caption are dropped or flagged.
5. **Find.** Library searches what was said and shown in the video, not just the caption. Ask is a chat over your saves that answers with cards and says so when nothing matches.

The interface is a ticket: the top half is the reel, the stub below the perforation is the plan. Adding punches it. Done tears the stub off.

## Architecture

```
iPhone Shortcut ── POST /api/save (waits up to 20 s for the plan) ──┐
Browser (Next.js pages) ── /api/* ──────────────────────────────────┤
                                                                    ▼
                  Caddy (HTTPS, one domain)   /api/*  → api:8000  (FastAPI)
                                              /*      → web:3000  (Next.js)

api ── reads/writes ──► MongoDB Atlas ◄── claims jobs ── worker (Python)
                                                         yt-dlp → public Instagram reel
                                                         Gemini: planner, video, embeddings
```

- Atlas is the only shared state and also the job queue. The API and the worker never call each other.
- Only the worker contacts Instagram. If Instagram blocks one machine, run the same worker somewhere else; nothing else changes.
- The model decides, code executes: the planner picks the type, the fields and which offered slot to use. Code computes free slots, validates dates and builds every label, event and reminder.
- The demo path (sample reels) needs neither Instagram nor the worker.

`SPEC.md` is the full behavior spec, `DESIGN.md` the UI spec, `BUILD_LOG.md` the decisions made while building, `BLOCKERS.md` what is still open.

## Repository

```
server/realize/        FastAPI app, worker, planner, enrichment, search, Ask
server/scripts/        create_indexes, create_user, build_samples, simulate_shortcut,
                       run_fixtures, eval_recall, reset_demo, check_models
server/tests/          unit tests for the pure logic
web/                   Next.js app (App Router, TypeScript, Tailwind)
fixtures/              real public reels and search queries used for tests and the demo
shortcut/README.md     how to build the iOS Shortcut
eval/results.md        search recall, written by scripts/eval_recall.py
docs/archive/, prototype/   earlier specs, mockups and the first share prototype (history only)
```

## Run it locally

You need Python 3.12 or newer, Node 22 or newer, a MongoDB Atlas cluster (the free M0 tier works) and a Gemini API key.

1. Copy `.env.example` to `.env` at the repo root and fill in `MONGODB_URI` and `GEMINI_API_KEY`.
2. Server setup (Windows PowerShell shown; on macOS or Linux use `source .venv/bin/activate`):
   ```
   cd server
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   python -m scripts.check_models
   python -m scripts.create_indexes
   pytest
   ```
3. Three terminals:
   ```
   cd server; .\.venv\Scripts\Activate.ps1; uvicorn realize.api.main:app --reload --port 8000
   cd server; .\.venv\Scripts\Activate.ps1; python -m realize.worker
   cd web; npm install; npm run dev
   ```
4. Open http://localhost:3000. "Use it for real" creates an account and shows your key. To fill the demo, run `python -m scripts.build_samples` once (it needs Instagram access and Gemini quota).
5. Test the Shortcut contract without a phone:
   ```
   python -m scripts.simulate_shortcut --url https://www.instagram.com/reel/DfYi19kRNT0/ --base http://localhost:3000
   ```
6. On a real iPhone on the same Wi-Fi: build and serve the web app on the laptop's network address, and start the API with `PUBLIC_BASE_URL` set to that address so links in tickets open on the phone.
   ```
   cd web && npm run build && npx next start -H 0.0.0.0 -p 3100
   ```
   Open `http://<laptop address>:3100/setup` in Safari, create an account, then Share, Add to Home Screen. Plain http works for everything except the one-tap "Paste the link I copied" button, which needs https; the paste box works either way.
7. For https or a phone on another network, run `cloudflared tunnel --url http://localhost:3100` and set `PUBLIC_BASE_URL` to the tunnel address. The optional Shortcut is in `shortcut/README.md`.

`/save?url=<reel link>` saves a link handed over in the address, for a bookmark or a one-step Shortcut.

`PLANNER_MODE=fake` skips Gemini and Instagram and plans a canned recipe with real slots. It is for contract tests.

**Gemini quota.** A free-tier key allows very few requests per day per model (see `BLOCKERS.md`). For anything beyond a handful of saves, use a key with billing on, or list other models in `GEMINI_MODEL_FAST_FALLBACKS` and `GEMINI_MODEL_VIDEO_FALLBACKS`. Never list a Lite model for the fast (planner and Ask) role.

## Deploy (Vultr VPS, Docker Compose, Caddy)

`deploy/vultr.py` does the whole thing from your laptop with Python and the `ssh` that ships with Windows. It needs no packages.

1. Get an API key from the Vultr dashboard (Account, API), allow your IP there, and set `VULTR_API_KEY` in your shell or in `.env`. You also need an SSH key (`ssh-keygen -t ed25519` if `~/.ssh/id_ed25519.pub` doesn't exist).
2. `python deploy/vultr.py provision` creates an Ubuntu 24.04 VPS (`vc2-2c-4gb` in `ewr` by default; change them with `--plan` and `--region`). It uploads your SSH key, and `deploy/cloud-init.yaml` installs Docker, opens only ports 22, 80 and 443, and adds 2 GB of swap for the Next.js build. The IP is saved to `deploy/.host`. Running it again reuses the existing `realize` instance.
3. By hand: add a DNS A record from your domain to that IP, and add `<ip>/32` under Atlas Network Access.
4. In `.env`, set `DOMAIN=<your domain>` and `PUBLIC_BASE_URL=https://<your domain>`. If you use Instagram cookies from a throwaway account, save them as `secrets/instagram_cookies.txt` and set `INSTAGRAM_COOKIES_PATH=/secrets/instagram_cookies.txt`.
5. `python deploy/vultr.py deploy --init` checks `.env`, uploads the last commit (`git archive HEAD`), `.env` and `secrets/` to `/opt/realize`, runs `docker compose up -d --build`, creates the Atlas indexes, builds the demo samples (skip with `--skip-samples`), and waits for `https://<domain>/api/health`. Caddy gets the HTTPS certificate on its own.
6. After that, every update is `python deploy/vultr.py deploy`. `status` shows health (`--containers` adds `docker compose ps`), `logs [api|worker|web|caddy]` shows logs, and `ssh` prints the login command.
5. If Instagram starts blocking the server's IP: `docker compose stop worker` and run `python -m realize.worker` on a laptop with the same `.env`. The API, the web app and the Shortcut don't change.
6. yt-dlp is unpinned on purpose: `docker compose build --no-cache worker` picks up Instagram fixes.

## How accuracy is measured

- **Search recall.** `python -m scripts.eval_recall` loads every reel from the sample cache into a temporary account, runs each query in `fixtures/queries.csv` through the same hybrid search the app uses, and writes hit@1 and hit@3 with the per-query ranks to [`eval/results.md`](eval/results.md). Several queries use phrases that are only spoken in the video, never written in the caption. The set is small; read it as a smoke test.
- **Grounding.** After Gemini watches a video, every entity it returns is checked against the caption, the transcript and the on-screen text (`server/realize/enrich.py`, `ground`). Unsupported entities are dropped; place and product names that can't be found are kept but shown as "Not found in the video. Double check."
- **Dates and times are never written by the model.** Slots, reminder times, labels and calendar entries come from `server/realize/slots.py` and `server/realize/actions.py`, covered by `server/tests/test_pure.py`.
- **The Shortcut contract.** `python -m scripts.run_fixtures` pushes every reel in `fixtures/reels.csv` through save, confirm and a second share, checks types and menus, and prints the median time from save to proposal next to `PROPOSAL_WAIT_SECONDS`.

No accuracy number appears in this README. The measured ones live in `eval/results.md` and `BUILD_LOG.md`, next to the command that produced them.

## Prize notes

### Best use of Gemini
- Planner agent with manual function calling on the Interactions API, history resent unchanged so thought signatures round-trip: `server/realize/planner.py`, loop in `server/realize/gemini.py` (`run_tool_loop`).
- Video understanding through the File API with structured output (transcript with timestamps, on-screen text, typed fields): `server/realize/enrich.py`. Uploaded files are deleted after every run.
- Embeddings (`gemini-embedding-001`, 768 dimensions, normalized) for hybrid search: `server/realize/gemini.py` (`embed`), `server/realize/search.py`.
- Ask, a second agent over the user's saves that streams its steps: `server/realize/ask.py`.

### Best use of MongoDB Atlas
- Atlas is the database, the job queue and the search engine. Atomic job leases with `find_one_and_update`: `server/realize/jobs.py`.
- Atlas Vector Search plus Atlas Search fused with `$rankFusion`, with a reciprocal rank fusion fallback in code: `server/realize/search.py`. Index definitions: `server/scripts/create_indexes.py`.
- TTL indexes delete demo accounts and finished jobs on their own. Thumbnails are stored in Atlas, so there is no object storage to run.

### Best agentic hack
- The planner has tools (`search_saves`, `find_free_slot`, `propose_plan`) and every tool call is recorded as a step the user can read ("Checking your week") or expand into raw arguments and results: `server/realize/runs.py`, `web/components` (agent trace).
- The agent proposes; it never acts. Every calendar entry needs a tap, and the plan the agent wrote is validated and completed by code before the user sees it.
- When the model is unavailable or slow, a deterministic fallback still produces a ticket: `fallback_plan` and `cached_plan_fallback` in `server/realize/planner.py`.

### Best UI/UX
- One object, the ticket, carries a save from "saved" to "planned" to "done": `DESIGN.md`, `web/components` (ticket).
- Three motions only (print, punch, tear), all tied to real events, all with reduced-motion versions.
- Accessibility floors in `DESIGN.md` section 10: 44 px targets, visible focus, status never by color alone, transcripts on every enriched reel.

### Most impactful AI hack
- The app's job is to get people to do the thing they saved, then ask whether they did. Follow-ups, "Done this week" and the plan page (`/p/[id]`) exist for that loop.
- Transcripts and on-screen text make reels searchable and readable for deaf and hard-of-hearing users.

### Vultr
- One VPS runs the API, the worker, the web app and Caddy from `docker-compose.yml` and `Caddyfile`. The worker is the only part that can be moved off the VPS, and it moves without any other change.

## Privacy and limits

- The Shortcut sends only the reel's link. Realize reads public reels with yt-dlp; private reels are saved but can't be read.
- Videos are deleted from disk and from Gemini's file storage right after processing. Every save links back to the creator's post.
- Keys are random, shown once and stored as a hash. There is no password; the key is the account.
- iPhone only for sharing (Android users can paste links in the web app). Instagram only.
