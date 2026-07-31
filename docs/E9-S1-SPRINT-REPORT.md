# E9-S1 Sprint Report — Examination & Curriculum Summaries

**Date:** 22 June 2026 · **Cache bust:** `20260621e9s1`

## Changes

| Item | Detail |
|------|--------|
| **Cloud Functions** | `tenant-exam-curriculum-summaries.js` — ModuleData onWrite |
| **ExaminationSummary** | Per exam term + `_overview` doc |
| **CurriculumSummary** | Per academic year (green/yellow/red/avgPct) |
| **Client** | Extended `ems-module-summaries.js` listeners |
| **Fixed** | `exams.js` `exmGetUsers` infinite recursion bug |
| **Updated** | `curriculum.js`, `dashboard-pro.js` use summaries |
| **Tests** | `tests/unit/ems-exam-curriculum-e9.test.js` (5 tests) |

## Firestore paths

```
All_Madrasas/{tenantId}/ExaminationSummary/_overview
All_Madrasas/{tenantId}/ExaminationSummary/{termId}
All_Madrasas/{tenantId}/CurriculumSummary/{academicYear}
```

Trigger source: `ModuleData/Exams__ems_full_exams` and `Curriculum__*`

## Manual step

Sys Settings → کارکردگی → **DashboardStats rebuild** (rebuilds all summaries)

## Verify

```bash
npm test
firebase deploy --only functions:onModuleDataSummaryWrite,functions:refreshTenantDashboardStats
```

Hard refresh: **Ctrl+Shift+R**
