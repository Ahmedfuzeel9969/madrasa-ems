# Madrasa EMS — Benchmark Results (Phase 3)

**Release:** `20260621-perf5` (Phase 2 S1–S5 deployed)  
**Date:** June 2026  
**Environment:** Node synthetic sim + Playwright hosting smoke  
**Script:** `scripts/perf-load-sim.js`  
**Production:** https://madrasa-mangment-app.web.app

---

## Executive Summary

Phase 2 performance refactors **eliminated the primary CPU bottleneck** (fee arrears O(n×m) → O(n+m) Map + server `DashboardStats`). At **400–1,000 students** the app is **production-ready**. At **10,000+** client-side search still scans full arrays but **virtual tables keep DOM stable**. At **100,000** records, **DashboardStats + lazy modules + deferred sync** are required — legacy client aggregation remains **broken** (by design, no longer used in production path).

| Scale | JSON size | Map arrears | Search+virtual | Verdict |
|-------|-----------|-------------|----------------|---------|
| 400 | 0.08 MB | **0.4 ms** | 1.2 ms | ✅ Production-ready |
| 1,000 | 0.20 MB | **0.7 ms** | 1.8 ms | ✅ Production-ready |
| 10,000 | 1.97 MB | **5.4 ms** | 7.6 ms | ✅ Acceptable |
| 50,000 | 9.95 MB | **25.7 ms** | 34 ms | ⚠️ Large tenant (IndexedDB + stats) |
| 100,000 | 19.97 MB | **68.7 ms** | 271 ms | ⚠️ Stress — server aggregation mandatory |

**Legacy O(n×m) arrears (removed from production dashboard):**

| Scale | Legacy ms | Map ms | Speedup |
|-------|-----------|--------|---------|
| 400 | 8.1 | 0.4 | **20×** |
| 1,000 | 46.7 | 0.7 | **67×** |
| 10,000 | 5,059 | 5.4 | **937×** |
| 50,000 | 84,382 | 25.7 | **3,284×** |
| 100,000 | 311,674 | 68.7 | **4,536×** |

---

## Methodology

### Synthetic CPU benchmark (`perf-load-sim.js`)

Mirrors hot paths without inline `photoBase64` (lean JSON). Each scale generates:

- Students + teachers (`makeCollection`)
- Fee collections (~3 per student)
- Timings: parse, filter, arrears (legacy vs Map), registration search + virtual slice (40 rows), cache fingerprint, stringify

```bash
# Full report (slow at 100k legacy — use skip-legacy for CI)
npm run benchmark

# Custom scale cap
node scripts/perf-load-sim.js --max=10000 --skip-legacy

# Write JSON artifact
node scripts/perf-load-sim.js --skip-legacy --json-out=docs/benchmark-latest.json
```

### Playwright hosting smoke

```bash
npm run build:hosting
npm run test:e2e -- tests/e2e/perf-load-smoke.spec.js
```

Validates: lazy loader present, admission.js not eager-loaded, ribbon shell renders, DOMContentLoaded under 15s.

---

## Phase 2 architecture impact (reads & listeners)

| Area | Before Phase 2 | After Phase 2 S5 |
|------|----------------|------------------|
| Login Firestore pull | `pullAll` all module keys | `pullCoreModules` (SystemSettings only) |
| Dashboard KPIs | 3 full-collection listeners + O(n×m) arrears | **1× `DashboardStats/current`** doc |
| Registration sync | Full collection at login | **Deferred + pausable + paginated 500/batch** |
| Attendance dashboard | Full `Attendance` collection scan | **Month-scoped** `FieldPath.documentId()` queries |
| Script load | ~94 eager scripts | **~59 core + lazy modules on tab open** |
| Large tables | Full DOM rebuild | **Virtual scroll** (registration, rejected, fee dues) |
| Online reconnect | `pullAllModules` | **Queue flush only** |

**Estimated Firestore reads per session (medium tenant, post-refactor):**

