# Multi-Department System — Phase D Report

**Status:** Complete (local, not production-deployed)  
**Cache bust:** `dept4` in `index.html`  
**Depends on:** Phases A–C

---

## Goal

Backfill `departmentId` on legacy records (local + optional Firestore), add composite indexes for future server-side queries, and provide an admin migration UI.

---

## Migration Utility (`department-migration.js`)

| API | Purpose |
|-----|---------|
| `emsDeptMigrationScan()` | Count records missing `departmentId` per store |
| `emsDeptMigrationScanComplaints()` | IndexedDB complaints scan |
| `emsDeptMigrationApplyLocal()` | Backfill localStorage + IndexedDB |
| `emsDeptMigrationApplyFirestore()` | Merge `departmentId` into Firestore docs |
| `emsDeptMigrationGetStatus()` | Read `ems_dept_migration_log` |
| `emsDeptMigrationRenderUI()` | Admin panel refresh |
| `emsDeptMigrationRunLocal()` / `RunFirestore()` | UI actions with confirm |

### Inference (`department-context.js`)

`emsInferDepartmentId(record)` heuristics:

- Existing valid `departmentId` → kept
- `audience: all` → `all` (institution-wide)
- Text hints: طالبات/girls → girls; حفظ/hifz → hifz track
- Otherwise → `boys_dars` (default)

`emsRecordNeedsDepartmentMigration(record)` — true when `departmentId` absent or invalid.

---

## Local Stores Migrated

- `ems_full_users`, `ems_rejected_users`
- `ems_fee_collections` (from linked student when possible)
- `ems_full_ledger`, `ems_announcements`, `ems_full_announcements`
- `ems_full_exams` (from studentId)
- Training keys (`ems_tar_*`), curriculum (`ems_cur_*`)
- `ems_payroll_history` (from staffId)
- `att_rec_*` attendance sheets
- Complaints via `CmpIDB.saveAll`

---

## Firestore Sync (optional)

Merge writes on `All_Madrasas/{tenant}/`:

- `Registrations`, `Rejected`, `LedgerEntries`, `Announcements`

Batched commits (400 ops per batch). Requires login + tenant context.

---

## Firestore Indexes (`firestore.indexes.json`)

Added composite indexes (`departmentId` ASC + `timestamp` DESC):

- Registrations, Rejected, LedgerEntries, Announcements, Attendance

Deploy with: `npm run deploy:firestore` (when ready for production).

---

## Admin UI

**سسٹم سیٹنگز → شعبہ مائیگریشن**

1. Scan — preview missing counts  
2. **مقامی Backfill** — local only  
3. **Firestore Sync** — cloud merge (optional second step)

Log stored in `ems_dept_migration_log`.

---

## Recommended Run Order

1. Hard refresh (`dept4` cache)
2. Open **سسٹم سیٹنگز → شعبہ مائیگریشن**
3. Review scan table
4. Run **مقامی Backfill**
5. Verify modules (Registration, Finance, Dashboard)
6. If online: **Firestore Sync**
7. Deploy indexes: `firebase deploy --only firestore:indexes`

---

## Risks

1. **Heuristic inference** — ambiguous legacy records default to `boys_dars`; review girls/hifz classes manually if needed.
2. **Firestore sync** — merge only; does not delete or overwrite existing `departmentId`.
3. **Complaints saveAll** — rewrites full IndexedDB store (same pattern as cloud restore).
4. **Indexes** — deploy required before server-side `where('departmentId','==',…)` queries.

---

## Tests

```bash
npm test -- tests/unit/department-migration.test.js
npm test -- tests/unit/department-context.test.js
```

---

## Multi-Department System — Complete

| Phase | Scope | Status |
|-------|--------|--------|
| A | Selector + context | ✅ |
| B | Student module filters | ✅ |
| C | Optional global filters | ✅ |
| D | Migration + indexes | ✅ |

Production deploy (hosting + firestore indexes) when explicitly requested.
