# CLAUDE.md

Read SPEC.md and DESIGN.md before any change. SPEC.md wins on behavior, DESIGN.md wins on UI. The product is **Reelize**; all user-facing text uses APP_NAME. Never build from docs/archive/ or prototype/ (history only, but read them in phase 0).

## Stack (no substitutes; ask in BUILD_LOG.md before adding any dependency not listed)
- server/: Python 3.12, FastAPI, uvicorn[standard], pymongo (sync), dnspython, google-genai, pydantic v2, pydantic-settings, yt-dlp[default], httpx, Pillow, numpy, tzdata, pytest. scikit-learn only for the stretch map.
- web/: Next.js (App Router, TypeScript), Tailwind, shadcn/ui restyled to DESIGN.md tokens, motion (Framer Motion) only for the 3 motion moments, lucide-react, swr, qrcode.react. react-force-graph-2d only for the stretch map.
- Infra: Docker Compose + Caddy on a Vultr VPS. MongoDB Atlas M0.

## Skills
- gemini-api-dev: read before writing any Gemini code (model names, thinking settings, manual function-calling loop, File API, embeddings, structured output). Use the google-genai SDK, never google-generativeai.
- mongodb-schema-design: collections and indexes.
- mongodb-search-and-ai: Vector Search, Atlas Search, $rankFusion.
- frontend-design: all UI work. DESIGN.md overrides its aesthetic defaults.
- webapp-testing: screenshots at 390x844 and 1440x900 at the end of every phase that touches UI.
- beli-inspired-ui: the look the owner asked for on 2026-11-14 ("aesthetic like Beli"). Read it before designing or restyling a screen. No restyle until the owner says go.
- web-design-guidelines: a review pass on changed UI files (accessibility, focus, forms, touch, safe areas) before UI work is called done.

## Rules
- No hardcoded secrets, keys, URLs or model names. Server reads everything through server/realize/config.py; the web app reads runtime values from GET /api/config.
- Gemini models: .env has GEMINI_MODEL_FAST and GEMINI_MODEL_VIDEO set to gemini-3.8-flash. In phase 1, confirm with client.models.list() that the ID exists for this key. If it doesn't, use the newest non-Lite Flash ID that is listed (fallback gemini-3.5-flash), update .env, and log it. Never use Lite for GEMINI_MODEL_FAST. Never use rumored codenames. Do not change any other .env value.
- LLM decides, code executes: dates, free slots, menu labels and device actions are computed in code (SPEC section 8).
- Every database query filters by user_id taken from the API key, never from a request body.
- Never invent numbers, stats or accuracy figures anywhere (UI, README, comments). Only measured numbers, with the command that produced them.
- Use real reels from fixtures/ for tests and screenshots. No lorem ipsum, no fake reels.
- Copy: sentence case, no em dashes, no "Sorry", no all-caps labels. Never use: spearheaded, leveraged, pivotal, intricate, showcasing, synergy, delve, realm, robust, orchestrated, streamlined, transformative, seamless, game-changer.
- The dev machine is Windows. Tooling is Python scripts (cross-platform), not bash or PowerShell scripts. Create files with your file tools, never with shell redirection. All files UTF-8 with LF. Venv python: server/.venv/Scripts/python.exe.
- Build in SPEC.md section 20 phase order. A phase is done only when its PASS check has run for real. Commit after each phase ("phase N: <name>") and push the branch.

## Never stop
- Never stop to ask a question during the build. Make the most reasonable call, write it in BUILD_LOG.md with one line of why, and continue.
- If a PASS check fails twice the same way: write the failure, what you tried and the next thing to try in BLOCKERS.md; make the smallest change that keeps the end-to-end path working (a spec fallback, PLANNER_MODE=fake, or a stub clearly marked TODO); commit; move to the next phase. Return to BLOCKERS.md after phase 7.
- Keep the end-to-end path (save, proposal, confirm, Plans, Library, Ask, demo) working at every commit.
- Never commit .env, secrets/, cookies, videos or screenshots.
- Anything you can't do (iPhone Shortcut, DNS, Vultr) goes in a final "Manual steps" list for the human.
