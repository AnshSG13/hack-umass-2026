# Search recall

- Date: 2026-11-14 17:15 UTC
- Command: `python -m scripts.eval_recall` (from `server/`)
- Hybrid mode: rankfusion (vector weight 0.6, text weight 0.4)
- Embedding model: gemini-embedding-001, 768 dimensions
- Library searched: 16 reels from the sample cache
- Queries scored: 20 of 20 in `fixtures/queries.csv`
- hit@1: 20/20 (100%)
- hit@3: 20/20 (100%)

A hit means the expected reel is at that rank or better in the hybrid search results.
The set is small, so read these as a smoke test, not a benchmark.

| query | expected | rank | top 3 |
|---|---|---|---|
| let the fridge do the rest dessert | DfYi19kRNT0 | 1 | DfYi19kRNT0, Dfs7pYmMFOy, Dfiz45_R-M_ |
| tiramisu without mascarpone | DfYi19kRNT0 | 1 | DfYi19kRNT0, DfkgVpfAb1S |
| crush peppercorns with a rolling pin | DfTLDelM0PL | 1 | DfTLDelM0PL, DffyhrWijBQ |
| cheap chicken dinner with a pepper cream sauce | DfTLDelM0PL | 1 | DfTLDelM0PL, DfYi19kRNT0, Dfiz45_R-M_ |
| lonely bag of spinach in the freezer | Dfs7pYmMFOy | 1 | Dfs7pYmMFOy, DffyhrWijBQ, DfTLDelM0PL |
| what can I make with canned chickpeas and coconut milk | Dfs7pYmMFOy | 1 | Dfs7pYmMFOy, DfYi19kRNT0 |
| holiday appetizer with brie and puff pastry | Dfiz45_R-M_ | 1 | Dfiz45_R-M_, Dfppln1HOfa |
| pomegranate pistachio bites | Dfiz45_R-M_ | 1 | Dfiz45_R-M_ |
| Carrie the musical tickets | Dfdq6Vvjm1U | 1 | Dfdq6Vvjm1U |
| holiday train show at the botanical garden | Dfppln1HOfa | 1 | Dfppln1HOfa, Dfiz45_R-M_, Dfdq6Vvjm1U |
| best new restaurant in Greenwich Village | DfmpjJVNa85 | 1 | DfmpjJVNa85, DfkgVpfAb1S, Dfppln1HOfa |
| winter pool house a ferry ride from Manhattan | DfkgVpfAb1S | 1 | DfkgVpfAb1S, DfYBJN-yVsl |
| light weight sculpt workout | DfkqMXeyo3S | 1 | DfkqMXeyo3S, DfiT7-QxmY- |
| prenatal walking cardio | DfiT7-QxmY- | 1 | DfiT7-QxmY- |
| which curling iron should I buy | Dfik_KdjOO5 | 1 | Dfik_KdjOO5, DfTLDelM0PL |
| rolling tote bag compared with the Costco one | DffyhrWijBQ | 1 | DffyhrWijBQ, DfTLDelM0PL, Dfs7pYmMFOy |
| exercise and cold to focus and learn better | DfYBJN-yVsl | 1 | DfYBJN-yVsl, DfVopoLoTbN, DfmpjJVNa85 |
| best advice Huberman ever got | DfVopoLoTbN | 1 | DfVopoLoTbN, DfYBJN-yVsl, DfmpjJVNa85 |
| great pyrenees puppy | DfqZ2hUzlea | 1 | DfqZ2hUzlea, Dfq1HqRsMUn, DfmpjJVNa85 |
| rescue dog with big ears | Dfq1HqRsMUn | 1 | Dfq1HqRsMUn, DfqZ2hUzlea, DfmpjJVNa85 |
