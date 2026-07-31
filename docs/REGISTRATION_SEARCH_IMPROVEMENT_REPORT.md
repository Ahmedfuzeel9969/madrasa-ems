# Registration Search Improvement Report

**Date:** 9 July 2026  
**Phase:** 1 — Priority 2  
**Status:** Pre-implementation analysis

---

## Problem Statement

At 100k records, local prefix search takes **~4.4 seconds** per query (`docs/idb-browser-bench.json`). Office staff experience noticeable lag when searching common names (e.g., "محمد", "علی").

Additionally, a **routing bug** causes enterprise cloud search to be bypassed in the default code path.

---

## Current Search Architecture

### Three search paths exist

```
regListSearch(q)  [admission.js L800]
  │
  ├─ PATH A (DEFAULT when regRepoActive):     ← ACTIVE TODAY
  │    emsRegRepoClearSearch()
  │    renderRegTable() → emsRepo.page('registrations', {search})
  │    Uses IDB search_tokens row-doc index
  │    Benchmark: 4.4s @ 100k broad match
  │
  ├─ PATH B (when regRepoActive=false):
  │    emsEnterpriseSearchRegistrations(q)
  │      → CF searchTenantRegistrations
  │      → Typesense (if configured) or Firestore prefix
  │      → emsRegRepoSetSearchResults(rows)
  │    Benchmark: ~300–800ms @ 100k (cloud)
  │
  └─ PATH C (fallback in emsRegRepoSearch):
       searchLocalFromState(q) — scans state.order in RAM
       Incomplete if RAM capped; O(n) substring match
```

### Root cause of 4.4s latency

| Factor | Detail | Evidence |
|--------|--------|----------|
| Broad prefix match | Query "محمد" matches 30k+ row-docs | Bench trace: `searchIndex:rowDocs` |
| Row-doc scan | v3 index stores 1 IDB doc per record; prefix scan reads all matching docs | `ems-search-index.js` L94 |
| PATH A bypasses cloud | `regRepoActive()` returns true → enterprise search never called | `admission.js` L806–809 |
| 300ms debounce | Adds perceived latency on top | `admission.js` L802 |
| No search result caching | Same query re-scans every time | No cache layer found |

### What works well

- `noLoadAllOnSearch: true` — does not load full collection
- `noColAllOnSearch: true` — no full collection scan
- Enterprise search CF with Typesense fallback already implemented
- `emsEnterpriseSearchRegistrations` has offline fallback to `emsRegRepoSearch`
- Search at 10k: **291ms** — acceptable

---

## Profiling Plan (Pre-Implementation)

### Benchmark matrix to run

| Query Type | Example | Expected @ 100k | Why |
|------------|---------|-----------------|-----|
| Exact ID | `STD-0042` | <50ms | Direct doc lookup |
| Narrow prefix | `STD-00` | <200ms | Few matches |
| Broad prefix | `محمد` | 4.4s | Many matches |
| Broad prefix EN | `Ali` | ~2–3s | Latin, fewer records |
| CNIC partial | `35202` | ~1s | Numeric prefix |
| Phone partial | `0300` | ~3s | Very common |
| Empty / 1 char | `م` | 0ms | Below SEARCH_MIN=2 |

### Tools

1. Re-run `bench/p6-soak-harness.js` with query variants
2. Add `performance.mark` in `regListSearch` and `emsRepo.page` search path
3. Log `emsEnterpriseSearchGetSource()` in UI (debug mode)
4. Chrome DevTools Performance tab on 100k fixture

---

## Proposed Solution — Tiered Search Router

### Design: `emsRegSearchRouter(query, opts)`

```
Input: query string, opts { preferCloud, forceLocal, limit }

1. Normalize query (trim, min length 2)
2. If query matches /^STD|^TCH|^STF/i → direct getById (fast path)
3. If online AND (preferCloud !== false):
     a. Try emsEnterpriseSearchRegistrations(query)
     b. On success → apply results, return { source: 'cloud', ms }
     c. On failure → fall through to local
4. Local indexed search:
     a. emsRepo.page('registrations', { search, limit: 50 })
     b. Return { source: 'local-index', ms }
5. Last resort: emsRegRepoSearch (RAM scan) — only if IDB unavailable

Default: preferCloud = true when navigator.onLine && firebase.auth().currentUser
Offline: preferCloud = false (full local functionality preserved)
```

