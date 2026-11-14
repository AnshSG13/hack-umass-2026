---
name: web-design-guidelines
description: Review web UI code against Vercel's Web Interface Guidelines (accessibility, focus, forms, touch, safe areas, motion, performance, copy). Use when asked to review or audit the UI, check accessibility, or before a UI change is called done. It reviews; it does not design.
metadata:
  source: https://github.com/vercel-labs/web-interface-guidelines
  pinned_commit: 434b7f91364665f2f733b310ec54809bf8f37937
  pinned_date: "2026-10-05"
---

# Web interface guidelines (review pass)

A checklist review for web UI code. Pair it with `frontend-design`, which sets the look, and `webapp-testing`, which takes the screenshots. This one catches what a screenshot doesn't show: missing labels, dead focus states, blocked paste, unsafe areas, janky transitions.

## How to use it

1. Read `references/web-interface-guidelines.md` in this folder. It is the full rule list and the output format.
2. Read the files to review. If none were named, review the files changed in the current work; if that is unclear, ask which files.
3. Check every rule that applies to the code in front of you.
4. Report findings grouped by file as `file:line - finding`, terse, most serious first. A file with nothing to report gets `✓ pass`.

The rules file is a pinned copy, so a review works offline and its rules don't change underneath the project. To update it, replace the file with the current `command.md` from the source repository, read the diff, and change `pinned_commit` and `pinned_date` above.

## Where this project overrides the rules

The project's own instructions win where they disagree:

- **Copy:** `CLAUDE.md` asks for sentence case, so ignore "Title Case for headings/buttons". Its other copy rules (no em dashes, no "Sorry", the banned word list) apply on top.
- **Quotes and ellipses:** follow what the codebase already does; don't flag straight quotes inside code, JSON or test strings.
- **Scope:** this is a phone-first web app in a 440 px column. Rules about virtualising very large lists, locale detection and dark mode only matter if the screen in question actually has that feature.

## Licence

The rules file is from `vercel-labs/web-interface-guidelines`, MIT licensed (see `references/LICENSE`). This wrapper was written for this project.