| Event | Before | After |
|-------|--------|-------|
| Login | 700–6,000+ | **~50–150** (core + auth) |
| Dashboard open | 490–500+ | **1** (DashboardStats) + optional legacy fallback |
| Registration tab | N (already synced at login) | **Paginated batches** when tab opens |
| Module tab switch | Re-pull group | **Lazy script + single group pull** |

---

## Detailed timings (release perf5)

Machine: Windows dev, Node 20+, June 2026 run.

### 400 students

| Benchmark | ms |
|-----------|-----|
| JSON.parse users | 1.7 |
| filter students + counts | 0.2 |
| arrears O(n×m) [legacy] | 8.1 |
| arrears O(n+m) Map [production] | **0.4** |
| reg search + virtual slice | 1.2 |
| cache fingerprint hit | <1 |
| JSON.stringify snapshot | 1.6 |

### 1,000 students

| Benchmark | ms |
|-----------|-----|
| Map arrears [production] | **0.7** |
| Legacy arrears | 46.7 |
| Search + virtual | 1.8 |
| JSON size | 0.20 MB |

### 10,000 students

| Benchmark | ms |
|-----------|-----|
| Map arrears [production] | **5.4** |
| Legacy arrears | 5,059 |
| Search + virtual | 7.6 |
| JSON size | 1.97 MB |

### 50,000 students

| Benchmark | ms |
|-----------|-----|
| Map arrears [production] | **25.7** |
| Legacy arrears | 84,382 |
| Search + virtual | 34.1 |
| JSON size | 9.95 MB |

### 100,000 students

| Benchmark | ms |
|-----------|-----|
| Map arrears [production] | **68.7** |
| Legacy arrears | 311,674 |
| Search + virtual | 271.1 |
| JSON size | 19.97 MB |

---

## Production readiness matrix

| Requirement | 400 | 1k | 10k | 50k | 100k |
|-------------|-----|-----|------|------|-------|
| DashboardStats CF deployed | ✅ | ✅ | ✅ | ✅ | ✅ |
| Virtual registration table | ✅ | ✅ | ✅ | ✅ | ✅ |
| IndexedDB large arrays | ✅ | ✅ | ✅ | **Required** | **Required** |
| Photo Storage (lean JSON) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Storage rules live | ⚠️ Console pending | | | | |
| Full-text search index | — | — | Optional | **Recommended** | **Required** |

---

## Known limits (100k+)

1. **localStorage quota** — mitigated by IndexedDB mirror (`ems-data-idb.js`) for arrays >180KB.
2. **Registration search** — still O(n) scan; virtual DOM renders ~40 rows only.
3. **Import/export** — full collection overwrite; batch APIs recommended for Phase 6.
4. **Inline photos** — migration to Storage required for tenants with legacy `photoBase64`.

---

## Commands reference

```bash
npm run benchmark                    # CI-friendly: 400–10k, skip legacy
npm run test                         # Unit tests incl. ems-benchmark.test.js
npm run build:hosting && npm run test:e2e -- tests/e2e/perf-load-smoke.spec.js
firebase functions:httpsCallable refreshTenantDashboardStats  # once per tenant after deploy
```

---

## Sign-off

| Phase | Status |
|-------|--------|
| Phase 1 — Performance Audit | ✅ |
| Phase 2 — Enterprise Refactor (S1–S5) | ✅ Deployed |
| **Phase 3 — Load Testing** | ✅ **This document** |
| Phase 4 — Backup & migration safety | ⏳ See `docs/PRE-REFACTOR-BACKUP-CHECKLIST.md` |
| Phase 5 — UI preservation | ✅ No visual redesign |
| Phase 6 — New features | 🚫 Unblocked after Phase 4 backup on production |

**Recommendation:** Safe for production tenants up to **~10,000 active records** with current stack. Tenants **10k–50k** should run DashboardStats refresh + photo migration after Storage init. **50k+** requires operational monitoring and optional Firestore composite indexes for paginated queries.

---

*Generated from `scripts/perf-load-sim.js` runs and Phase 2 architecture verification.*
