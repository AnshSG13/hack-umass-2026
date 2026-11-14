# Realize: build spec

Source of truth for behavior. DESIGN.md is the source of truth for UI. CLAUDE.md has the working rules.
Replaces docs/archive/SPEC-reel-brain.md and docs/archive/system-design-v1.md.
The product name comes from APP_NAME, so a rename is one change.

## 0. Changes from the Reel Brain spec
- Kept: Atlas as the only shared state and the job queue (atomic leases); a Python worker that is the only component talking to Instagram and runs on Vultr or a laptop; Gemini video via the File API; 768-dim normalized Gemini embeddings; hybrid search with $rankFusion plus a manual RRF fallback; dedupe per user and shortcode; failure reasons; videos deleted after processing; thumbnails stored in Atlas.
- Changed: every save gets a proposed plan the user confirms with one tap (was: plans only on request in chat). The Shortcut shows a menu and writes native Calendar events and Reminders (was: fire-and-forget plus Web Push). One Python backend instead of Next.js API routes plus Python. Bearer keys instead of Clerk. A no-login demo for judges. New `event` type. Ticket-stub design.
- Cut: TikTok, voice input, subcategories and centroid routing, Web Push, Clerk, suggestions and rediscover, linked-page fetching, cook mode, unit conversion, maps of places, stored conversations.
- No Instagram API. The Shortcut sends only the reel URL. The worker reads the public reel with yt-dlp (optionally with a throwaway account's cookies).

## 1. Product
Problem: people save reels on autopilot and rarely act on them. The saved folder has no search, sorting or follow-up, and the platform rewards saving, not doing.

Promise: every save becomes a plan. Share a reel to Realize; an agent reads it, works out what it is, checks the user's week and proposes one small, concrete plan ("Cook Thu 6:30 pm + 3 groceries"). The user confirms with one tap. Nothing is added anywhere without that tap. Later it asks whether they did it.

Around the loop: a library of every save, searchable by what was said and shown in the video; Ask, a chat over saves that answers with cards and says when nothing matches; a demo with no login.

## 2. Architecture
```
iPhone Shortcut ── POST /api/save (waits up to PROPOSAL_WAIT_SECONDS) ──┐
Browser (Next.js pages) ── /api/* ─────────────────────────────────────┤
                                                                        ▼
                      Caddy (HTTPS, one domain)  /api/*  → api:8000 (FastAPI)
                                                 /*      → web:3000 (Next.js)
api ── reads/writes ──► MongoDB Atlas ◄── claims jobs ── worker (Python)
                                                         yt-dlp → public Instagram reel
                                                         Gemini: planner, video, embeddings
```
Rules:
1. Only the worker contacts Instagram. The API never runs yt-dlp. If Instagram blocks the Vultr IP, stop the Vultr worker and run the same worker on a laptop; nothing else changes.
2. Atlas is the only shared state. API and worker never call each other.
3. The LLM decides; code executes. The planner chooses type, fields and which offered slot to use. Code computes free slots, validates dates, builds labels and builds every event and reminder.
4. Nothing is added to a calendar or reminder list without the user's choice.
5. The demo path (sample reels) needs neither Instagram nor the worker.

## 3. Repository layout
```
/
├─ CLAUDE.md  SPEC.md  DESIGN.md  README.md  .env.example  .gitignore
├─ BUILD_LOG.md  BLOCKERS.md     written by the build agent
├─ docker-compose.yml  Caddyfile
├─ docs/archive/                 history, do not build from
├─ prototype/                    original Shortcut test server, reference only
├─ fixtures/reels.csv            url,expected_type,sample,featured,why_chosen
├─ fixtures/queries.csv          query,expected_shortcode
├─ secrets/                      gitignored: instagram_cookies.txt (optional)
├─ shortcut/README.md            how to build both Shortcuts (section 10)
├─ eval/results.md               written by scripts/eval_recall.py
├─ server/
│  ├─ Dockerfile  requirements.txt  pyproject.toml (pytest config)
│  ├─ realize/
│  │  ├─ config.py    pydantic-settings; env_file = repo-root .env (Path(__file__).parents[2]); real env vars override
│  │  ├─ db.py        MongoClient singleton, collection handles
│  │  ├─ models.py    all pydantic models
│  │  ├─ urls.py      extract + normalize Instagram URLs
│  │  ├─ timeutil.py  timezone helpers, day/time labels
│  │  ├─ slots.py     find_free_slot, reminder times
│  │  ├─ actions.py   options, menu labels, device actions, ICS, Google Calendar links
│  │  ├─ gemini.py    client, tool-loop helper, embed()
│  │  ├─ ytdlp.py     metadata + download + error mapping
│  │  ├─ thumbs.py    fetch, resize, store
│  │  ├─ planner.py   planner agent (section 8)
│  │  ├─ enrich.py    video extraction (section 9)
│  │  ├─ search.py    hybrid search (section 11)
│  │  ├─ ask.py       Ask agent (section 12)
│  │  ├─ jobs.py      enqueue, claim, heartbeat, complete, fail
│  │  ├─ demo.py      demo sessions, sample copy
│  │  ├─ ratelimit.py in-memory limits
│  │  ├─ api/main.py, api/routers/*.py
│  │  └─ worker/__main__.py
│  ├─ scripts/        create_indexes.py create_user.py build_samples.py simulate_shortcut.py eval_recall.py reset_demo.py check_models.py
│  └─ tests/          unit tests for pure functions
└─ web/               Next.js app (section 13, DESIGN.md)
```
Local dev (Windows, three terminals; venv at server/.venv):
- `cd server; .\.venv\Scripts\Activate.ps1; uvicorn realize.api.main:app --reload --port 8000`
- `cd server; .\.venv\Scripts\Activate.ps1; python -m realize.worker`
- `cd web; npm run dev` (next.config rewrites `/api/:path*` to `${API_INTERNAL_URL ?? "http://localhost:8000"}/api/:path*`)
Phone testing locally: `cloudflared tunnel --url http://localhost:3000` and set PUBLIC_BASE_URL to the tunnel URL.

## 4. Configuration (.env at repo root; .env.example mirrors it with blanks)
```
APP_NAME=Realize
PUBLIC_BASE_URL=http://localhost:3000   # prod: https://<domain>. Used in links inside reminders.
DOMAIN=                                 # prod only, read by Caddy
DEBUG_ENDPOINTS=false

MONGODB_URI=
MONGODB_DB=realize

GEMINI_API_KEY=
GEMINI_MODEL_FAST=gemini-3.8-flash      # planner + Ask. Verified in phase 1; fallback gemini-3.5-flash; never Lite
GEMINI_MODEL_VIDEO=gemini-3.8-flash     # video extraction
GEMINI_EMBED_MODEL=gemini-embedding-001
EMBED_DIM=768

INSTAGRAM_COOKIES_PATH=                 # optional. e.g. secrets/instagram_cookies.txt; relative paths resolve from repo root

PLANNER_MODE=live                       # live | fake (fake: no Gemini, no Instagram; for contract tests)
PROPOSAL_WAIT_SECONDS=20                # from the Shortcut timeout test; max 25
HYBRID_MODE=auto                        # auto | rankfusion | manual
WORKER_ID=laptop
WORKER_PROPOSE_THREADS=2
WORKER_ENRICH_THREADS=2
DEFAULT_TIMEZONE=America/New_York

SHORTCUT_URL=                           # iCloud link, real-user Shortcut
JUDGE_SHORTCUT_URL=                     # iCloud link, judge Shortcut with key built in
FIRST_SAVE_REEL_URL=                    # public reel used in guided setup
DEMO_ENABLED=true
```

## 5. Data model (MongoDB Atlas, db `realize`)
Conventions: `user_id` is a string `u_<12 hex>`. Other `_id`s are ObjectId, exposed as strings. Times stored as UTC datetimes; local times computed with the user's timezone (zoneinfo + tzdata). Demo documents carry `expires_at` (TTL index, expireAfterSeconds 0) and delete themselves; real documents never have it.

### 5.1 users
```jsonc
{ "_id": "u_3f9a1c2b7d4e", "api_key_hash": "sha256 hex", "key_preview": "a1B2",
  "label": "yougi" | "judge" | null, "is_demo": false, "is_judge": false,
  "timezone": "America/New_York",
  "prefs": { "cook_days": ["mon","tue","wed","thu","fri"], "cook_time": "18:30",
             "workout_days": ["mon","wed","fri"], "workout_time": "07:00",
             "weekend_time": "12:00", "daily_cap": 2,
             "quiet_start": "22:00", "quiet_end": "08:00",
             "types_on": { "recipe": true, "event": true, "place": true, "workout": true, "product": true, "tip": true } },
  "created_at": ISODate, "expires_at": ISODate | absent }
```
Keys: `rl_` + `secrets.token_urlsafe(24)`, shown once, stored as sha256. Indexes: `{api_key_hash:1}` unique; `{expires_at:1}` TTL.
Intro (`/welcome`, after signup and once for any real account without `onboarded_at`): `"profile": { "identity", "age_range", "ethnicity": [], "interests": [], "hobbies": [], "starters": { "recipe": ["Weeknight dinners", "Baking"], "workout": ["Strength training"] } }`, `"onboarded_at": ISODate`. Every answer can be skipped. Identity and ethnicity are stored only; they are never sent to Gemini. `starters` are sub-categories Gemini proposes per type from interests, hobbies and age range (`server/realize/profile.py`). `subcats.existing` and `subcats.prompt_line` offer them next to the labels already in use, so new reels reuse them and get a new label only when none fits. `prompt_line` also carries one "ABOUT THE USER" line (interests, hobbies, age range) for the planner and the video pass.

### 5.2 saves
```jsonc
{ "_id": ObjectId, "user_id": "u_…", "url": "https://www.instagram.com/reel/ABC/", "shortcode": "ABC",
  "source": "shortcut" | "web" | "sample",
  "status": "queued" | "reading" | "planning" | "planned" | "enriching" | "ready" | "failed",
  "failure_reason": null | "private" | "unavailable" | "not_video" | "blocked" | "processing_error",
  "failure_message": null | "…",
  "caption": "…", "hashtags": ["fall"], "creator": { "handle": "chefjohn", "name": "Chef John" },
  "posted_at": ISODate | null, "duration_sec": 48, "thumb_id": "9f2c…" | null,
  "type": "recipe|event|place|workout|product|tip|other" | null,
  "title": "Gochujang butter squash" | null, "summary": "…",
  "fields": { /* exactly one key matching type, section 8.4 */ },
  "caption_sufficient": true,
  "transcript": [{ "start_sec": 0.0, "text": "…" }], "transcript_text": "…",
  "on_screen_text": ["2 tbsp gochujang"], "visual_summary": "…",
  "entities": [{ "name": "gochujang", "kind": "ingredient" }], "tags": ["squash","fall"],
  "unverified": ["Cafe Name"],
  "language": "en",
  "embedding": [768 floats], "embedding_source": "caption" | "full",
  "intent": null | "yes" | "later" | "none", "plan_id": ObjectId | null,
  "enrich_error": null | "private" | "…", "user_edited": [],
  "created_at": ISODate, "planned_at": ISODate | null, "ready_at": ISODate | null, "expires_at": … }
```
Status flow: queued → reading → planning → planned → enriching → ready. `failed` only when reading fails permanently. An enrichment failure keeps the save usable: status `ready`, `enrich_error` set. Sample saves: created as `planning` with metadata and enrichment copied from cache, then `ready` after planning.
Indexes: `{user_id:1, shortcode:1}` unique; `{user_id:1, created_at:-1}`; `{user_id:1, type:1, created_at:-1}`; `{expires_at:1}` TTL.

### 5.3 plans (one per save; created at proposal time)
```jsonc
{ "_id": ObjectId, "user_id": "u_…", "save_id": ObjectId,
  "kind": "recipe|event|place|workout|product|tip|other", "actionable": true,
  "question": "Dinner Thursday?", "why": "You cook weeknights and Thursday is free.",
  "confidence": "sure" | "best_guess",
  "options": [Option], "options_prev": [Option],
  "status": "proposed" | "accepted" | "declined" | "done" | "skipped",
  "intent": null | "later",
  "chosen": Option | null, "scheduled_for": ISODate | null, "ends_at": ISODate | null,
  "device_actions": { "event": DeviceEvent | null, "reminders": [DeviceReminder] },
  "confirmed_via": null | "web" | "shortcut", "followup_at": ISODate | null,
  "share_token": "22 random url-safe chars",
  "history": [{ "from": "proposed", "to": "accepted", "at": ISODate }],
  "created_at": ISODate, "updated_at": ISODate, "expires_at": … }
// Option: { id: "opt_1", action: "event"|"reminder", start_utc: ISODate, duration_min: 60,
//           label: "Cook Thu 6:30 pm + 3 groceries", web_label: "Add to Thursday",
//           big_time: "Thu 6:30 pm", secondary: "+3 groceries" }
// DeviceEvent: { title, start_utc, end_utc, location, notes, url }
// DeviceReminder: { title, due_utc, notes, url }
```
Transitions: proposed → accepted (option) | declined ("none") | proposed with intent "later". accepted → done | skipped | proposed (unconfirm) | accepted (different option). done or skipped → accepted (undo). declined or skipped → proposed (plan again).
Indexes: `{user_id:1, status:1, scheduled_for:1}`; `{save_id:1}` unique; `{expires_at:1}` TTL.

### 5.4 jobs
```jsonc
{ "_id": ObjectId, "kind": "propose" | "enrich", "user_id": "u_…", "save_id": ObjectId,
  "status": "pending" | "running" | "done" | "failed", "attempts": 0, "max_attempts": 3,
  "run_after": ISODate, "locked_by": null, "locked_until": null, "last_error": null,
  "created_at": ISODate, "updated_at": ISODate, "expires_at": … }
```
Claim atomically with find_one_and_update on `{kind, status in [pending, running], run_after <= now, locked_until null or < now}`, set running, locked_by WORKER_ID, locked_until now + 120 s, increment attempts. Heartbeat every 30 s. Each lane polls every 0.5 s when idle.
Indexes: `{kind:1, status:1, run_after:1}`; `{save_id:1}`; `{updated_at:1}` TTL 604800 s with partialFilterExpression `{status: {$in: ["done","failed"]}}`; `{expires_at:1}` TTL.

### 5.5 agent_runs
```jsonc
{ "_id": ObjectId, "user_id": "u_…", "save_id": ObjectId | null,
  "kind": "propose" | "enrich" | "replan" | "ask", "model": "…",
  "status": "running" | "done" | "failed" | "fallback",
  "steps": [{ "key": "find_free_slot", "label": "Checking your week", "tool": "find_free_slot",
              "args": {…}, "result": {…}, "ms": 412, "ts": ISODate }],
  "error": null, "started_at": ISODate, "ended_at": ISODate | null, "expires_at": … }
```
args and result truncated to 2 KB each. Steps are appended with $push as they happen so the UI can show them live. Indexes: `{save_id:1, started_at:-1}`; `{user_id:1, started_at:-1}`; `{expires_at:1}` TTL.

| step key | label |
|---|---|
| fetch_metadata | Reading the caption |
| search_saves | Checking your saves |
| find_free_slot | Checking your week |
| propose_plan | Drafting a plan |
| download_video | Grabbing the video |
| analyze_video | Watching the video |
| grounding | Checking facts against the video |
| embed | Filing it |
| replan | Updating the plan |
| get_save | Opening a save |
| list_plans | Checking your plans |
| propose_plans | Drafting plans |
| respond | Writing the answer |

### 5.6 thumbnails
`{ _id: "16 random hex", content_type: "image/jpeg", data: BinData, width, height, owner_user_id: "u_…" | null, expires_at? }`. Resized to 480 px wide, JPEG quality 80. `owner_user_id` null means sample-owned (never deleted with a save).

### 5.7 sample_cache
`{ _id: shortcode, url, order, featured: bool, expected_type, metadata: {caption, hashtags, creator, posted_at, duration_sec}, thumb_id, enrichment: {type, title, summary, fields, caption_sufficient, transcript, transcript_text, on_screen_text, visual_summary, entities, tags, unverified, language}, embedding, cached_plan: {type, title, summary, fields, question, why, confidence, actionable}, built_at }`. `cached_plan` holds no dates; slots are recomputed whenever it is used.

### 5.8 workers
`{ _id: WORKER_ID, last_seen: ISODate, lanes: ["propose","enrich"], host }`, updated every 10 s.

### 5.9 Search indexes on `saves` (M0 allows 3; this uses 2)
`saves_vector` (type vectorSearch):
```json
{ "fields": [
  { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" },
  { "type": "filter", "path": "user_id" },
  { "type": "filter", "path": "status" },
  { "type": "filter", "path": "type" } ] }
```
`saves_text` (type search):
```json
{ "mappings": { "dynamic": false, "fields": {
  "user_id": { "type": "token" }, "status": { "type": "token" }, "type": { "type": "token" },
  "title": { "type": "string" }, "summary": { "type": "string" }, "caption": { "type": "string" },
  "transcript_text": { "type": "string" }, "on_screen_text": { "type": "string" },
  "tags": { "type": "string" },
  "creator": { "type": "document", "fields": { "handle": { "type": "string" } } },
  "entities": { "type": "document", "fields": { "name": { "type": "string" } } } } } }
```
EMBED_DIM must equal numDimensions.

## 6. Ingest: POST /api/save
Request: `{ "input": "<URL or text containing one>", "source": "shortcut" | "web" | "sample", "wait": 20 }`. `wait` defaults to PROPOSAL_WAIT_SECONDS for source shortcut, else 0; max 25.

This endpoint and confirm (section 7) always return HTTP 200 for handled outcomes, including a bad key, rate limits and bad input, with `status: "error"` and a readable `message`, so the Shortcut can always show the message.

Steps:
1. Auth by Bearer key; rate limit (section 17).
2. Extract the first match of `https?://(?:www\.|m\.)?instagram\.com/(?:[A-Za-z0-9_.]+/)?(reel|reels|p|tv)/([A-Za-z0-9_-]+)`. No match → `{status:"error", ask:"no", message:"That wasn't an Instagram post link. Share a reel from Instagram, or paste its link."}`.
3. Canonical URL: `https://www.instagram.com/reel/{code}/` for reel, reels, tv; `https://www.instagram.com/p/{code}/` for p. No query string.
4. Existing save for (user_id, shortcode):
   - failed → reset to queued, enqueue propose, continue to step 6.
   - not yet planned → continue to step 6 (wait on it).
   - plan proposed → respond as a proposal with prompt prefixed "You saved this on {Mon D}. ".
   - otherwise → `{status:"duplicate", ask:"no", message:"You saved this on {Mon D}. {state}"}` where state is "Plan: Thu 6:30 pm.", "No plan.", "Done." or "Skipped.".
   Insert races (DuplicateKeyError) are treated as existing.
5. Insert save. If shortcode is in sample_cache: copy metadata, enrichment, embedding and thumb_id, status `planning`, run the planner in a FastAPI BackgroundTask (section 8.6). Otherwise status `queued` and insert a propose job.
6. Poll the save every 0.4 s until status is planned, enriching, ready or failed, or `wait` runs out.
7. Respond with SaveResponse.

SaveResponse:
```jsonc
{ "status": "proposed" | "pending" | "duplicate" | "failed" | "error",
  "ask": "yes" | "no",
  "save_id": "…",
  "prompt": "Gochujang butter squash. Dinner Thursday?",       // "{title}. {question}", max 110 chars
  "menu": ["Cook Thu 6:30 pm + 3 groceries", "Cook Mon 6:30 pm + 3 groceries", "Not now", "Just vibes"],
  "message": "…",
  "ticket": Ticket }
```
- proposed, actionable: menu = option labels + "Not now" + "Just vibes".
- proposed, not actionable: menu = option labels (may be empty) + "Just save".
- pending: `message: "Saved. Still reading it. Your plan will be waiting in Realize."`
- failed: message from section 16.

## 7. Confirm
`POST /api/saves/{id}/confirm` with `{ "choice": "<option id or exact label>", "source": "shortcut" | "web", "start_local": "YYYY-MM-DDTHH:mm" (optional, web Change) }`.
- Matching: option id, then label (trimmed, case-insensitive) in `options`, then in `options_prev`; "later" or "Not now"; "none", "Just vibes" or "Just save". No match → status error, message "That choice expired. Open Realize to pick again."
- Option → plan accepted, `chosen`, `scheduled_for`, `ends_at`, `followup_at`, `device_actions` built (section 8.5), `confirmed_via`, save.intent "yes".
- start_local → must be in the future; becomes a custom option of the plan's kind, then accepted.
- later → plan stays proposed, intent "later", save.intent "later". Message: "Okay. It's waiting in Realize."
- none → plan declined, save.intent "none". Message: "Saved to your library."
- Accepted messages, source shortcut: recipe or workout "Added to {long_day}.", event "Added to your calendar for {long_day}.", reminder options "Reminder set for {long_day}.". Source web: "Added to {long_day}." for all.
- Re-confirming the same option returns the same response (idempotent).

ConfirmResponse:
```jsonc
{ "status": "accepted" | "later" | "declined" | "error", "plan_id": "…", "message": "Added to Thursday.",
  "has_event": "yes" | "no",
  "event_title": "Cook: Gochujang butter squash",
  "event_start_text": "Nov 19, 2026 at 6:30 PM", "event_end_text": "Nov 19, 2026 at 7:30 PM",
  "event_start_iso": "2026-11-19T18:30:00-05:00", "event_end_iso": "…",
  "event_location": "", "event_notes": "…\nOpen: https://<domain>/p/<id>?t=<token>",
  "event": { …same fields as an object, for the web… } | null,
  "reminders": [{ "title": "Groceries for Gochujang butter squash", "due_text": "Nov 19, 2026 at 12:00 PM",
                  "due_iso": "…", "notes": "• 2 tbsp gochujang\n• 1 butternut squash", "url": "https://…/p/…?t=…" }],
  "gcal_url": "https://calendar.google.com/calendar/render?action=TEMPLATE&…",
  "ics_url": "/api/public/plans/<id>/ics?t=<token>",
  "ticket": Ticket }
```
`*_text` is formatted in the user's timezone as `MMM D, YYYY at h:mm A` (US English). The flat `event_*` fields exist so the Shortcut never reads nested dictionaries.

`POST /api/saves/{id}/unconfirm` → plan back to proposed. Message for confirmed_via shortcut: "Back in Waiting on you. If it's on your phone's calendar, delete it there too." Web: "Undone."

## 8. Fast path: propose job and planner agent

### 8.1 propose job (worker, propose lane)
1. status `reading`; agent_run step fetch_metadata; yt-dlp metadata (8.2). Fill caption, hashtags, creator, posted_at, duration_sec.
2. Fetch the thumbnail (only if its host ends with `cdninstagram.com` or `fbcdn.net`), resize, store.
3. status `planning`; run the planner (8.4).
4. Embed the caption-level text (11.1) → `embedding`, `embedding_source: "caption"`.
5. status `planned`, `planned_at`; enqueue an enrich job.
Backoff on transient failure: 2 s, then 6 s; 3 attempts. Then the save is `failed` with the mapped reason.

### 8.2 yt-dlp (ytdlp.py)
- Only canonical instagram.com URLs from section 6 reach yt-dlp.
- Cookies are optional. If INSTAGRAM_COOKIES_PATH is blank or the file doesn't exist, call yt-dlp without cookiefile and log once: "No Instagram cookies; public access only." If the file exists, copy it to a temp file for every call and pass the copy as cookiefile (yt-dlp writes cookies back; threads must not share a file, and the original is mounted read-only in Docker).
- Metadata: `YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True, "socket_timeout": 15, [cookiefile]}).extract_info(url, download=False)`.
- Download (enrich): `{"format": "b[ext=mp4]/bv*+ba/b", "merge_output_format": "mp4", "outtmpl": "<tmpdir>/%(id)s.%(ext)s", "max_filesize": 100 * 1024 * 1024, ...same base options}`.
- Map: caption = description or title; hashtags = `#\w+` from caption plus `tags`; creator.handle = uploader_id or channel; creator.name = uploader; posted_at = timestamp; duration_sec = duration; thumbnail URL = thumbnail.
- Errors (DownloadError message, case-insensitive): "private" → private (permanent). "not available", "unavailable", "404" → unavailable (permanent). "no video" → not_video (permanent). "login required", "rate", "429", "wait a few minutes", "checkpoint" → blocked (transient). Network errors → transient. Anything else → processing_error (transient until attempts run out).
- On blocked, log loudly. Without cookies: "Instagram wants a login. Add a throwaway account's cookies at INSTAGRAM_COOKIES_PATH." With cookies: "Instagram is blocking this worker. Refresh cookies or run the worker on another IP."

### 8.3 slots.py (deterministic)
`find_free_slot(user, kind, not_before=None, not_after=None, duration_min=None, reserved=[]) -> list[Slot]` (max 5):
- now in the user's timezone; nb = max(not_before or now, now + 60 min); na = not_after or nb + 14 days.
- Days and time by kind: recipe → cook_days at cook_time (60 min); workout → workout_days at workout_time (45 min); place → sat, sun at weekend_time (90 min).
- For each date from nb to na: candidate start = date at time. Skip if outside [nb, na]; if start or end falls in quiet hours (handle windows that cross midnight); if it overlaps an accepted plan [scheduled_for, ends_at) or a reserved slot; if accepted plans on that local date plus reserved slots that date ≥ daily_cap.
- Return `[{start_local: "YYYY-MM-DDTHH:mm", big_time, long_day}]`.

Reminder times (code only; then moved out of quiet hours to quiet_end, and off days already at daily_cap to the next day):
| case | due |
|---|---|
| product | today + 3 days, 18:00 |
| tip, other, "Remind me in a week" | today + 7 days, 09:00 |
| place reminder option | next Saturday, 10:00 |
| event without a date ("check dates") | today + 2 days, 18:00 |
| event ticket reminder | tomorrow 18:00, only if at least 1 day before the event |

### 8.4 Planner agent (planner.py)
Model GEMINI_MODEL_FAST with the lowest thinking setting the gemini-api-dev skill documents for it. Manual function-calling loop with automatic function calling disabled. Append each model response's content to the history unchanged (thought signatures must round-trip); answer each function call with a function_response part in the same order. Parallel calls allowed. Max 4 model turns; from turn 3, force `propose_plan` (function calling mode ANY, allowed_function_names ["propose_plan"]). Total timeout 15 s. Every tool call becomes an agent_run step. Don't override temperature unless the skill says to.

System prompt:
```
You are the planner inside Realize. Someone just shared a short video (an Instagram reel)
because they might want to do something with it. Work out what it is and propose one small,
concrete plan that fits their week. They confirm or decline; you never act yourself.

1. Read the caption, hashtags, creator and thumbnail. Pick the type:
   recipe (food to cook), event (happens at a specific date and place), place (restaurant, cafe,
   shop or destination with no fixed date), workout (exercise routine or sports drill),
   product (something to buy or try), tip (advice, lesson, explainer, motivation),
   other (jokes, memes, vibes, nothing to do).
2. Extract the fields for that type using only what the caption, thumbnail, transcript or
   on-screen text says. Never invent quantities, prices, dates, names or places. If the caption is
   unrelated to the video ("follow for part 2", lyrics, only hashtags), set caption_sufficient
   to false and keep fields minimal.
3. Call search_saves with a short description to see whether they saved something similar.
   For recipe, workout and place, call find_free_slot. You may call both in the same turn.
4. Call propose_plan exactly once.
   - recipe, workout, place: every option start must be one of the slots find_free_slot returned.
     Prefer the first slot unless the content suggests otherwise (a long weekend recipe fits a
     weekend slot better).
   - event: use the event's own date and time. Resolve relative dates against the post date
     ("this Friday" is the first Friday after the post date). If there is a date but no time,
     use 19:00 and set confidence to best_guess.
   - product, tip, other: leave option_starts_local empty; the app sets reminder times.
5. question: a short yes/no question, max 50 characters, action first ("Dinner Thursday?").
   why: one plain sentence, max 90 characters, naming the real reason
   ("You cook weeknights and Thursday is free."). confidence: sure when type and timing are
   clear, best_guess otherwise.
6. actionable is false for type other, for events that already happened, and when there is
   nothing a person could do with it.
Do not write reasoning in text. Use the tools.
```

First user message (plain text plus the thumbnail as an inline image part):
```
NOW: Sat Nov 14 2026, 3:05 am (America/New_York)
PREFS: cooks Mon to Fri at 6:30 pm; workouts Mon, Wed, Fri at 7:00 am; weekend plans at 12:00 pm;
max 2 plans a day; quiet 10:00 pm to 8:00 am; types off: none
UPCOMING (accepted, next 14 days):
- Tue Nov 17 6:30 pm | recipe | Miso salmon bowls
REEL:
creator: @chefjohn | posted: Tue Nov 10 2026 | duration: 48 s
caption: """…"""
hashtags: #squash #fall
```
For a replan (9.5) or a sample (8.6), add `TRANSCRIPT:` (max 6,000 chars), `ON SCREEN:` and `VISUAL:` sections.

Tools:
| tool | parameters | returns |
|---|---|---|
| search_saves | query: string, limit?: int ≤ 5 | `[{save_id, title, type, saved_on, plan_status}]` (hybrid search, section 11) |
| find_free_slot | kind: recipe\|workout\|place, not_before_local?, not_after_local?, duration_min? | `[{start_local, big_time, long_day}]` |
| propose_plan | see below | `{ok: true}` or `{ok: false, errors: [...]}` |

propose_plan parameters (keep the schema Gemini-compatible: no unions besides optional fields, no free-form dicts):
```jsonc
{ "type": "recipe|event|place|workout|product|tip|other",
  "title": "max 60 chars, specific: 'Gochujang butter squash', not 'Recipe video'",
  "summary": "max 2 sentences",
  "caption_sufficient": true, "actionable": true,
  "fields": {
    "recipe":  { "servings": 2, "total_time_min": 40,
                 "ingredients": [{ "qty": 2, "unit": "tbsp", "item": "gochujang",
                   "aisle": "Produce|Meat & Seafood|Dairy & Eggs|Bakery|Pantry|International|Spices|Frozen|Beverages|Other" }],
                 "steps": ["…"], "tips": ["…"] },
    "event":   { "name": "…", "start_local": "YYYY-MM-DDTHH:mm", "end_local": "…", "date_text": "this Friday 8pm",
                 "venue": "…", "city": "…", "ticket_url": "…", "price_hint": "…" },
    "place":   { "places": [{ "name": "…", "kind": "food|sight|shop|activity|nightlife|stay", "city": "…", "why": "…", "tip": "…" }] },
    "workout": { "goal": "…", "duration_min": 30, "equipment": ["…"],
                 "exercises": [{ "name": "…", "sets": 3, "reps": "10", "duration_sec": 30, "rest_sec": 60, "cues": ["…"] }] },
    "product": { "items": [{ "name": "…", "brand": "…", "price_hint": "…", "why": "…", "where_to_buy": "…", "url": "…" }] },
    "tip":     { "topic": "…", "key_points": ["…"], "takeaway": "…" } },
  "question": "…", "why": "…", "confidence": "sure|best_guess",
  "option_starts_local": ["YYYY-MM-DDTHH:mm"],
  "similar_save_id": null }
```
Only the `fields` key matching `type` is filled. option_starts_local has 0 to 3 items.

Code validation after propose_plan:
- Truncate title to 60 chars, question to 50, why to 90.
- If the type is switched off in prefs: actionable false.
- recipe, workout, place: drop any start that isn't a slot from this run's find_free_slot results (or a fresh call); if none remain, use the first two free slots.
- event: parse start_local. Missing → a single reminder option "Remind me to check dates". In the past → actionable false, why "This was on {Mon D}. It's passed.", no options.
- product, tip, other: options come from code (8.3).
- Build options and labels (8.5). Insert or update the plan doc; link it on the save.
- Invalid arguments twice, an exception or a timeout → deterministic fallback: type other, title = first 50 chars of the caption or "Saved reel", actionable false, option "Remind me in a week". Run status `fallback`.

PLANNER_MODE=fake: skip yt-dlp and Gemini. Caption = the URL, type recipe, title "Test recipe", 3 fake ingredients, options from the real slot finder, run model "fake".

### 8.5 Options, labels and device actions (actions.py)
Formatting (user timezone): short_day = "Today", "Tomorrow", "Mon".."Sun" within 6 days, else "Nov 26". long_day = "today", "tomorrow", "Monday".."Sunday", else "Nov 26". time = "6:30 pm", "12 pm", "7 am". big_time = "{short_day} {time}", with a comma after dates: "Nov 26, 6:30 pm".

| kind | options | label (Shortcut) | web_label | big_time / secondary |
|---|---|---|---|---|
| recipe | first 2 slots | "Cook {short_day} {time}" + " + {n} groceries" if n > 0 | "Add to {long_day}" | slot / "+{n} groceries" |
| workout | first 2 slots | "Train {short_day} {time}" | "Add to {long_day}" | slot / "{duration} min" |
| place | opt_1 weekend slot (event), opt_2 reminder | "Visit {short_day} {time}" / "Remind me {short_day}" | "Add to {long_day}" / "Remind me {long_day}" | slot / place name |
| event (future, dated) | 1 | "Add {big_time}" | "Add to calendar" | event start / venue |
| event (no date) | 1 reminder | "Remind me to check dates" | same | due / "Reminder" |
| product | 1 reminder | "Remind me {short_day}" | "Remind me {long_day}" | due / "Reminder" |
| tip, other | 1 reminder | "Remind me in a week" | same | due / "Reminder" |
Labels max 38 chars and unique within a menu.

Device actions on accept (max 1 event and 2 reminders):
- recipe: event "Cook: {title}" at the slot, duration = total_time_min clamped to 30..120, else 60; notes = ingredients and steps (max 1,500 chars) + "Open: {link}". Reminder "Groceries for {title}" (only if ingredients exist): due 12:00 the same day if the slot starts at or after 15:00, else 18:00 the day before; if that's past, now + 15 min; notes = one "• qty unit item" line per ingredient. Follow-up reminder "Did you make {title}?" due at ends_at + 2 h (moved out of quiet hours), url = link.
- workout: event "Workout: {title}" (duration_min or 45); notes = exercises; follow-up "Did you do {title}?".
- place event: "Visit {place name}" 90 min, location = name + city; follow-up "Did you go to {place name}?". Place reminder: "Try {place name}" with notes why + tip.
- event: event "{name}" at start, end = end or start + 2 h, location = venue + city, notes = price_hint, ticket_url and the link; reminder "Get tickets: {name}" only when ticket_url exists and the 8.3 rule allows. No follow-up.
- product: reminder "Look at {item name}" with notes price_hint, where_to_buy, url.
- tip, other: reminder "Revisit: {title}" with notes key points.
- link = `{PUBLIC_BASE_URL}/p/{plan_id}?t={share_token}`. followup_at = the follow-up reminder's due time.
- gcal_url: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ&details=…&location=…` (UTC). Reminder-only plans: a 15-minute event at the due time.
- ICS (`/api/public/plans/{id}/ics?t=`): one VEVENT (UTC); each reminder becomes a VALARM with an absolute trigger (`TRIGGER;VALUE=DATE-TIME:…Z`). Reminder-only plans: a 15-minute VEVENT with one VALARM. CRLF line endings, `Content-Type: text/calendar`.

### 8.6 Sample planning (API process)
For sample saves: a BackgroundTask runs the same planner with the cached metadata and enrichment as context (like a replan with transcript), timeout 10 s. On any error or timeout, use `cached_plan` with options recomputed by code (run status `fallback`). Then status `ready`. Nothing here needs Instagram or the worker.

## 9. Slow path: enrich job (worker, enrich lane)
1. status `enriching`. Step download_video: yt-dlp download to a temp dir (8.2).
2. Step analyze_video: upload with `client.files.upload`, poll `client.files.get` until ACTIVE (max 120 s), then one `generate_content` on GEMINI_MODEL_VIDEO with structured output. Prompt:
   ```
   Transcribe all speech verbatim with timestamps. List every on-screen text overlay exactly as
   written, including quantities and units. Describe what is physically shown, step by step,
   in at most 120 words. Then fill type, title, summary, fields, entities and tags using only what
   appears in the video or the caption below. When they disagree, trust speech and on-screen text
   over the caption. Write card text in English; if the video is in another language, translate
   and set language to the original language code. If there is no speech, return an empty
   transcript and has_speech=false; if the audio is only music, set music_only=true.
   CAPTION: """…"""
   ```
   Schema: `{has_speech, music_only, language, transcript: [{start_sec, text}], on_screen_text: [str], visual_summary, type, title, summary, fields (same model as 8.4), entities: [{name, kind: ingredient|product|brand|place|person|exercise|topic|event}], tags: [str] (3 to 8, lowercase)}`.
3. Step grounding: corpus = caption + transcript_text + on_screen_text (not visual_summary, which is model output). Normalize to lowercase, strip punctuation, drop a trailing "s". Keep an entity if its name is a substring of the corpus or all its non-stopword tokens appear in it; drop the rest. Place names and product item names not found are kept but listed in `unverified`. The step result records kept and dropped counts.
4. Merge into the save, never overwriting fields in `user_edited`.
5. Replan (step replan, run kind replan): if the plan is still proposed and (caption_sufficient was false, or the new type differs from plan.kind), run the planner again with transcript context. Move the old options to `options_prev`; update options, question, why and kind. Accepted, declined, done and skipped plans are never changed.
6. Step embed: full embedding text (11.1), `embedding_source: "full"`.
7. status `ready`, `ready_at`.
8. In a finally block: delete the temp dir and the Gemini file.
Video longer than 600 s: skip the download, enrich_error "too_long", status ready. Permanent download failure: enrich_error = reason, status ready. Backoff 10 s, 30 s, 90 s.

## 10. iOS Shortcut (document in shortcut/README.md; built by hand)
Details: name "Realize", Show in Share Sheet on, Share Sheet types URLs and Text only. It appears in the share sheet's action list (scroll down; Edit Actions to favorite it).

Actions, in order:
1. Text `https://<domain>` → Set Variable BASE.
2. Text `<key>` → Set Variable KEY. (Setup tab: add an Import Question on this Text: "Paste your Realize key".)
3. If Shortcut Input has any value → Set Variable INPUT = Shortcut Input. Otherwise → Get Clipboard → Set Variable INPUT. End If.
4. Get Contents of URL: `BASE/api/save`, Method POST, Header `Authorization` = `Bearer KEY`, Request Body JSON: `input` (Text) = INPUT, `source` (Text) = `shortcut`. → Set Variable RESP.
5. Get Dictionary Value `ask` from RESP. If it is `yes`:
   1. Get Dictionary Value `prompt` from RESP → Set Variable PROMPT.
   2. Get Dictionary Value `menu` from RESP → Choose from List (Prompt = PROMPT) → Set Variable CHOICE.
   3. Get Dictionary Value `save_id` from RESP → Set Variable SAVE_ID.
   4. Get Contents of URL: `BASE/api/saves/SAVE_ID/confirm`, POST, same header, JSON: `choice` = CHOICE, `source` = `shortcut`. → Set Variable CONF.
   5. Get Dictionary Value `has_event` from CONF. If it is `yes`: Get Dates from Input on `event_start_text` → START; on `event_end_text` → END; Add New Event (Title `event_title`, Start START, End END, Location `event_location`, Notes `event_notes`). End If.
   6. Get Dictionary Value `reminders` from CONF → Repeat with Each: Get Dates from Input on Repeat Item `due_text` → Add New Reminder (Title = Repeat Item `title`, alert at that date, Notes = Repeat Item `notes`, URL = Repeat Item `url` if the field exists). End Repeat.
   7. Show Notification: CONF `message`.
   Otherwise: Show Notification: RESP `message`. End If.
Judge version: duplicate it, put the judge key in step 2, remove the Import Question, share its iCloud link as JUDGE_SHORTCUT_URL.
If Get Dates misreads `*_text`, use the `*_iso` fields instead.

## 11. Search
### 11.1 Embeddings
`client.models.embed_content(model=GEMINI_EMBED_MODEL, contents=[…], config=EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY", output_dimensionality=EMBED_DIM))`, then L2-normalize with numpy.
Embedding text (max 6,000 chars total):
```
{title}
Type: {type}. Creator: @{handle}.
{summary}
{fields as compact text: ingredients; event name, date and venue; places; exercises; items; key points}
Tags: {tags}
On screen: {on_screen_text joined, max 1,000 chars}
Said: {transcript_text, fills the remaining budget}
Caption: {caption, max 1,000 chars}
```
The caption-level version (propose stage) omits On screen and Said.

### 11.2 Hybrid query (search.py)
SEARCHABLE = ["planned", "enriching", "ready"].
```python
vector = [{"$vectorSearch": {"index": "saves_vector", "path": "embedding", "queryVector": q,
           "numCandidates": 150, "limit": 20,
           "filter": {"user_id": uid, "status": {"$in": SEARCHABLE}, **({"type": t} if t else {})}}}]
text = [{"$search": {"index": "saves_text", "compound": {
           "must": [{"text": {"query": query, "path": ["title", "summary", "caption", "transcript_text",
                     "on_screen_text", "tags", "creator.handle", "entities.name"], "fuzzy": {"maxEdits": 1}}}],
           "filter": [{"equals": {"path": "user_id", "value": uid}},
                      {"in": {"path": "status", "value": SEARCHABLE}}]
                     + ([{"equals": {"path": "type", "value": t}}] if t else [])}}},
        {"$limit": 20}]
pipeline = [{"$rankFusion": {"input": {"pipelines": {"vector": vector, "text": text}},
                             "combination": {"weights": {"vector": 0.6, "text": 0.4}}}},
            {"$limit": limit}, {"$project": {"embedding": 0, "transcript": 0}}]
```
Manual mode: run both legs, score = Σ weight / (60 + rank), ranks starting at 1. HYBRID_MODE auto: try $rankFusion; on OperationFailure switch to manual for the process lifetime and log it. /api/health reports the active mode.
Snippet: the sentence from summary, transcript_text or on_screen_text with the most query-token overlap, max 140 chars.

## 12. Ask (POST /api/chat)
Request `{ "message": "…", "history": [{ "role": "user" | "assistant", "text": "…" }] }` (client keeps the last 6). Response: `application/x-ndjson` stream, one JSON per line:
```
{"type":"step","label":"Checking your saves"}
{"type":"cards","cards":[Card]}
{"type":"plans","tickets":[Ticket]}
{"type":"answer","text":"…","confidence":"high|low|none","save_ids":["…"]}
{"type":"done"}
{"type":"error","message":"Ask didn't answer. Try again."}
```
Card: `{save_id, title, type, thumb_url, saved_on: "Oct 3", snippet, url}`.
Agent: GEMINI_MODEL_FAST, same loop rules as 8.4, max 5 turns, force `respond` from turn 4, timeout 30 s.
Tools: `search_saves(query, type?, limit ≤ 8)`, `get_save(save_id)` (fields, summary, transcript max 3,000 chars), `list_plans(range: week|upcoming|done)`, `propose_plans(save_ids ≤ 5)` (code only: for each save, reuse or create a plan in proposed state with fresh options from slots.py, reserving earlier picks so plans don't collide; returns tickets), `respond(text ≤ 600 chars, confidence, save_ids)` (terminal).
System prompt:
```
You are Ask, inside Realize. You help the user find and use reels they saved.
Today is {today_local} ({timezone}).
- Call search_saves before answering anything about their saves. Use get_save for details.
- Only state facts that appear in saves you retrieved. If nothing matches, say so plainly and use
  confidence none. If two saves fit, include both; never guess which one they mean.
- When they ask to plan, schedule or make something from their saves, call propose_plans with the
  matching save_ids. The app shows each plan as a ticket they confirm. Never say a plan was added;
  say it's ready to confirm.
- Finish with respond: 1 to 3 short sentences, answer first. Don't list everything you found; the
  app shows cards. save_ids are the saves that answer the question, best first.
- confidence: high if a save clearly answers it, low if one partly does, none if nothing does.
```
Server side: after `respond`, emit cards for save_ids. If confidence is none, emit the top 3 search results as cards; the UI labels them "Closest ones".

## 13. Web app
### 13.1 Routes
`/` landing (no key) or redirect to `/plans`; `/demo` sample feed; `/setup`; `/plans` (home); `/library`; `/s/[id]` save detail; `/ask`; `/settings`; `/p/[id]` public plan page (token); `/map` stretch. All pages are client components; data via SWR with a fetch wrapper that adds `Authorization: Bearer <localStorage rl_key>`. Thumbnails use plain `<img>` with `/api/t/{thumb_id}`.
### 13.2 Auth on the web
- "Use it for real": POST /api/users with the browser timezone → store the key in localStorage `rl_key`.
- Laptop to phone: the QR code encodes `{PUBLIC_BASE_URL}/setup#k=<key>`. /setup reads the fragment, stores it, then clears it with history.replaceState.
- No key on an app route → redirect to `/`.
### 13.3 Ticket (the one shape every list returns)
```jsonc
{ "save_id": "…", "plan_id": "…" | null, "url": "…", "title": "…" | null, "type": "recipe" | null,
  "creator": "@chefjohn", "thumb_url": "/api/t/…" | null, "saved_on": "Oct 3",
  "processing": "queued|reading|planning|planned|enriching|ready|failed", "failure_message": null,
  "is_sample": false,
  "plan": null | { "status": "proposed|accepted|declined|done|skipped", "intent": null | "later",
    "actionable": true, "question": "…", "why": "…", "confidence": "sure|best_guess",
    "options": [{ "id": "opt_1", "label": "…", "web_label": "Add to Thursday", "big_time": "Thu 6:30 pm",
                  "secondary": "+3 groceries", "action": "event|reminder" }],
    "extras": [{ "id": "later", "label": "Not now" }, { "id": "none", "label": "Just vibes" }],
    "chosen": Option | null, "big_time": "Thu 6:30 pm" | null,
    "followup_due": false, "confirmed_via": "web|shortcut" | null,
    "gcal_url": "…" | null, "ics_url": "…" | null, "reminders_preview": ["Groceries, Thu 12 pm"] },
  "steps": [{ "label": "Checking your week", "state": "done|current|failed", "ms": 412 }] }
```
`followup_due` = accepted and now > ends_at. `steps` come from the latest run, in detail and poll responses only. Mirror these types in web/lib/types.ts.
### 13.4 Live updates
After POST /api/save with wait 0, the web polls GET /api/saves/{id} every 700 ms while processing is queued, reading or planning, then every 3 s while enriching, then stops. Steps print as they appear (DESIGN.md motion 1). Over 30 s still queued: show the "finishes in the background" copy. Live paste with no worker seen in the last 60 s (from /api/health): show the offline copy.
### 13.5 Desktop
At 1100 px or wider: a 440 px app column plus a 560 px side panel with the agent trace for the selected ticket (and the map if built). Below that: one column, with the trace in a bottom sheet.

## 14. Demo mode
- `POST /api/demo/session {timezone?}` (10 per hour per IP): creates a user with is_demo true and expires_at now + 24 h. Copies every featured sample into saves (status ready, is_sample, source sample). Plans: the first two actionable recipe or workout samples are accepted into the first free slots; one other sample stays proposed ("Waiting on you"); the rest are declined (library only). Returns `{api_key, expires_at}`.
- `GET /api/demo/samples` (key optional): non-featured samples `[{shortcode, url, title, creator, caption_excerpt, thumb_url, type, saved}]`.
- Saving a sample: POST /api/save with source sample → section 8.6.
- Limits per demo user: 3 non-sample saves (live paste), 20 chats. Messages: "That's the live limit for this demo. The samples still work." and "That's the chat limit for this demo."
- Judge user: `python -m scripts.create_user --judge --label judge` (is_judge true, no expiry, 30 saves per hour).
- `scripts/reset_demo.py` deletes all demo users and their documents (TTL does this too).

## 15. API reference
Bearer key unless noted. Errors outside sections 6 and 7: normal HTTP codes with `{ "message": "…" }`.
| method | path | auth | purpose |
|---|---|---|---|
| GET | /api/health | none | `{ok, db, worker_last_seen_s, hybrid_mode, planner_mode, models}` |
| GET | /api/config | none | `{app_name, public_base_url, shortcut_url, judge_shortcut_url, first_save_reel_url, demo_enabled}` |
| POST | /api/users | none, 5/h/IP | `{timezone?}` → `{user_id, api_key}` (shown once) |
| GET | /api/me | key | `{user_id, is_demo, is_judge, timezone, prefs, key_preview, expires_at, counts}` |
| PATCH | /api/me | key | `{timezone?, prefs?}` |
| GET | /api/onboarding/options | none | the intro's fixed choices `{identities, age_ranges, ethnicities, interests, hobbies}` |
| POST | /api/onboarding/suggest | key, 20/10 min | `{picked, age_range?}` → `{suggestions}`: Gemini's "More for you" interest chips |
| POST | /api/onboarding/finish | key | `{profile}` → stores it with Gemini's starter sub-categories → `{profile, starters: [{type, label, subcategories}]}` |
| POST | /api/me/key | key | new key → `{api_key}`; the old one stops working |
| POST | /api/save | key | section 6 |
| GET | /api/saves | key | `?type&limit=30&before=<iso>` → `{items: Ticket[], next_before}` |
| GET | /api/saves/{id} | key | `{ticket, details: {caption, summary, fields, transcript, on_screen_text, entities, unverified, enrich_error}, runs: AgentRun[]}` |
| POST | /api/saves/{id}/confirm | key | section 7 |
| POST | /api/saves/{id}/unconfirm | key | section 7 |
| POST | /api/saves/{id}/replan | key | fresh options from slots.py, plan back to proposed ("Plan again") |
| POST | /api/saves/{id}/retry | key | failed → queued + propose job |
| DELETE | /api/saves/{id} | key | deletes the save, its plan, its runs and its owned thumbnail |
| GET | /api/plans | key | `?range=week` → `{waiting: Ticket[], days: [{label: "Thursday, Nov 19", items: Ticket[]}], done: Ticket[], later_count}`; `?range=upcoming` → days beyond this week |
| POST | /api/plans/{id}/status | key | `{status: "done"|"skipped"|"accepted"}` (accepted = undo) |
| GET | /api/search | key | `?q&type` → `{items: (Ticket & {snippet})[], mode}` |
| POST | /api/chat | key | section 12 |
| GET | /api/agent_runs | key | `?save_id` → runs with full steps |
| GET | /api/public/plans/{id} | `?t=` | `{ticket}` |
| POST | /api/public/plans/{id}/status | `?t=` | `{status: "done"|"skipped"}` |
| GET | /api/public/plans/{id}/ics | `?t=` | text/calendar |
| GET | /api/t/{thumb_id} | none | image, `Cache-Control: public, max-age=86400` |
| POST | /api/demo/session | none, 10/h/IP | section 14 |
| GET | /api/demo/samples | optional | section 14 |
| GET | /api/map | key | stretch (phase 8) |
| GET | /api/debug/sleep | DEBUG_ENDPOINTS only | `?s=` |

## 16. Messages for failures (exact copy; never apologize)
| reason | message |
|---|---|
| private | Saved, but this reel is private, so I can't read it. |
| unavailable | Saved, but Instagram says this post isn't available. |
| not_video | Saved, but this post has no video. Realize reads reels. |
| blocked | Saved. Instagram is slowing me down. I'll keep trying. |
| processing_error | Saved. Couldn't read this reel yet. Tap Try again in Realize. |
| bad key | Your Realize key doesn't work. Get a new one at {PUBLIC_BASE_URL}/setup. |
| rate limit | Slow down a little. Try again in a minute. |
| Gemini down (planner) | the deterministic fallback; the user still gets a ticket |
| Gemini down (Ask) | Ask didn't answer. Try again. |

## 17. Security
- user_id comes from the key, never the body. Keys hashed (sha256), rotatable.
- Rate limits (in-memory, single uvicorn process): save 20/min per key; chat 15/min per key; demo and user creation per IP (uvicorn `--proxy-headers --forwarded-allow-ips="*"` behind Caddy).
- Only instagram.com URLs reach yt-dlp; only Instagram CDN hosts are fetched for thumbnails. No other outbound fetches.
- Public plan routes require share_token (constant-time compare).
- Same origin through Caddy; no CORS.
- Secrets live only in .env and secrets/. Demo data expires on its own.
- Videos are deleted from disk and from Gemini Files after processing; every save links to the creator's post.

## 18. Deployment
server/Dockerfile:
```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
```
web/Dockerfile: multi-stage on node:22-slim, `output: "standalone"` in next.config, runs `node server.js` on port 3000.
docker-compose.yml:
```yaml
services:
  api:
    build: ./server
    command: uvicorn realize.api.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips=*
    env_file: .env
    restart: unless-stopped
  worker:
    build: ./server
    command: python -m realize.worker
    env_file: .env
    environment:
      WORKER_ID: vultr-1
    volumes:
      - ./secrets:/secrets:ro
    restart: unless-stopped
  web:
    build: ./web
    environment:
      API_INTERNAL_URL: http://api:8000
    restart: unless-stopped
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443", "443:443/udp"]
    env_file: .env
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [api, web]
    restart: unless-stopped
volumes:
  caddy_data:
  caddy_config:
```
If cookies are used on the server, set `INSTAGRAM_COOKIES_PATH=/secrets/instagram_cookies.txt` in the server's .env.
Caddyfile (no compression on /api so NDJSON streams aren't buffered):
```
{$DOMAIN} {
	handle /api/* {
		reverse_proxy api:8000 {
			flush_interval -1
		}
	}
	handle {
		encode zstd gzip
		reverse_proxy web:3000
	}
}
```
requirements.txt: fastapi, uvicorn[standard], pymongo, dnspython, google-genai, pydantic, pydantic-settings, yt-dlp[default] (unpinned, so `docker compose build --no-cache worker` picks up Instagram fixes), httpx, Pillow, numpy, tzdata, pytest.

## 19. Scripts (run from server/ as `python -m scripts.<name>`)
- check_models: lists Flash models for the key and confirms GEMINI_MODEL_FAST, GEMINI_MODEL_VIDEO and GEMINI_EMBED_MODEL exist; exits nonzero if not.
- create_indexes: every index in section 5 plus both search indexes (`create_search_index` with SearchIndexModel; vector index type "vectorSearch"). Polls list_search_indexes until both are queryable (max 5 min). Runs one $rankFusion test query and prints whether it worked.
- create_user `[--label NAME] [--tz ZONE] [--judge]`: prints the key once.
- build_samples `[--only SHORTCODE]`: for fixtures/reels.csv rows with sample=yes, runs metadata, thumbnail, enrichment, embedding and planner (as a template user with default prefs) and upserts sample_cache. Needs Instagram access. Idempotent; skips rows that fail and reports them.
- simulate_shortcut `--url URL [--key KEY] [--choose 1|2|later|none] [--base http://localhost:3000]`: does exactly what the Shortcut does; prints the prompt, menu, choice, event and reminders, plus timings. Exits nonzero if any field from sections 6 and 7 is missing.
- eval_recall `[--user UID]`: default creates a temporary demo user holding all samples, runs fixtures/queries.csv through hybrid search, prints hit@1 and hit@3, writes eval/results.md (date, hybrid mode, counts, per-query result), deletes the temp user.
- reset_demo: section 14.

## 20. Build phases (each ends with its PASS check, then a commit and push)
0. Repo reconciliation (before any code).
   - `git fetch --all --prune`; read `git log --all --oneline`, every branch, and every folder, including what teammates added since this spec was written (prototype/, docs/archive/, any web/, worker/, server/, shortcut/ or fixtures).
   - Merge the latest main into the working branch. For each teammate file or feature: reuse it if it matches this spec (adapt names and paths), keep it in prototype/ or docs/archive/ if it doesn't, never delete it. Specifically keep prototype/ untouched; reuse its tested URL-extraction rules and Shortcut notes in urls.py and shortcut/README.md.
   - If a teammate's newer commit changes a requirement (new fixtures, a domain, a Shortcut finding), follow it when it doesn't break sections 2, 6, 7 or 10, and log the decision.
   - Write BUILD_LOG.md: what exists, what you reuse, what you archive, open questions with the call you made.
   - Before each later phase, `git fetch` again; if main moved, merge it and log what changed.
   PASS: BUILD_LOG.md lists every top-level path and every branch with a decision; working branch builds on the latest main.
1. Skeleton and contract (PLANNER_MODE=fake). check_models, config, db, models, urls, slots, actions, ICS, gcal, auth, users, /api/save, confirm, unconfirm, health, config, create_indexes, create_user, simulate_shortcut, web skeleton with tokens and fonts. PASS: check_models passes (or .env updated per CLAUDE.md); pytest green (urls, slots including quiet hours across midnight and daily cap, labels, device actions, ICS, RRF); create_indexes reports both indexes queryable plus the $rankFusion result; simulate_shortcut (fake) prints a menu and an event at the right local time.
2. Real propose (worker, yt-dlp, planner). PASS: simulate_shortcut on every fixture: the recipe's first option is a future weeknight 6:30 pm slot with groceries; the event's start matches its caption date; the meme gives actionable false and menu ["Remind me in a week", "Just save"]; a second share gives duplicate; median time from save to proposal printed and compared with PROPOSAL_WAIT_SECONDS. If Instagram blocks without cookies, record it in BLOCKERS.md, continue the rest of the phase with sample-style cached input, and keep going.
3. Enrich. PASS: every fixture that downloads reaches ready; the speech-only reel has a transcript; a phrase that is only spoken in a reel finds it through /api/search; client.files.list() shows none of the uploaded files; agent_runs show propose and enrich runs.
4. Web core (DESIGN.md): plans, library, save detail, Ask, settings, setup, agent trace. PASS: webapp-testing screenshots at 390x844 and 1440x900 for every screen and state in DESIGN.md section 9, saved to screenshots/phase4/, reviewed against the DESIGN.md checklist and fixed; 3 queries from queries.csv return the expected card in Ask.
5. Demo mode. PASS: build_samples done; with the worker stopped, in a fresh logged-out browser: landing → Try the demo → save a sample → steps print → Add → toast and Plans shows it → an Ask chip returns cards. Repeat with an invalid GEMINI_API_KEY: the cached fallback still produces a ticket.
6. Ship files: Dockerfiles, compose, Caddyfile, README.md (UTF-8: video and demo links as TODO, what it does, architecture diagram, local run, deploy, one section per prize with file paths, accuracy method linking eval/results.md, no invented numbers, TODO for the real saved-count stat), shortcut/README.md, .env.example. PASS: `docker compose config` validates; `docker compose build` succeeds if Docker is installed.
7. Eval. PASS: eval/results.md written from a real run.
8. Stretch, only if 1 to 7 pass: /api/map clusters ready embeddings (scikit-learn AgglomerativeClustering, cosine metric, average linkage, distance_threshold 0.45; singletons go to "Other"), names clusters with one GEMINI_MODEL_FAST call, edges to each node's top 2 neighbors with cosine ≥ 0.75, cached per user and save count; /map with react-force-graph-2d, clusters first, layout frozen after cooldown, nodes from the last Ask answer highlighted.

## 21. Out of scope
TikTok and other platforms, the Instagram API, native iOS app, Android share target, Web Push, Google Calendar OAuth, location reminders, voice input, recommendations, price alerts, bulk import from the Instagram export, collaboration, payments, dark mode, offline mode.
