# Madrasa EMS — Enterprise Roadmap (Post Phase 2)

**Start:** June 2026 · **No UI rewrite**

---

## Completed (Phase 1–4 + Phase 6 S1)

| Phase | Deliverable |
|-------|-------------|
| P1 | Performance audit |
| P2 S1–S5 | Photos, cache, DashboardStats, IDB, virtual tables, lazy load |
| P3 | Benchmark suite |
| P4 | Backup protocol |
| P6 S1 | Smart slip system |

---

## Phase E7 — Registration & Data Layer (CURRENT)

### E7-S1 — Registration Repository ✅
- [x] `ems-registration-repository.js`
- [x] Remove full `Registrations` / `Rejected` onSnapshot
- [x] Initial load 100 · Load More · Firestore prefix search
- [x] Single-doc fetch for edit/delete
- [x] Deploy + tests (174 pass)

### E7-S2 — Module cache migration ✅
- [x] `ems-user-access.js` — centralized cache + Firestore queries
- [x] `dashboard.js` → `emsGetUsersMerged` / `emsCacheGet`
- [x] `finance.js` → class-based Firestore student fetch
- [x] `attendance.js` → per-class register load + `targetUsers` cache
- [x] Deploy + tests (174 pass)

### E7-S3 — Rejected pagination + listener removal ✅
- [x] Lazy load Rejected only on tab open
- [x] Load More (50) + virtual table pager
- [x] Paginated batch delete (`emsRegRepoClearAllRejected`)
- [x] training/curriculum/idcard cache migration
- [x] Deploy + tests (178 pass)

### E7-S4 — Remaining module cache migration ✅
- [x] `dashboard-pro.js` → `emsGetUsersMerged` / `emsCacheGet`
- [x] `sys-report-builder.js` → cache layer all sources
- [x] `ems-import-export.js` → merged users + repo rejected
- [x] Deploy + tests (182 pass)

---

## Phase E8 — Summary Collections Extension

### E8-S1 — FinanceSummary + AttendanceSummary ✅
- [x] Cloud Functions onWrite aggregation
- [x] Client listeners (`ems-module-summaries.js`)
- [x] Finance dashboard + attendance snapshot wired
- [x] Deploy + tests

| Collection | Trigger | Sprint |
|------------|---------|--------|
| `ExaminationSummary/{term}` | ModuleData Exams sync | E9-S1 ✅ |
| `CurriculumSummary/{year}` | ModuleData Curriculum sync | E9-S1 ✅ |

---

## Phase E9 — Enterprise Search

### E9-S1 — Examination & Curriculum summaries ✅
### E9-S2 — Registration enterprise search ✅
- [x] Callable multi-field search + SearchIndex sync
- [x] Typesense optional backend
- [x] `ems-enterprise-search.js` + admission wiring
- [x] Deploy + tests

## Phase E10 — Import Queue & Virtual Tables

### E10-S1 — Import queue + virtual tables ✅
- [x] `ems-import-queue.js` — 500-record chunks, job states
- [x] Import export wired (staging + large commits)
- [x] Virtual tables: ledger, complaints, exams, curriculum
- [x] Deploy + tests

## Phase E11 — Historical Archiving

### E11-S1 — Archive collections + 2-year client window ✅
- [x] `Archive_*` Firestore collections + callable
- [x] `ems-academic-archive.js` client prune/filter
- [x] Finance, ledger, attendance wired
- [x] Deploy + tests

## Phase E12 — Monitoring (NEXT)

- Client perf marks · slow query log · optional Sentry

---

## Scale Readiness Matrix (target end-state)

| Students | E7 | E8 | E9 | E11 |
|----------|----|----|----|----|
| 1k | ✅ | ✅ | — | — |
| 10k | ✅ | ✅ | optional | — |
| 100k | ✅ | ✅ | **required** | **required** |
| 1M | CF-only aggregates | ✅ | ✅ | ✅ |

---

*Update this file at the end of each sprint.*
