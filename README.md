# Realize

Every save becomes a plan.

People save reels on autopilot and rarely act on them. Realize turns a saved reel into one small, concrete plan: share a reel from Instagram, an agent reads it, checks your week and asks "Cook Thu 6:30 pm + 3 groceries?". You confirm with one tap. Nothing is added to your calendar or reminders without that tap. Later it asks whether you did it.

- Demo video: TODO
- Live: https://reelize.boston (Vultr). The landing page has a "Try the demo" button that needs no login. On an iPhone, see [Use it on your iPhone](#use-it-on-your-iphone).
- Real saved-count stat: TODO (count from the production database before the pitch; no number is quoted until then)

Built at HackUMass XIV.

## What it does

Realize is a web app you add to your iPhone's Home Screen. An iOS Shortcut is an optional extra for saving straight from Instagram's share sheet.

1. **Save.** Copy a reel's link in Instagram, open Realize, tap Save and paste. No Instagram API and no Instagram login for the user. (With the Shortcut, Share then Realize sends the link in one step.)
2. **Plan.** A planner agent reads the caption and thumbnail, works out what the reel is (recipe, event, place, workout, product, tip or just vibes), files it under a sub-category ("Food > Dessert"), looks at your week and proposes one action. It shows up as a ticket.
3. **Act.** The action is what the reel is for, not just a reminder: a recipe opens cook mode, a product runs price research, a place or event gets a trip plan, and only a reel tied to a date gets a calendar slot. One tap confirms it. Calendar entries come as "Add to Apple Calendar" (an .ics file with alerts) or "Add to Google Calendar"; the Shortcut path writes a native Calendar event and Reminders instead.
4. **Watch.** In the background a second pass watches the actual video with Gemini: full transcript with timestamps, on-screen text, ingredients, steps. Facts that aren't in the video or caption are dropped or flagged.
5. **Find and ask.** Library searches what was said and shown in the video, not just the caption. Ask is a chat over all your saves that streams its answer with source reels and up to two next questions, and you can hold the orb to ask out loud. Every chat is saved and listed on the Ask page.

What else is in the app:

- **Home.** "Ready for you" first, then your tastes (one per type) with badges for what is new since your last visit. A taste opens as a board of reel cards with filter chips.
- **Actions** (formerly Plans). "Waiting on you", "Done this week", and a collapsed "Missed" group for events that already passed. **Ready for you** bundles several saves into one thing to start: this week's dinners with one merged grocery list, a training week, outings, a side-by-side product comparison.
- **Reel page.** The ticket, transcript and details, plus:
  - **Cook mode** for recipes, one step at a time with the screen kept awake, a shopping list, and nutrition per serving (Gemini estimates each ingredient line, code checks and adds them up and labels it an estimate).
  - **Price research** for products, on a tap: web search, and code keeps a price only when it can read a dollar amount and the page passes the store check.
  - **Trip plans** for places and events: a day-by-day itinerary with sourced stops, prices and opening times, a real forecast from Open-Meteo, and per-day calendar files. Moving the dates can always be undone.
  - **Reel chat**: a saved chat about that one reel that can search the web when the reel doesn't say (macros, for example) and cites the second of the video it used.
  - **Deliverables**: something finished to send, made from the reel (an itinerary, a grocery list, an invite, a recipe, a workout, a shortlist, key points), as a text message plus a public page that opens without an account.
  - **Reanalyze**, to read a reel again and re-sort it.
- **Knowledge graph** (`/graph`). How your types, sub-categories, saves and interests connect. Ask uses it to find related saves.
- **Accounts.** Sign up with email and password, or with a key and no password. An email account can get a Shortcut key in one tap. New accounts get a short intro that asks for interests and hobbies first; each one becomes a starter sub-category.
- **Demo.** "Try the demo" opens a guided story on prebuilt sample reels, so the first open never waits, then a throwaway account with the samples in it. Demo use is limited to 60 an hour per visitor address.

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
server/realize/        FastAPI app, worker, planner, enrichment, search, Ask, bundles,
                       trips, deliverables, reel chats, knowledge graph, accounts
