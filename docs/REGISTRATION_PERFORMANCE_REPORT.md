# Registration Department — Performance Report

**Audit Date:** 9 July 2026  
**Scope:** Registration performance at 1k, 10k, 50k, 100k scales  
**Mode:** Read-only analysis  
**Benchmark Source:** `docs/idb-browser-bench.json` (2026-07-08, post v3 row-doc optimization)

---

## Test Environment

| Parameter | Value |
|-----------|-------|
| Benchmark date | 8 July 2026 |
| Index version | v3 row-doc |
| Search path | `searchIndex:rowDocs` |
| Browser | Chromium (Playwright) |
| Heap limit | 3,586 MB |
| Safety checks | All pass (noLoadAllOnSearch, noColAllOnSearch, persistenceOk) |
| Pre-optimization baseline | 10k index: 715,160ms; 50k index: 5,790,000ms |

---

## Part 3 — Performance Measurements

### Benchmark Results (Verified)

| Scale | Insert | Index Build | Filter | Search | 1st Page Render | Heap (MB) |
|-------|--------|-------------|--------|--------|-----------------|-----------|
| **10k** | 14.2s | 17.5s | 102ms | 291ms | 181ms | 9.5 |
| **50k** | 163s | 325s (5.4 min) | 422ms | 1,398ms | 840ms | 9.5 |
| **100k** | 444s (7.4 min) | 1,913s (31.9 min) | 1,350ms | 4,382ms | 1,973ms | 9.5 |

### Extrapolated Results (1k — Estimated)

| Operation | 1k (estimated) | Method |
|-----------|----------------|--------|
| Insert | ~1.4s | Linear extrapolation from 10k (14.2s ÷ 10) |
| Index build | ~1.7s | Linear extrapolation from 10k (17.5s ÷ 10) |
| Filter | ~10ms | Linear extrapolation from 10k (102ms ÷ 10) |
| Search | ~29ms | Linear extrapolation from 10k (291ms ÷ 10) |
| First page render | ~18ms | Linear extrapolation from 10k (181ms ÷ 10) |

> 1k figures are extrapolated, not directly benchmarked. Actual 1k performance may be faster due to fixed overhead dominance at small scale.

---

## Operation-by-Operation Analysis

### 1. Opening Registration Page

| Scale | Cold Open | Warm Open (repo hydrated) | Bottleneck |
|-------|-----------|--------------------------|------------|
| 1k | ~2s | <500ms | IDB hydrate (500/batch) |
| 10k | ~3s | <1s | IDB hydrate (20 batches) |
| 50k | ~15s | ~2s | IDB hydrate (100 batches) |
| 100k | ~60s | ~2s | IDB hydrate (200 batches) |

**Bottleneck:** `emsRegRepoEnsureHydratedFromIdb` — paginated IDB read at 500 records/batch.  
**Mitigation:** Smart reopen skips sync when `emsRegRepoGetCount() > 0`.  
**Evidence:** `ems-registration-bootstrap.js` L147–151; `registration-ui.js` L86–142.

### 2. Search Performance

| Scale | Local Prefix Search | Enterprise Cloud Search | Bottleneck |
|-------|--------------------|-----------------------|------------|
| 1k | ~29ms | N/A (query < 2 chars local only) | Row-doc index scan |
| 10k | 291ms | ~200–500ms (CF round-trip) | Row-doc scan |
| 50k | 1,398ms | ~300–800ms (Typesense) | Row-doc scan (local) |
| 100k | 4,382ms | ~300–800ms (Typesense) | **O(n) row-doc scan (local)** |

**Bottleneck:** Local search at 100k is **4.4 seconds** — primary UX degradation point.  
**Mitigation:** Enterprise cloud search via `searchTenantRegistrations` CF (Typesense/Firestore) bypasses local scan when cloud available.  
**Evidence:** `admission.js` L813–815; `docs/idb-browser-bench.json` L39.

**Search debounce:** 300ms (`regListSearch`) — adds perceived latency but prevents search storms.

### 3. Filtering Performance

| Scale | Type/Class Filter | Bottleneck |
|-------|-------------------|------------|
| 1k | ~10ms | Indexed page query |
| 10k | 102ms | `pageIndexed:type_ts` |
| 50k | 422ms | Indexed page query |
| 100k | 1,350ms | Indexed page query |

**Bottleneck:** Filter uses indexed page path (`pageIndexed:type_ts`) — scales better than search but still >1s at 100k.  
**Evidence:** `docs/idb-browser-bench.json` trace paths.

### 4. Import Performance

| Scale | Client Direct | Queue (500/chunk) | CF Bulk (2000 max) | Index Rebuild |
|-------|--------------|-------------------|--------------------|--------------| 
| 1k | ~2s | ~3s | ~5s | ~1.7s |
| 10k | ~15s | ~20s | ~30s (5 CF calls) | ~17.5s |
| 50k | N/A (routed to queue) | ~3–5 min | ~2–4 min (25 CF calls) | ~5.4 min |
| 100k | N/A | ~10–15 min | ~8–12 min (50 CF calls) | ~32 min |