### Key change in `regListSearch`

**Before (L806–809):**
```javascript
if (regRepoActive()) {
  emsRegRepoClearSearch();
  renderRegTable();  // local only — cloud bypassed
  return;
}
```

**After (proposed):**
```javascript
if (regRepoActive()) {
  var preferCloud = navigator.onLine && !window.EMS_REG_FORCE_LOCAL_SEARCH;
  if (preferCloud && query.length >= 2 && emsEnterpriseSearchRegistrations) {
    emsEnterpriseSearchRegistrations(query).then(renderRegTable);
    return;
  }
  emsRegRepoClearSearch();
  renderRegTable();  // offline/local fallback
  return;
}
```

---

## Additional Optimizations

### Short-term (Phase 1)

| # | Optimization | Impact | Effort |
|---|-------------|--------|--------|
| S1 | Cloud-first routing fix | 4.4s → <1s when online | 1 day |
| S2 | Search source indicator in UI | User trust ("Cloud تلاش" / "آف لائن تلاش") | 0.5 day |
| S3 | Result limit cap (50) during search | Faster render | 0.5 day |
| S4 | Cache last 10 queries (60s TTL) | Repeat search instant | 1 day |
| S5 | Reduce debounce to 200ms for exact ID pattern | STD-xxx instant | 0.5 day |

### Medium-term (Phase 1 late / Phase 2)

| # | Optimization | Impact | Effort |
|---|-------------|--------|--------|
| S6 | Incremental index update on save | Eliminates 32-min rebuild | 2 weeks |
| S7 | Trie/substring index for broad queries | Local <500ms @ 100k | 3 weeks |
| S8 | Web Worker index build | Non-blocking UI | 2 weeks |
| S9 | Typesense mandatory for 50k+ tenants | Consistent <200ms | 1 week ops |

---

## Offline Guarantee

| Scenario | Behavior |
|----------|----------|
| No network | Local indexed search (current PATH A) |
| Network but CF fails | Automatic fallback to local (already in `ems-enterprise-search.js` L72–74) |
| `EMS_REG_FORCE_LOCAL_SEARCH=true` | Force local (admin diagnostic flag) |
| `EMS_OFFLINE_ONLY=true` | Never call cloud (existing global flag respected) |

**No offline functionality is removed.**

---

## Performance Targets

| Scale | Local Search | Cloud Search | Target |
|-------|-------------|--------------|--------|
| 1k | <30ms | <200ms | ✅ Already met |
| 10k | <300ms | <300ms | ✅ Already met |
| 50k | <1.5s | <500ms | Cloud fix needed |
| 100k | <2s local | **<500ms** cloud | **Primary goal** |

---

## Implementation Checklist

- [ ] Create `emsRegSearchRouter` in `cloud/ems-enterprise-search.js` or new `ems-reg-search-router.js`
- [ ] Fix `regListSearch` to call cloud when online
- [ ] Add `EMS_REG_FORCE_LOCAL_SEARCH` flag
- [ ] Add search source badge in `#reg-list-count`
- [ ] Add query result cache (session-level)
- [ ] Fast path for exact ID queries
- [ ] Unit tests: online→cloud, offline→local, CF-fail→local
- [ ] E2E: search at 10k fixture, verify <500ms cloud path
- [ ] Re-benchmark 100k after fix

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Cloud search returns stale data | Meta sync already handles remote writes; search index CF syncs on write |
| CF cost at high search volume | Typesense reduces Firestore reads; add rate limit per tenant |
| Offline users see slower search | Expected; local path unchanged; show "آف لائن موڈ" badge |
| Breaking regRepoActive path | Keep local as fallback; cloud is additive |

---

## Estimated Score Impact

| Dimension | Before | After P2 |
|-----------|--------|----------|
| Performance | 72 | 80 |
| User Experience | 62 | 68 |
| Global Readiness | 42 | 48 |

---

*Next step: Implement S1 (cloud-first routing) as first code change — smallest diff, highest impact.*
