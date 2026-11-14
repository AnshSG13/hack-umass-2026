# Blockers

Things that failed twice the same way, what was tried, and what to try next.
Open items are at the top. Resolved items move to the bottom with how they were fixed.

## Open

### 1. The Gemini key is on the free tier: 20 requests per day on the configured model
- **What happened (2026-11-14, about 04:45 EST).** During the phase 2 fixture run the planner started getting HTTP 429. The error body: `Rate limit exceeded for model gemini-3.6-flash (limit: 20 requests per day on Free Tier). Please retry in 22h5m19s`. `.env` sets `GEMINI_MODEL_FAST` and `GEMINI_MODEL_VIDEO` to `gemini-3.5-flash`, which the API serves as `gemini-3.6-flash`. One save costs at least two requests on that model (planner, then video), so the whole product gets about ten live saves a day on this key.
- **What else was tried.** One request each to the other models the key lists: `gemini-3.8-flash` and `gemini-3.7-flash` answered 503 "currently experiencing high demand"; `gemini-4-hydrogen` timed out at 25 s; `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` answered at first, then returned 503 and a 180 s timeout on video requests.
- **What the build does about it.** (a) The SDK's hidden retries are off and every Gemini call has a hard deadline, so a 429 can no longer stall the job queue (it did: two propose threads hung for 7 minutes). (b) Two optional settings, `GEMINI_MODEL_FAST_FALLBACKS` and `GEMINI_MODEL_VIDEO_FALLBACKS`, list models to try when the main one answers 429 or 503; a model that fails is skipped for a while. The dev processes run with `gemini-3.8-flash,gemini-3.7-flash` (fast) and `gemini-3.5-flash-lite,gemini-3.1-flash-lite` (video) passed as real environment variables. `.env` was not edited and no Lite model is used for the planner or Ask. (c) No request is spent on probing the thinking level any more. (d) A rate-limited propose job retries after 8 s and 25 s before using the deterministic fallback. (e) The planner now gets `find_free_slot` and `search_saves` results up front and can finish in one model call instead of two or three. (f) `build_samples` reuses reels that are already enriched and falls back to a code-derived cached plan.
- **Effect on the PASS checks.** Phase 2 and 3 ran for real on 5 saves (4 distinct recipe reels) before the quota ran out; the remaining 12 fixtures are being retried in the background. Until quota returns, live saves get the deterministic fallback plan and Ask answers "Ask didn't answer. Try again." The demo path does not depend on Gemini and works.
- **Next thing to try (needs a human).** Turn on billing for the Gemini API key (or use a key from a paid project), then rerun `python -m scripts.run_fixtures --wait-enrich`, `python -m scripts.build_samples --plans-only` and `python -m scripts.eval_recall`. If staying on the free tier for the demo, set the two fallback variables in `.env` so a busy model doesn't stop the planner.

### 2. Save to proposal is close to the Shortcut's 20 second wait on this key
- **Measured.** First live run (two model turns): 21.0 s from POST /api/save to the proposal, 17.8 s of it in the worker (yt-dlp metadata 1.5 s, first model turn 4 s, second model turn 9 s). Two of five planner runs in the fixture run hit the 15 s planner budget and fell back.
- **Tried.** Trimmed the fields the planner writes at propose time (the video pass fills in the rest), moved the caption embedding after the status flip, removed the per-process thinking probe, and precomputed the two tool calls so one model turn is enough.
- **Not yet verified.** The one-turn planner has not been timed over the full fixture set because of blocker 1. Rerun `python -m scripts.run_fixtures` when quota returns; it prints the median next to PROPOSAL_WAIT_SECONDS.

## Resolved

_None yet._
