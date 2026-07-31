# Registration Performance Targets

**Date:** 9 July 2026  
**Baseline:** `docs/idb-browser-bench.json` (2026-07-08, v3 row-doc index)

---

## Current Baseline

| Operation | 1k (est.) | 10k | 50k | 100k |
|-----------|-----------|-----|-----|------|
| Insert (bulk) | ~1.4s | 14.2s | 163s | 444s |
| Index build (cold) | ~1.7s | 17.5s | 325s | 1,913s (32 min) |
| Filter (type/class) | ~10ms | 102ms | 422ms | 1,350ms |
| Search (local) | ~29ms | 291ms | 1,398ms | **4,382ms** |
| First page render | ~18ms | 181ms | 840ms | 1,973ms |
| Save (single) | <50ms | <50ms | <50ms | <50ms |
| Edit (single) | <100ms | <100ms | <100ms | <100ms |
| Delete (single) | <50ms | <50ms | <50ms | <50ms |
| JS Heap | — | 9.5 MB | 9.5 MB | 9.5 MB |

---

## Phase 1 Targets

| Operation | 1k | 10k | 50k | 100k | How |
|-----------|-----|-----|-----|------|-----|
| Open (warm) | <300ms | <500ms | <1s | <2s | Skip re-hydrate if count > 0 |
| Open (cold) | <2s | <5s | <20s | <60s | Paginated IDB hydrate (existing) |
| Search (online) | <200ms | <300ms | <500ms | **<500ms** | Cloud-first routing fix |
| Search (offline) | <30ms | <300ms | <1.5s | <3s | Indexed local (existing) |
| Filter | <10ms | <100ms | <500ms | <1s | Indexed page query |
| First page | <20ms | <200ms | <800ms | <1.5s | Virtual table + indexed page |
| Save | <50ms | <50ms | <50ms | <50ms | O(1) upsert (existing) |
| Import (10k) | — | <30s | — | — | Queue + incremental index |
| Index build | <2s | <20s | <3min | <10min | Incremental index update |
| Tab switch | <50ms | <50ms | <50ms | <50ms | DOM only |
| Duplicate check | <5ms | <10ms | <20ms | <30ms | Secondary index |
| ID card open | <100ms | <100ms | <100ms | <100ms | Repo getById (fix legacy) |

### Phase 1 success gate

- 100k cloud search: **<500ms** (from 4.4s)
- 100k offline search: **<3s** (from 4.4s)
- No regression at 10k scale
- All safety checks pass (`noLoadAllOnSearch`, etc.)

---

## Phase 2 Targets

| Operation | 10k | 50k | 100k | 500k | How |
|-----------|-----|-----|-----|------|-----|
| Search (online) | <100ms | <200ms | <300ms | <500ms | Typesense mandatory |
| Search (offline) | <100ms | <500ms | <1s | <2s | Trie index |
| Index build | <5s | <30s | <2min | <10min | Incremental only |
| First page | <100ms | <300ms | <500ms | <1s | Server-side render option |
| Analytics load | <500ms | <1s | <2s | <3s | Pre-aggregated nightly |
| OCR extract | <3s | — | — | — | Cloud Vision |
| Timeline load | <200ms | <500ms | <1s | <2s | Audit index |
| QR scan → form | <1s | — | — | — | Static page + CDN |

---

## Score Targets by Scale

### Phase 1 End

| Scale | Performance Score |
|-------|------------------|
| 1k | 95 |
| 10k | 90 |
| 50k | 75 |
| 100k | 65 |
| **Weighted overall** | **80** |

### Phase 2 End

| Scale | Performance Score |
|-------|------------------|
| 1k | 98 |
| 10k | 95 |
| 50k | 90 |
| 100k | 85 |
| 500k | 70 |
| **Weighted overall** | **88** |

---

## Optimization Roadmap

### Completed (pre-Phase 1)

| Optimization | Impact | Status |
|-------------|--------|--------|
| v3 row-doc search index | 41× index build @ 10k | ✅ Done |
| Paginated repo (E7) | Enabled 100k storage | ✅ Done |
| Virtual table | Fast DOM render | ✅ Done |
| Write-trigger sync (A4) | Reduced Firestore reads | ✅ Done |
| Multi-tab leader lock (P6) | 4.7× → 1.0× write amp | ✅ Done |
| Storage quota safety (P6) | Prevents data loss | ✅ Done |

### Phase 1 (planned)

| # | Optimization | Target | Sprint |
|---|-------------|--------|--------|
| P1 | Cloud-first search routing | 4.4s → <500ms @ 100k | S2 |
| P2 | Search query cache (60s) | Repeat query instant | S2 |
| P3 | Exact ID fast path | STD-xxx <50ms | S2 |
| P4 | Incremental index on save | No full rebuild | S2–S3 |
| P5 | Duplicate check index | <30ms @ 100k | S3 |
| P6 | Index build progress UI | UX during cold build | S2 |

### Phase 2 (planned)

| # | Optimization | Target | Quarter |
|---|-------------|--------|---------|
| P7 | Trie/substring index | Local <500ms @ 100k | Q1 |
| P8 | Web Worker index build | Non-blocking UI | Q1 |
| P9 | Typesense mandatory @ 50k+ | <200ms search | Q2 |
| P10 | Server-side list render | <500ms first page @ 500k | Q3 |
| P11 | SQLite desktop backend | Unlimited local scale | Q3 |

---

## Benchmark Protocol

### When to run

- After each sprint that touches search, index, or repo
- Before each release
- After Phase 1 complete (full regression)

### How to run

```bash
# Unit tests
npm test

# Browser bench (10k, 50k, 100k)
node bench/idb-browser-bench.js

# P6 soak (multi-tab, failover)
npm run test:e2e:p6-preprod

# Search-specific (new — to be created)
node bench/reg-search-bench.js --scale 100000 --queries "STD-0042,محمد,Ali,0300"
```

### Pass criteria

| Check | Threshold |
|-------|-----------|
| `noLoadAllOnSearch` | Must be `true` |
| `noColAllOnSearch` | Must be `true` |
| `persistenceOk` | Must be `true` |
| Search @ 100k (cloud) | <500ms |
| Search @ 100k (local) | <3000ms |
| First page @ 100k | <1500ms |
| Save @ any scale | <100ms |
| Heap @ 100k | <50 MB |

---

## Monitoring (Production)

| Metric | Alert Threshold | Tool |
|--------|----------------|------|
| Search latency p95 | >1s | Client-side `performance.mark` |
| Index build duration | >10min | Boot overlay timer |
| IDB write failures | >0 per session | `ems-storage-quota.js` |
| Cloud search fallback rate | >50% | `emsEnterpriseSearchGetSource()` |
| Audit outbox queue depth | >100 | `ems-audit.js` |

---

*Targets reviewed quarterly and adjusted based on production telemetry.*