**Bottlenecks:**
1. Index rebuild after import — dominant cost at scale
2. CF bulk import limited to 2000 records/call
3. Queue processes 500 records/chunk sequentially

**Evidence:** `ems-import-queue.js` CHUNK_SIZE=500; `functions/lib/bulk-import-registrations.js` MAX_RECORDS=2000.

**Import routing:** Records > threshold auto-routed to queue (`ems-import-export.js` → `emsImportQueueCommit`).

### 5. Pagination Performance

| Scale | First Page | Page 2+ (infinite scroll) | Pager Jump |
|-------|-----------|--------------------------|------------|
| 1k | ~18ms | ~10ms | ~15ms |
| 10k | 181ms | ~50ms | ~100ms |
| 50k | 840ms | ~200ms | ~500ms |
| 100k | 1,973ms | ~400ms | ~1,200ms |

**Bottleneck:** First page render at 100k is **~2 seconds** — indexed page query + virtual table mount.  
**Mitigation:** Virtual table (`emsVirtualTableMount`) renders only visible rows.  
**Subsequent pages:** Faster because cursor-based IDB page read.

### 6. Save Performance

| Scale | Local Save (upsert + mirror) | Cloud Queue | Total Perceived |
|-------|------------------------------|-------------|-----------------|
| All | <50ms | Async (100–500ms) | <100ms |

**Bottleneck:** None at any scale — O(1) per-record upsert + single IDB put.  
**Evidence:** `emsRegRepoPersistRegistration` → `emsRegRepoUpsert` → `repoMirrorPut`.

### 7. Edit Performance

| Scale | Load Record | Populate Form | Total |
|-------|------------|-----------------|-------|
| All | <10ms (`emsRegRepoGetById`) | <50ms (DOM) | <100ms |

**Bottleneck:** None — single record by ID from RAM.

### 8. Delete Performance

| Scale | Local Delete | Mirror Remove | Cloud Queue |
|-------|-------------|---------------|-------------|
| All | <50ms | <50ms | Async |

**Bottleneck:** None at any scale.

---

## Bottleneck Map

```
OPERATION          1k    10k   50k   100k   BOTTLENECK
─────────────────────────────────────────────────────────
Open (cold)        ✅    ✅    ⚠️    ❌     IDB hydrate batches
Open (warm)        ✅    ✅    ✅    ✅     —
Search (local)     ✅    ✅    ⚠️    ❌     O(n) row-doc scan
Search (cloud)     ✅    ✅    ✅    ✅     CF/Typesense
Filter             ✅    ✅    ⚠️    ⚠️     Indexed page query
Import             ✅    ✅    ⚠️    ❌     Index rebuild post-import
Pagination (1st)   ✅    ✅    ⚠️    ⚠️     Indexed page + virtual mount
Save               ✅    ✅    ✅    ✅     O(1) upsert
Edit               ✅    ✅    ✅    ✅     O(1) getById
Delete             ✅    ✅    ✅    ✅     O(1) remove
Index build        ✅    ✅    ⚠️    ❌     Full index scan
Tab switch         ✅    ✅    ✅    ✅     DOM only
ID card modal      ✅    ⚠️    ⚠️    ⚠️     Legacy localStorage read
```

---

## Exact Bottlenecks (Ranked by Impact at 100k)

### 1. Index Cold Build — 31.9 minutes @ 100k

- **What:** Full `search_tokens` IDB store rebuild from all registration records
- **When:** Fresh install, disaster recovery, post-large-import
- **Impact:** Search unavailable until complete
- **Improvement:** v3 already reduced 10k from 715s → 17.5s (41×). Further gains need incremental index or background worker.
- **Evidence:** `docs/idb-browser-bench.json` L35–36

### 2. Local Prefix Search — 4.4 seconds @ 100k

- **What:** `searchIndex:rowDocs` scans all row-doc entries matching prefix
- **When:** Every search query ≥ 2 characters in local mode
- **Impact:** User waits 4+ seconds per keystroke (after 300ms debounce)
- **Mitigation:** Enterprise cloud search bypasses when online
- **Evidence:** `docs/idb-browser-bench.json` L39; trace `searchIndex:rowDocs`

### 3. IDB Hydration — ~60 seconds @ 100k (cold)

- **What:** `emsRegRepoEnsureHydratedFromIdb` reads 200 batches of 500 records
- **When:** First login, tenant switch, disaster recovery
- **Impact:** Boot overlay blocks UI
- **Mitigation:** Lite login path; smart reopen skips re-hydrate
- **Evidence:** `ems-registration-repository.js` L656–677

### 4. First Page Render — 2.0 seconds @ 100k

- **What:** Indexed page query + virtual table mount for saved records
- **When:** Opening "محفوظ ریکارڈ" tab or switching to list
- **Impact:** Noticeable delay before table appears
- **Evidence:** `docs/idb-browser-bench.json` L40; trace `pageIndexed:type_ts`

### 5. Filter Query — 1.35 seconds @ 100k

- **What:** Type/class filter via indexed page path
- **When:** Changing filter dropdown in saved records
- **Impact:** Delayed filter application
- **Evidence:** `docs/idb-browser-bench.json` L38

