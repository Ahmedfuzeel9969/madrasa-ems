# Incremental Search Index Build — P5B Engineering Fix

**Date:** 2026-07-08  
**Status:** Implemented (v3 row-doc index + write optimization)

## Problem

`emsIdbSearchIndexEnsure` performed a **full blocking rebuild**: clear entire token store → `emsIdbColAll` (load all rows into RAM) → sequential batch puts. At 10k rows this took ~11 minutes; at 50k ~96 minutes — unacceptable for startup and large institutions.

Profiling confirmed the bottleneck was **IDB put volume**, not token CPU or record reads (~200k puts @ 10k, ~99.9% of build time).

## Solution (hybrid v3)

### A. Fewer tokens per record (`ems-search-index.js`)

Field-aware tokenization: prefix ladder for `id` / `phone` / `cnic`; capped trigram sampling for text fields (~32 tokens/row vs unbounded trigram explosion).

### B. Token grouping — one IDB row doc per record (`ems-idb-engine.js`, `SEARCH_INDEX_VERSION = 3`)

Each search index entry stores `{ rowId, tokens: [...], type, status, class, _ts }` in a **single put** (`collection::@idx::rowId`). Search scans row docs via `col_row` cursor and matches all query tokens against the embedded array.

### C. Batch transactions (unchanged)

100 rows per readwrite transaction (~100 puts/tx).

### D. Incremental background build (unchanged)

`emsIdbSearchIndexProcessChunk` + `ems-search-index-bg.js` — cursor chunks, `lastPk` checkpoint, non-blocking startup.

### E. Version migration

When stored meta `version !== 3`, index is cleared and rebuilt safely.

### Partial search during build

When `meta.complete === false`, search uses **row-doc index ∪ cursor scan of unindexed tail** (`searchIndex:partial` trace path).

## Post-optimization profile (`docs/index-build-profile.json`)

| Scale | Index build (before) | Index build (after) | IDB puts (before) | IDB puts (after) |
|-------|----------------------|---------------------|-------------------|------------------|
| 1k    | ~70s (extrapolated)  | **176 ms**          | ~20k              | **1,000**        |
| 10k   | **~715 s (~12 min)** | **3,921 ms (~3.9 s)** | **~200k**     | **10,000**       |

**~182× faster @ 10k.** Do **not** re-run 50k/100k until a full production-path bench confirms similar gains.

## Verification

Re-run browser benchmarks after fix:

```bash
npx playwright test --config=playwright.index-profile.config.js
EMS_IDB_BENCH_SCALES=10000 npm run test:e2e:bench
```

100k only after 50k index build time is acceptable.

## Institution guidance

Large tenants should allow background index completion on first load; search works during partial build via tail scan.
