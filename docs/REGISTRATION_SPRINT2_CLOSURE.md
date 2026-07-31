# Sprint 2 — Vitest Clarification & Final Closure

**Date:** 9 July 2026  
**Status:** ✅ CLOSED (conditionally approved)

---

## Original Report: 471/474 pass

The earlier **471/474** result (3 failures) was from the run **before** Sprint 2 test updates were applied. Those three failures are listed below.

---

## The 3 Non-Passing Tests (Historical)

| # | Test file | Test name | Cause | Sprint 2 related? |
|---|-----------|-----------|-------|-----------------|
| 1 | `tests/unit/ems-reg-repo-page-wiring.test.js` | search box uses the repository local search when active | Asserted old `regRepoActive()` → local-only path removed in Sprint 2 | **Yes** — fixed by updating test to expect `emsRegSearchRouter` |
| 2 | `tests/unit/ems-performance-s3.test.js` | admission.js uses debounced search… | Expected `300` ms debounce; Sprint 2 changed to `80/200` ms | **Yes** — fixed by updating assertion |
| 3 | `tests/unit/project-smoke.test.js` | Phase 12 trusted devices + SSO email domain | **5s timeout** reading `functions/index.js` (unrelated I/O flake) | **No** — unrelated to Registration search |

**6 skipped** tests (`ems-sqlite-backend.test.js`) are environment-gated and unchanged.

---

## Current Vitest Status (Post-Fix)

```
Test Files  86 passed (86)
Tests       474 passed | 6 skipped (480)
```

All Registration Sprint 2 tests pass. No open failures block Sprint 2 closure.

---

## Cloud Search Benchmark — Scheduled

Live cloud latency **cannot be measured without Firebase auth + tenant data**. A harness is provided:

| Asset | Purpose |
|-------|---------|
| `bench/reg-cloud-search-bench.js` | `emsRegCloudSearchBench()` — times router queries |
| `bench/reg-cloud-search-bench.html` | Manual trigger page (same origin as app) |
| `docs/REGISTRATION_CLOUD_SEARCH_BENCH_SCHEDULE.md` | Runbook when credentials available |

**When to run:** Staging/production login → Admission module open → browser console:

```javascript
// After cloud stack + emsRegSearchRouter loaded:
emsRegCloudSearchBench().then(console.log);
// Optional: download JSON
emsRegCloudSearchBench().then(emsRegCloudSearchBenchDownload);
```

**Target:** broad query @ 100k online **<500ms** (cloud path).

Local baseline remains in `docs/idb-browser-bench.json` (4.4s @ 100k offline).

---

## Sprint 2 Deliverables — Complete

- [x] `emsRegSearchRouter` tiered paths
- [x] `regListSearch` integration
- [x] Search overlay rendering
- [x] Source badge + debounce
- [x] Unit tests updated
- [x] Implementation + benchmark reports
- [x] Vitest clarification (this document)
- [x] Cloud bench harness (scheduled execution)

**Sprint 3 started:** Duplicate Detection (see `REGISTRATION_DUPLICATE_IMPLEMENTATION_REPORT.md`).