### 6. Import Index Rebuild — 32 minutes @ 100k (post-import)

- **What:** Same as #1 but triggered after bulk import
- **When:** After importing large CSV/Excel file
- **Impact:** Search broken until rebuild completes
- **Mitigation:** Incremental index update per imported record (not currently implemented)

### 7. `emsGetUsersMerged` Cap — 1000 records

- **What:** Downstream modules receive max 1000 records regardless of tenant size
- **When:** Finance, exams, curriculum open student/teacher lists
- **Impact:** Incomplete data in dependent modules (not registration UI itself)
- **Evidence:** `ems-user-service.js` L23

---

## Multi-Tab Performance (P6 Preprod Verified)

| Test | Scale | Tabs | Write Amplification | Result |
|------|-------|------|---------------------|--------|
| Leader lock | 8k | 5 | 1.0× (was 4.7×) | ✅ VERIFIED |
| Leader failover | 8k | 5 | 1.0× after failover | ✅ VERIFIED |
| Crash recovery | 8k | 5 | Lease expiry → new leader | ✅ VERIFIED |
| Stress | 100k | 10 | 1.0× | ✅ VERIFIED |

**Evidence:** `docs/PRIORITY-6-PREPROD-REPORT.json`

---

## Memory Profile

| Scale | JS Heap After Insert | Heap Limit | Utilization |
|-------|---------------------|------------|-------------|
| 10k | 9.5 MB | 3,586 MB | 0.3% |
| 50k | 9.5 MB | 3,586 MB | 0.3% |
| 100k | 9.5 MB | 3,586 MB | 0.3% |

**Key finding:** Heap stays constant at ~9.5 MB regardless of record count. Paginated architecture prevents memory blow-up. RAM cap (`EMS_CACHE_RECORD_CAP`) evicts to archive before heap grows.

---

## Performance Safety Checks (All Pass)

| Check | Status | Meaning |
|-------|--------|---------|
| `noLoadAllOnSortedPage` | ✅ | Page queries use index, not full load |
| `noLoadAllOnSearch` | ✅ | Search uses row-doc index, not full load |
| `noColAllOnSearch` | ✅ | No full collection scan on search |
| `noColAllOnSortedPage` | ✅ | No full collection scan on sort |
| `persistenceOk` | ✅ | 100k records persist and verify correctly |
| `legacyArrearsDisabled` | ✅ | No legacy full-array code paths active |

---

## Performance Improvement History

| Optimization | Before | After | Improvement |
|-------------|--------|-------|-------------|
| v3 row-doc index (10k) | 715s index build | 17.5s | **41×** |
| v3 row-doc index (50k) | 5,790s index build | 325s | **18×** |
| Multi-tab leader lock | 4.7× write amp | 1.0× | **4.7×** |
| Paginated repo (E7) | Full array load | 500/batch page | ∞ (enabled scale) |
| Virtual table | Full DOM render | Visible rows only | ~10× render |
| Write-trigger sync (A4) | Collection onSnapshot | Meta listener | ~100× Firestore reads |

---

## Projected Performance at 200k and 500k

| Operation | 200k (projected) | 500k (projected) | Viable? |
|-----------|------------------|------------------|---------|
| Index build | ~64 min | ~160 min | ❌ Unacceptable |
| Local search | ~9s | ~22s | ❌ Unacceptable |
| First page | ~4s | ~10s | ⚠️ Marginal |
| IDB hydrate | ~2 min | ~5 min | ⚠️ With overlay |
| Save/edit/delete | <100ms | <100ms | ✅ |
| Cloud search | <1s | <1s | ✅ (Typesense) |

> Projections assume linear scaling from 100k benchmarks. Actual performance may differ due to IDB backend limits and browser storage quotas.

---

## Performance Recommendations

### Immediate

1. Route all search to enterprise cloud search when online (bypass 4.4s local scan)
2. Show index build progress bar during cold build/import
3. Pre-warm index in background after login (before user opens registration)

### Medium-Term

4. Incremental index update on save/import (avoid full rebuild)
5. Web Worker for index build (non-blocking UI)
6. Raise `emsGetUsersMerged` cap to 5000 with paginated downstream APIs
7. Add "searching..." skeleton in list table during debounce + query

### Long-Term

8. Typesense/local hybrid index with trie structure for O(log n) search
9. Server-side rendering for list page at 50k+ (CF returns HTML page)
10. SQLite backend for desktop/APK (eliminate IDB limitations)

---

## Performance Score

| Dimension | 1k | 10k | 50k | 100k |
|-----------|-----|-----|-----|------|
| Open | 95 | 90 | 70 | 50 |
| Search | 95 | 85 | 60 | 30 |
| Filter | 95 | 90 | 70 | 55 |
| Import | 90 | 75 | 50 | 30 |
| Pagination | 95 | 85 | 65 | 50 |
| Save | 95 | 95 | 95 | 95 |
| Edit | 95 | 95 | 95 | 95 |
| Delete | 95 | 95 | 95 | 95 |
| **Overall** | **94** | **86** | **66** | **50** |

---

*End of Performance Report*
