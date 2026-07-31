# Madrasa EMS — Enterprise Architecture Directive (Cursor Master Guide)

**Version:** 1.0 · June 2026  
**Production:** https://madrasa-mangment-app.web.app  
**Related:** `docs/FULL-PERFORMANCE-AUDIT-REPORT.md` · `docs/BENCHMARK-RESULTS.md`

---

## بنیادی اصول (Non-Negotiable)

| Rule | Detail |
|------|--------|
| **No complete rewrite** | Vanilla JS SPA structure, module files, Urdu UI preserved |
| **UI unchanged** | Colors, layout, department tabs, labels, UX |
| **Data safe** | Backup before every sprint · backward-compatible reads |
| **Internal only** | Architecture, data layer, performance, scalability, stability |
| **Target scale** | 100,000 – 1,000,000 students (enterprise tier) |
| **Global standard** | PowerSchool / Fedena / Teachmint-class performance patterns |

---

## 1. Root Cause (confirmed)

```
Registrations (Firestore)
    ↓ Full onSnapshot  ← REMOVE
    ↓ ems_full_users (full mirror)  ← REPLACE with IndexedDB + paginated pages
    ↓ All modules JSON.parse
```

**Impact:** Every user downloads all data · every edit re-processes N docs · memory bloat · 300–400 row slowdown (worse with photoBase64).

---

## 2. Target Architecture

```
Firestore (source of truth)
    ↓
Summary Collections (DashboardStats, FeeSummary, AttendanceSummary, …)
    ↓
Cloud Functions (onWrite aggregation)
    ↓
IndexedDB + emsCacheGetRole
    ↓
Paginated Client Repositories
    ↓
Virtual Table UI (existing design)
```

---

## 3–20. Directive Checklist & Status

| # | Requirement | Status | Sprint |
|---|-------------|--------|--------|
| 3 | Registration: cursor pagination (50–100), no full listener | ✅ **E7-S1 deployed** | E7-S1 |
| 4 | Eliminate `ems_full_users` full mirror → IndexedDB | 🔄 Partial (`ems-data-idb.js` + `ems-user-access.js`) | E7–E8 |
| 4 | All modules: `emsCacheGet` / `emsCacheSet` only | 🔄 core modules done · dashboard.js ledger/ann ⏳ | E7-S4 / E8 |
| 5 | Search Phase 1: Firestore prefix | ✅ E7-S1 | E7-S1 |
| 5 | Search Phase 2: Algolia / Typesense | ⏳ | E9 |
| 6 | Photos → Firebase Storage, URL only in Firestore | ✅ Code ready · ⚠️ Console init pending | Done S1 |
| 7 | Dashboard reads `DashboardStats` only | ✅ Deployed | Done S2 |
| 7 | Remove legacy Fee/Ledger/Announcements listeners | ✅ Stopped when Stats active | Done S5 |
| 8 | Summary collections | ✅ DashboardStats, FeeSummary, **FinanceSummary, AttendanceSummary** · ⏳ Exam/Curriculum | E8-S1 / E9 |
| 9 | Cloud Functions onWrite | ✅ `tenant-dashboard-stats.js` · extend | E8+ |
| 10 | Virtual tables all large lists | 🔄 Reg/rejected/dues ✅ · ledger/exams ⏳ | E8 |
| 11 | Historical archiving (active vs archive) | ⏳ | E11 |
| 12 | Batch import 500 + queue (Pending/Processing/…) | ⏳ | E10 |
| 13 | Lazy module loading | ✅ `ems-lazy-loader.js` | Done S4 |
| 14 | Listener policy: active screen only, unsubscribe on leave | 🔄 | E7+ |
| 15 | Error / performance monitoring | ⏳ | E12 |
| 16 | Composite indexes, no full `.get()` | 🔄 Attendance fixed · Reg paginated | E7+ |
| 17 | Security rules tenant audit | ✅ Tenant-scoped | Ongoing |
| 18 | Performance targets (login <2s, dash <1s, search <300ms) | 🔄 | Per sprint |
| 19 | Load test 1k–1M after each sprint | ✅ `npm run benchmark` | Ongoing |
| 20 | UI/design/data/features preserved | ✅ Constraint all sprints | Always |

---

## Performance Targets (Section 18)

| Metric | Target | Current (400–1k, post Phase 2) |
|--------|--------|--------------------------------|
| Login | < 2 s | ✅ ~1–2 s (no pullAll) |
| Dashboard | < 1 s | ✅ <200 ms with DashboardStats |
| Registration search | < 300 ms | ⚠️ Client scan at 10k+ · prefix search E7 |
| Tab switch | < 500 ms | ✅ Lazy load |

---

## Mandatory Protocol (ہر Sprint)

```bash
npm run backup:snapshot          # before changes
# … implement …
npm test                         # unit tests
npm run benchmark                # perf regression
npm run build:hosting && npm run deploy:hosting   # production
# Update docs/BENCHMARK-RESULTS.md or sprint report
```

---

## File Map (Enterprise Layer)

| File | Role |
|------|------|
| `ems-registration-repository.js` | Paginated Registrations, prefix search, single-doc fetch |
| `ems-user-access.js` | On-demand user queries, merged cache, class/type Firestore fetch |
| `ems-data-cache.js` | Versioned parse cache |
| `ems-data-idb.js` | IndexedDB for large arrays |
| `ems-dashboard-stats.js` | DashboardStats listener |
| `ems-registration-sync.js` | Deferred sync orchestration |
| `ems-virtual-table.js` | Virtual DOM for tables |
| `ems-lazy-loader.js` | On-demand module scripts |
| `functions/lib/tenant-dashboard-stats.js` | Server aggregation |

---

## حتمی ہدف

عالمی معیار · انتہائی رفتار · لاکھوں طلبہ · موجودہ ڈیزائن · محفوظ ڈیٹا · Enterprise Grade · **no demo/temporary code**.

*This document is the authoritative Cursor instruction set for all performance/scalability work.*
