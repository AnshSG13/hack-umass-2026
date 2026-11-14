# Merging `feature/subcategories` into `realize-build`

Sub-categories: each save gets one short label inside its type, as the mockup shows it
("Food › Thai", "Food › Dessert"). This branch is independent of `feature/email-login`.
Either can be merged first.

## 1. Merge it

**On GitHub:** open
https://github.com/AnshSG13/hack-umass-2026/compare/realize-build...feature/subcategories,
click **Create pull request**, then **Merge pull request**.

**Or on the command line:**

```
git checkout realize-build
git pull origin realize-build
git merge --no-ff origin/feature/subcategories
git push origin realize-build
```

If `feature/email-login` is merged first, expect small conflicts in these files. Keep both
sides of each:

- `web/lib/types.ts`: login adds `email` to `Me`; this branch adds `subcategory` to `Ticket`,
  `SavePatch` and `Taste`.
- `BUILD_LOG.md`: keep both entries.
- `scripts/backfill_subcategories.py --email` only works once login is merged, because that's
  what adds emails. `--user u_...` and `--all-users` work either way.

Then run `cd web && npx tsc --noEmit && npx eslint app components lib` and
`cd server && python -m pytest -q`.

## 2. After merging (one time)

```
cd server
.venv\Scripts\Activate.ps1
python -m scripts.create_indexes                        # adds the (user, type, subcategory) index
python -m scripts.backfill_subcategories --all-users    # labels saves made before this change
python -m scripts.backfill_subcategories --samples      # labels the demo samples, if built
```

The backfill makes one cheap text call to Gemini per account and type, with no video. Add
`--dry-run` to see the labels first. Restart the worker so the video pass uses the new prompt.
There are no new dependencies and no new `.env` values.

## 3. How it works

- **Assigned while reading, with no extra Gemini calls.** The planner (`propose_plan`) and the
  video pass (`ENRICH_SCHEMA`) each return a `subcategory`. Both see the account's existing
  labels (`EXISTING SUB-CATEGORIES: recipe: Dessert, Thai; ...`) and are told to reuse one when
  it fits.
- **Kept consistent by code** (`server/realize/subcats.py`): the label is tidied
  ("dessert" → "Dessert", "#thai" → "Thai"), labels longer than 4 words or 32 characters are
  dropped, and a label is snapped onto an existing one that differs only in case,
  punctuation or a plural ("Desserts" → "Dessert").
- **People can change it.** On the save page, the chip reads "Food › Dessert". Tapping it opens
  File under, which lists the account's sub-categories, has a box for a new one, and offers "No
  sub-category". A label set by hand is marked `user_edited`, so the planner and video pass
  never overwrite it. Moving a save to another type clears its sub-category.
- **Shown in:** the Home taste tile (the "subs" row the mockup has, which showed tags until
  now; it still falls back to tags), a second chip row in Library when a type is picked
  (`?type=recipe&sub=Dessert`), and "Food › Dessert" on every list row.
- **API:** tickets carry `subcategory`. `GET /api/tastes` adds `subcategories: [{name, count}]` per
  type. `GET /api/saves` and `GET /api/search` take `sub`, used together with `type`.
  `PATCH /api/saves/{id}` takes `subcategory`, where `""` removes it. Demo samples copy
  `enrichment.subcategory`.

## 4. How it was tested

- Three real reels saved one after another, with Gemini live: tiramisu → Dessert, chickpea
  curry → Curry, pomegranate brie bites → Appetizers. Each label came from the planner within
  about 7 to 11 seconds, and the video pass kept it.
- Against the running API, 11 of 11 checks passed. "desserts" snaps onto "Dessert", a
  too-long label is refused, the tastes counts are right, `?sub=` filters the list and search,
  the video pass leaves a hand-set label alone, changing the type clears the label, and `""`
  removes it.
- In the browser at 390x844: the Home tile shows Appetizers, Curry and Dessert; the Library
  sub-chips filter correctly; the save page chip reads "Food › Curry"; and adding
  "weeknight dinners" saves "Weeknight dinners".
- The backfill labelled two older saves (Dessert, Budget Dinners).
- `pytest` (77, including 4 new in `tests/test_subcats.py`), `tsc` and `eslint` pass.

Not tested: the demo samples, because the dev Atlas database has none built yet.

Once merged and checked, this file can be deleted.