server/scripts/        create_indexes, create_user, build_samples, simulate_shortcut,
                       run_fixtures, eval_recall, reset_demo, check_models
server/tests/          unit tests for the pure logic
web/                   Next.js app (App Router, TypeScript, Tailwind)
fixtures/              real public reels and search queries used for tests and the demo
shortcut/README.md     how to build the iOS Shortcut
eval/results.md        search recall, written by scripts/eval_recall.py
deploy/                vultr.py (provision, deploy, status, logs) and cloud-init.yaml
.github/workflows/     deploy-vultr.yml: every push to main redeploys the server
docker-compose.yml, Caddyfile   what runs on the server
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
   cd server; .\.venv\Scripts\Activate.ps1; uvicorn realize.api.main:app --reload --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1
   cd server; .\.venv\Scripts\Activate.ps1; python -m realize.worker
   cd web; npm install; npm run dev
   ```
   The web app passes `/api` calls on to the API, so without `--proxy-headers` every visitor looks like 127.0.0.1 and they all share one demo limit. Trusting only 127.0.0.1 keeps anyone else from setting their own address.
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

## Use it on your iPhone

The live site is **https://reelize.boston**. The old address, https://140-82-6-164.sslip.io, still opens the same site.

1. **Open it in Safari** (only Safari can add a web app to the Home Screen): https://reelize.boston/setup
2. **Make an account.** Sign up with email and password, or create a key-only account. Accounts from a laptop setup don't carry over: the server has its own database.
3. **Add it to your Home Screen.** Tap Share, then **Add to Home Screen**. It opens full screen like an app. If you added it before from a laptop address (`http://10.0.0...`), delete that icon first.
4. **Save a reel.** In Instagram, open a reel, tap Share, **Copy link**. Open Realize, tap Save and paste (or tap "Paste the link I copied"). The plan appears in a few seconds and the video is read in the background.

### Optional: save straight from Instagram's share menu

Copy your key first: on `/setup` (or Settings for an email account) tap **Copy key**. It starts with `rl_`.

In the Shortcuts app, tap **+**, add **Get Contents of URL**, and fill it in:

```
URL            https://reelize.boston/api/save
Method         POST
Headers
   Authorization   Bearer rl_your_key      (the word Bearer, a space, then the key)
Request Body   JSON
   input   (Text)    -> Shortcut Input      (tap the field and pick the blue variable)
   source  (Text)    -> shortcut
   wait    (Number)  -> 0
```

Tap the ⓘ button, turn on **Show in Share Sheet**, set it to receive **URLs** and **Text**, and name it **Realize**. In Instagram: reel, Share, **Share to…** or **More**, **Realize**.

