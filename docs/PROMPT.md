Build Realize end to end from SPEC.md and DESIGN.md, following CLAUDE.md. The product name is Realize; all user-facing text uses APP_NAME.

Already in place: .env at the repo root (Atlas URI, Gemini key, model names, cookies path set or blank), fixtures/reels.csv, fixtures/queries.csv (may be partial), and five skills in .claude/skills.

Run without stopping:
1. Read CLAUDE.md, SPEC.md and DESIGN.md completely.
2. Do phase 0 (SPEC section 20): git fetch, inspect every branch, commit and folder, including anything my teammates pushed since the spec was written. Reuse what matches, archive what doesn't, never delete their work. Merge the latest main. Write BUILD_LOG.md. Before every later phase, fetch again and merge main if it moved.
3. Run scripts/check_models.py in phase 1 and fix .env model names per CLAUDE.md if needed.
4. Build phases 1 to 7 in order. Run every PASS check for real against Atlas, Gemini and Instagram. Commit after each phase and push the branch.
5. Follow the "Never stop" rules in CLAUDE.md: no questions, no stopping on bugs. Log decisions in BUILD_LOG.md, failures in BLOCKERS.md, and keep the end-to-end path (save, proposal, confirm, Plans, Library, Ask, demo) working at every commit using the spec's fallbacks.
6. Keep the API, worker and web dev server running in the background. Use scripts/simulate_shortcut.py for the Shortcut contract and webapp-testing for screenshots.
7. After phase 7, work through BLOCKERS.md, then phase 8 if time allows.
8. Finish with a report: each phase's PASS output, open BLOCKERS.md items, measured latencies (save to proposal, enrich), eval hit@1 and hit@3, and the manual steps left for me (Shortcut, Vultr, DNS).
