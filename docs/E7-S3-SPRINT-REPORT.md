# E7-S3 Sprint Report — Rejected Pagination Parity

**Date:** 22 June 2026 · **Cache bust:** `20260621e7s3`

## Changes

| Item | Detail |
|------|--------|
| **Deferred load** | `Rejected` no longer fetched on login — only when مسترد شدہ tab opens |
| **Added** | `emsRegRepoEnsureRejectedInitial`, `emsRegRepoHasMoreRejected`, `emsRegRepoClearAllRejected` |
| **Updated** | `admission.js` — lazy tab load, Load More (50), paginated clear history |
| **Updated** | `index.html` — `reg-rejected-count`, `reg-rejected-pager` |
| **Migrated** | `training.js`, `curriculum.js`, `ems-idcard.js`, `ems-import-export.js` → cache layer |
| **Tests** | `tests/unit/ems-rejected-e7s3.test.js` (4 tests) |

## Performance impact (expected)

| Metric | Before | After E7-S3 |
|--------|--------|-------------|
| Login Firestore reads | Registrations + Rejected (50) | **Registrations only (100)** |
| Rejected tab | Already in memory | **On-demand 50** + Load More |
| Clear all rejected | Full `.get()` | **Paginated batch delete (450/chunk)** |
| Training/Curriculum/ID card | `JSON.parse(ems_full_users)` | **`emsGetUsersMerged` / `emsGetUserById`** |

## Next (E7-S4 / E8)

- `sys-report-builder.js`, `dashboard-pro.js` cache migration
- `AttendanceSummary` / `FinanceSummary` Cloud Functions
- Virtual tables for ledger, exams, complaints

## Verify

```bash
npm test          # 178/178
npm run benchmark
```

Hard refresh production: **Ctrl+Shift+R**