If you already built the Shortcut against a laptop, change only two things: the URL (it must start with `https://` and have no `:3200` or other port) and the key after `Bearer` (a laptop key doesn't exist on the server).

**If it doesn't work:**
- Add **Show Result** as the last action to see the server's answer. "Your Realize key doesn't work" means the key; anything about the link means the input field.
- "The network connection was lost": open https://reelize.boston/api/health in Safari on the phone. If it shows `"ok":true`, the phone can reach the server; check that the Shortcut's URL is exactly the one above and that no other action in the Shortcut sets a different address. Toggling Airplane Mode clears connections iOS kept from before.
- Every save that reaches the server is logged as `save attempt: source=shortcut key=ok link=ok` (or which part was wrong): `python deploy/vultr.py logs api`.

The other Shortcut versions (one that opens the app instead, and the full one with a menu, Calendar and Reminders) are in `shortcut/README.md`; use `https://reelize.boston` as their address.

### At a stand: one QR code, no keys

Open **https://reelize.boston/stand** on a laptop or tablet at the table. It shows a large QR code and three steps. A visitor:

1. scans it with the iPhone camera, which opens sign up in Safari, and makes an account (the intro follows, then `/setup`);
2. taps **Add the Shortcut** at the top of `/setup`, then **Add Shortcut**. There is nothing to type;
3. in Instagram, taps Share on a reel, then **Realize**. Safari opens `/save?url=<reel>` and the reel is saved to the account signed in there.

The Shortcut has one action, **Open URLs** with `https://reelize.boston/save?url=` followed by **Shortcut Input**, so it carries no key and one iCloud link works for everyone. To make that link: build the Shortcut once (Show in Share Sheet on, receives URLs and Text, named Realize), then long-press it, **Share**, **Copy iCloud Link**. Put the link in the server's `.env` as `QUICK_SHORTCUT_URL=` and run `python deploy/vultr.py deploy` once from a laptop. Until it is set, `/setup` shows the build-it-yourself steps instead of the button.

Visitors should stay in Safari: a Home Screen web app keeps its own sign in on iOS, and the Shortcut always opens Safari.

**Saving in the background instead.** A second Shortcut keeps the visitor's own key, so a shared reel saves without Safari opening, and still nobody types anything. With `QUICK_SHORTCUT_KEYED=true`, **Add the Shortcut** copies the visitor's key before it opens the iCloud link. On its first run the Shortcut reads the key from the clipboard and keeps it in a file. When it has no key, or its key stops working, it opens `/connect`, which saves the reel and hands the key over in one tap. `shortcut/build_shortcut.py` writes this Shortcut, and it has to be signed once on a Mac: see "Build the key-saving Shortcut on a Mac" in `shortcut/README.md`.

## Deploy (Vultr VPS, Docker Compose, Caddy)

One Vultr VPS runs everything: Caddy for HTTPS on one domain, the FastAPI API, the worker and the Next.js app, from `docker-compose.yml`. Atlas stays hosted by MongoDB. `deploy/vultr.py` does the whole setup from a laptop with Python and the `ssh` that ships with Windows; it needs no packages.

### First time

1. Get an API key from the Vultr dashboard (Account, API), allow your IP there, and set `VULTR_API_KEY` in your shell or in `.env`. You also need an SSH key (`ssh-keygen -t ed25519` if `~/.ssh/id_ed25519.pub` doesn't exist).
2. `python deploy/vultr.py provision` creates an Ubuntu 24.04 VPS (`vc2-2c-4gb` in `ewr` by default; change them with `--plan` and `--region`). It uploads your SSH key, and `deploy/cloud-init.yaml` installs Docker, opens only ports 22, 80 and 443, turns on fail2ban, and adds 2 GB of swap for the Next.js build. The IP is saved to `deploy/.host`. Running it again reuses the existing `realize` instance.
3. Add `<ip>/32` under Atlas Network Access, in the project that holds the cluster in `MONGODB_URI`. For a domain, either add a DNS A record to the IP, or use `<ip with dashes>.sslip.io` with no DNS at all.
4. In `.env`, set `DOMAIN=<domain>` and `PUBLIC_BASE_URL=https://<domain>`. `EXTRA_DOMAINS` (optional, space separated) lists other names Caddy serves the same site on. If you use Instagram cookies from a throwaway account, save them as `secrets/instagram_cookies.txt` and set `INSTAGRAM_COOKIES_PATH=/secrets/instagram_cookies.txt`.
5. `python deploy/vultr.py deploy --init` checks `.env`, uploads the last commit (`git archive HEAD`), `.env` and `secrets/` to `/opt/realize`, runs `docker compose up -d --build`, creates the Atlas indexes, builds the demo samples and the demo story's ready-made answers (skip both with `--skip-samples`), and waits for `https://<domain>/api/health`. Caddy gets the certificate on its own.

### Deploy on every push to main

`.github/workflows/deploy-vultr.yml` runs `python deploy/vultr.py deploy --keep-remote-env` on every push to `main` (and from the Actions tab with "Run workflow"). It ships the pushed commit and rebuilds; the server keeps its own `.env` and `secrets/`, so the only secret in GitHub is an SSH key. The job fails if `/api/health` doesn't answer afterwards.

It needs two repository secrets (GitHub, Settings, Secrets and variables, Actions, New repository secret):

| Secret | Value |
|---|---|
| `VULTR_HOST` | the server's IP (`140.82.6.164`) |
| `VULTR_SSH_KEY` | the whole private key file of a deploy key, including the `BEGIN` and `END` lines |

Make the deploy key once with `ssh-keygen -t ed25519 -N "" -f ~/.ssh/realize_github_deploy`, append `realize_github_deploy.pub` to `/root/.ssh/authorized_keys` on the server, and paste the private file into `VULTR_SSH_KEY`. To change a setting on the server (a new Gemini key, say), edit `.env` locally and run `python deploy/vultr.py deploy` once from the laptop, which uploads it.

### Giving a teammate deploy access

The server only lets in SSH keys listed in its `/root/.ssh/authorized_keys`. A teammate makes a key once with `ssh-keygen -t ed25519` (it lands in `~/.ssh/id_ed25519`), sends the **public** half (`~/.ssh/id_ed25519.pub`, one line) to whoever already has access, and that person appends it on the server. The teammate also needs `deploy/.host` (one line, the server's IP; it isn't committed) or passes `--host <ip>` to every command. Repository secrets can only be set by a repository admin.

### Day to day

- Every deploy also creates any new Atlas indexes, so the server's database keeps up with the code.
- `python deploy/vultr.py deploy --story` builds the demo story's ready-made nutrition answer and trip plan on the server (about 6 Gemini calls). Run it once after a new server, or after the samples are rebuilt.
- To let the server fall back to another model when Gemini is rate-limited, add `GEMINI_MODEL_FAST_FALLBACKS` and `GEMINI_MODEL_VIDEO_FALLBACKS` (comma-separated model ids) to the server's `.env`, then run `python deploy/vultr.py deploy` once from a laptop so the `.env` is uploaded.

- `python deploy/vultr.py status` shows `/api/health` (`--containers` adds `docker compose ps`), `logs [api|worker|web|caddy]` shows logs, `ssh` prints the login command.
- The deploy script always logs in with one named key (`~/.ssh/id_ed25519`, or `REALIZE_SSH_KEY`) and stops on the first rejection, because fail2ban bans an IP after a few failed logins. If you get banned anyway, open the instance's **View Console** in Vultr and run `fail2ban-client set sshd unbanip <your ip>`.
- HTTP/3 is off in the `Caddyfile`: the iOS Shortcuts runner dropped HTTP/3 connections with "The network connection was lost".
- If Instagram starts blocking the server's IP: `docker compose stop worker` and run `python -m realize.worker` on a laptop with the same `.env`. The API, the web app and the Shortcut don't change.
- yt-dlp is unpinned on purpose: `docker compose build --no-cache worker` picks up Instagram fixes.

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
- One VPS runs the API, the worker, the web app and Caddy from `docker-compose.yml` and `Caddyfile`, live at https://reelize.boston. The worker is the only part that can be moved off the VPS, and it moves without any other change.
- Provisioned and deployed by `deploy/vultr.py` through the Vultr API with cloud-init, and redeployed by GitHub Actions on every push to `main`.

## Privacy and limits

- The Shortcut sends only the reel's link. Realize reads public reels with yt-dlp; private reels are saved but can't be read.
- Videos are deleted from disk and from Gemini's file storage right after processing. Every save links back to the creator's post.
- Keys and session tokens are random and stored as a hash; a key is shown once. Passwords are hashed with scrypt. A key-only account has no password: the key is the account.
- The intro's optional ethnicity answer is stored but never sent to Gemini.
- iPhone only for sharing (Android users can paste links in the web app). Instagram only.
