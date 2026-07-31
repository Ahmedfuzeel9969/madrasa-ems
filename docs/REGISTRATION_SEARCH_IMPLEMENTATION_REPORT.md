# Registration Search Implementation Report

**Sprint:** 2 (Week 3–4)  
**Date:** 9 July 2026  
**Status:** ✅ COMPLETE  
**Scope:** Registration department only

---

## Goal

Fix the cloud search bypass bug so online users get sub-second search at scale, while preserving full offline local search. Add query caching, exact-ID fast path, and UI source indicator.

---

## Root Cause (Pre-Sprint 2)

When `regRepoActive()` was true, `regListSearch` cleared search state and called `renderRegTable()` → `emsRepo.page` local IDB scan. Enterprise cloud search (`searchTenantRegistrations` CF) existed but was never invoked on the default path.

**Benchmark baseline** (`docs/idb-browser-bench.json`):

| Scale | Local search |
|-------|-------------|
| 10k | 291ms |
| 50k | 1.4s |
| 100k | **4.4s** |

---

## Changes Implemented

### 1. `cloud/ems-enterprise-search.js`

| Change | Detail |
|--------|--------|
| `emsRegSearchRouter(query, opts)` | **New** tiered router: exact ID → cache → cloud → local fallback |
| `exactIdSearch()` | Fast path for `STD-` / `TCH-` / `STF-` via `emsRegGetRecordById` |
| Query cache | 60s TTL, max 10 entries per tenant |
| `isOnlineSearchPreferred()` | Respects `EMS_REG_FORCE_LOCAL_SEARCH`, `EMS_OFFLINE_ONLY`, `navigator.onLine` |
| `emsEnterpriseSearchGetSource()` | Returns `typesense`, `firestore`, `cache`, `id-direct`, `local-index`, or `none` |
| `emsEnterpriseSearchClear()` | Clears source + repo search overlay |

**Router flow:**
```
emsRegSearchRouter(query)
  → query < 2 chars: clear, return []
  → cache hit: applyRepoResults, source=cache
  → exact ID match: emsRegGetRecordById, source=id-direct
  → online: emsEnterpriseSearchRegistrations (CF), source=cloud
  → offline / CF fail: localIndexedSearch (delegates to emsRepo.page scan)
```

### 2. `ems-registration-repository.js`

| Change | Detail |
|--------|--------|
| `emsRegRepoIsSearchActive()` | **New** — true when cloud/local search results are in overlay |
| `emsRegRepoGetSearchResults()` | **New** — readonly copy of overlay rows |
| `emsRegRepoSetSearchResults()` | Existing — now used by router before render |
| `emsRegRepoClearSearch()` | Existing — cleared on short query or router reset |

### 3. `admission.js`

| Site | Before | After |
|------|--------|-------|
| `regListSearch` | `regRepoActive()` → local IDB scan only | Always calls `emsRegSearchRouter` when query ≥ 2 |
| Debounce | 300ms fixed | 80ms for exact ID, 200ms otherwise |
| `renderRegTableViaRepo` | Always `emsRepo.page` seed + scan | Branches to `renderRegTableFromSearchOverlay` when search active |
| `renderRegTableFromSearchOverlay` | N/A | **New** — renders cached search rows, skips IDB page scan |
| `regUpdateCount` | Count only | Adds `regSearchSourceBadge()` — ☁️ Cloud / ⚡ کیش / 📴 آف لائن |

**Key fix — regListSearch no longer contains:**
```javascript
if (regRepoActive()) {
  emsRegRepoClearSearch();
  renderRegTable();  // cloud bypassed
  return;
}
```

### 4. Tests

| File | Tests |
|------|-------|
| `tests/unit/ems-registration-search-s2.test.js` | **New** — 6 Sprint 2 assertions |
| `tests/unit/ems-enterprise-search-e9s2.test.js` | Updated for router + overlay path |

---

## Offline Guarantee

| Scenario | Behavior |
|----------|----------|
| `navigator.onLine === false` | Router skips cloud; local IDB scan via `renderRegTable` |
| CF / Typesense failure | Catch → `localIndexedSearch` → local scan |
| `EMS_OFFLINE_ONLY=true` | Never calls cloud; uses `emsRegRepoSearch` when available |
| `EMS_REG_FORCE_LOCAL_SEARCH=true` | Admin diagnostic — forces local path |

No offline functionality removed.

---

## Performance Impact (Expected)

| Query | Before (online) | After (online) |
|-------|-----------------|----------------|
| `STD-0042` | ~4.4s (local scan) | **<50ms** (direct ID) |
| Repeat query | ~4.4s | **<5ms** (cache) |
| Broad name @ 100k | ~4.4s | **<500ms** (cloud CF) |
| Offline broad @ 100k | ~4.4s | ~4.4s (unchanged) |

---

## Score Impact

| Dimension | Before | After Sprint 2 |
|-----------|--------|----------------|
| Performance | 72 | **80** (target) |
| UX | 62 | **68** (target) |
| Global Readiness | 42 | **48** (target) |

---

## Files Changed

- `cloud/ems-enterprise-search.js`
- `ems-registration-repository.js`
- `admission.js`
- `tests/unit/ems-registration-search-s2.test.js` (new)
- `tests/unit/ems-enterprise-search-e9s2.test.js`
- `docs/REGISTRATION_SEARCH_IMPLEMENTATION_REPORT.md` (this file)
- `docs/REGISTRATION_SEARCH_BENCHMARK_REPORT.md`

---

## Next Sprint

Sprint 3 — Duplicate detection (CNIC/phone cross-check, merge UI). Do not start until user confirms Sprint 2 acceptance.
