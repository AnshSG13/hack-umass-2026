# Blockers

Things that failed twice the same way, what was tried, and what to try next.
Open items are at the top. Resolved items move to the bottom with how they were fixed.

## Open

### 1. Docker Desktop on the dev laptop crashes on every start
- **What happens.** The backend stops with "remove ...\Docker\run\dockerInference: The file cannot be accessed by the system". The unix socket files Docker Desktop 4.86 leaves in `%LOCALAPPDATA%\Docker\run` and `%LOCALAPPDATA%\docker-secrets-engine` can't be deleted once it has stopped, so the next start fails. A socket made and closed by a test program in a temp folder deleted fine, so it is specific to how Docker leaves them.
- **Workaround.** Quit Docker Desktop, rename both folders (they can't be deleted), start it again. The engine came up in about 15 seconds. It has to be repeated before each start.
- **Scope.** Only this Windows laptop. The Linux VPS doesn't use Docker Desktop.
- **Next.** Update Docker Desktop or reset it to factory defaults (the human's call; a reset removes local images).

## Resolved

### Sample plans rebuilt with the live models (2026-11-15)
- `python -m scripts.build_samples --no-reuse`: built 16, failed 0, and 0 plans are code-written now. The Somssi reel is typed `place`.
- `python -m scripts.run_fixtures --wait-enrich`: 16 of 16 typed as expected. Save to plan took 3.9 to 6.7 s, median 4.75 s, against PROPOSAL_WAIT_SECONDS=20. The first run did 10 reels before the per-key save limit (20 a minute; each fixture saves twice to test duplicates); the other 6 ran one at a time on one test account.
- `python -m scripts.eval_recall`: hit@1 19/20, hit@3 20/20 (eval/results.md). The miss: "let the fridge do the rest dessert" ranks the tiramisu second, behind the curry, whose new title is "Fridge Cleanout Chickpea Curry".
- Two side effects, both fixed: the rebuild replaced whole sample records, which dropped the demo story's prebuilt chat and trip (put back from a demo session's copy and a backup), and it deleted old thumbnails that 810 demo saves still used (pointed at the new ones). `build_samples` now keeps the story fields and moves saves to a new thumbnail before deleting the old one.

### Gemini quota, proposal time and Ask (2026-11-14, after credit was added)
The key was on the free tier (20 requests a day per model), then out of prepaid credit (HTTP 402). Credit landed at about 17:25 UTC. Measured after that, with `gemini-3.5-flash` for every role:
- **A brand-new reel through the whole live path** (`/reel/DflTpMpigO7/`, not in the sample cache): `POST /api/save` answered with the plan in 6.8 s, against the Shortcut's 20 s wait. Steps: caption 1.4 s, one planner call. The video pass took 12.0 s; the save was `ready` at 26.7 s with the plan updated from 3 to 10 groceries.
- **A cached reel with the live planner:** proposal in 4.2 s.
- **Ask:** three questions from `fixtures/queries.csv` on a demo account each returned the expected card with a high-confidence answer, in 3.7 to 5.7 s (first step line at 0.8 to 3.2 s). This is the phase 4 check "3 queries return the expected card in Ask".
- The safeguards from the outage stay in: SDK retries off, hard deadlines, fallback model lists, cooldowns, job retries, the one-call planner and the code fallback plan.

### `docker compose build` and the stack in containers (2026-11-14)
- `docker compose build` built `realize-api`, `realize-worker` (1.15 GB each, Python 3.12 with ffmpeg) and `realize-web` (397 MB). No `.env` is inside the images.
- `docker compose up` with a local override (Caddy on plain http port 8080, `DOMAIN=:80`) ran all four services. Through Caddy: `/api/health` ok with the container's worker seen, all seven pages HTTP 200, and the demo-flow script passed 22 of its 23 checks (sample save to proposal median 3.8 s). The one miss was the script reading the share link from the wrong field.
- Not verified: Caddy with a real domain and certificates, which needs the VPS and DNS.
