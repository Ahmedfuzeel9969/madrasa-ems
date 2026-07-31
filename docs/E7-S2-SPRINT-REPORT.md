# E7-S2 Sprint Report — User Access Layer

**Date:** 22 June 2026 · **Cache bust:** `20260621e7s2`

## Changes

| Item | Detail |
|------|--------|
| **Added** | `ems-user-access.js` — centralized user reads, Firestore on-demand queries, TTL query cache |
| **APIs** | `emsGetUsers`, `emsGetUsersMerged`, `emsGetStudentCount`, `emsGetUserById`, `emsFetchUsersByFilter`, `emsFetchStudentsForClass`, `emsFetchStaffByType` |
| **Updated** | `dashboard.js` — `emsGetUsersMerged` / `emsGetUserById` / `emsGetStudentCount` |
| **Updated** | `finance.js` — class student selects + bulk fee via `emsFetchStudentsForClass` |
| **Updated** | `attendance.js` — smart register loads students/teachers/staff via Firestore queries |
| **Updated** | `ems-registration-repository.js` — invalidates user query cache on upsert/remove |
| **Indexes** | `Registrations`: `type + class`, `type + timestamp` |
| **Tests** | `tests/unit/ems-user-access-e7s2.test.js` (5 tests) |

## Performance impact (expected)

| Metric | Before | After E7-S2 |
|--------|--------|-------------|
| Dashboard user reads | Full `JSON.parse(ems_full_users)` | `emsGetUsersMerged` → cache / IDB |
| Finance class picker | All students in memory | **Firestore `type + class`** query |
| Attendance register | Full user mirror scan | **Per-class / per-type** Firestore fetch |
| Repeated queries | Re-fetch every call | **TTL query cache** (60 s) |

## Next (E7-S3)

- Rejected collection pagination parity with registration repo
- Migrate remaining modules (`training.js`, `curriculum.js`, `ems-idcard.js`) to `emsCacheGet` only
- Deploy firestore indexes if not yet live: `firebase deploy --only firestore:indexes`

## Verify

```bash
npm test          # 174/174
npm run benchmark
```

Hard refresh production: **Ctrl+Shift+R**
