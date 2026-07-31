# E11-S1 Sprint Report — Historical Archiving

**Date:** 22 June 2026 · **Cache bust:** `20260622e11s1`

## Changes

| Item | Detail |
|------|--------|
| **Client** | `ems-academic-archive.js` — 24-month window, local prune, archive callable |
| **Cloud Function** | `archiveTenantAcademicYear` — `Archive_Attendance`, `Archive_Finance`, `Archive_Ledger`, `Archive_Exams`, `Archive_Meta` |
| **Wired** | `auth.js` prune on login · `finance` / `ledger` / `attendance` filters |
| **UI** | Sys Settings → کارکردگی → تعلیمی سال آرکائیو |
| **Rules** | `Archive_*` read-only for staff |

## Academic year format

`2024-2025` (April–March months archived)

## Verify

```bash
npm test
node functions/test/tenant-academic-archive.test.js
```

Hard refresh: **Ctrl+Shift+R**

Owner: Sys Settings → کارکردگی → تعلیمی سال آرکائیو (پہلے backup لیں)
