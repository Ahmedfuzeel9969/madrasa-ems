# E8-S1 Sprint Report — Summary Collections Extension

**Date:** 22 June 2026 · **Cache bust:** `20260621e8s1`

## Changes

| Item | Detail |
|------|--------|
| **Cloud Functions** | `FinanceSummary/monthly_{YYYY-MM}` on FeeCollections write |
| **Cloud Functions** | `AttendanceSummary/{YYYY-MM}` on Attendance write + full recompute |
| **Client** | `ems-module-summaries.js` — 6-month single-doc listeners |
| **Updated** | `finance.js` — dashboard KPIs + 6-month chart from FinanceSummary |
| **Updated** | `attendance-helper.js` — today present from AttendanceSummary |
| **Updated** | `dashboard.js` — start/stop summary listeners |
| **Tests** | `tests/unit/ems-module-summaries-e8.test.js` (5 tests) |

## Firestore paths

```
All_Madrasas/{tenantId}/FinanceSummary/monthly_2026-06
All_Madrasas/{tenantId}/AttendanceSummary/2026-06
```

## Manual step (once per tenant)

Sys Settings → کارکردگی → **DashboardStats rebuild** (also rebuilds Finance + Attendance summaries)

## Verify

```bash
npm test
firebase deploy --only functions:onFeeCollectionStatsWrite,functions:onAttendanceStatsWrite,functions:refreshTenantDashboardStats
```

Hard refresh: **Ctrl+Shift+R**
