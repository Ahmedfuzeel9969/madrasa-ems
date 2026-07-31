# Multi-Department System — Phase B Report

**Status:** Complete (local, not production-deployed)  
**Cache bust:** `dept2` in `index.html`  
**Depends on:** Phase A (`department-context.js`, `department-selector.js`)

---

## Goal

Filter student-related modules by active department (`record.departmentId === EMS_CURRENT_DEPARTMENT`).  
Display-only filtering — full dataset remains in localStorage / Firestore. No schema breaking changes.

---

## Core API (extended in `department-context.js`)

| Function | Purpose |
|----------|---------|
| `emsFilterByDepartment(records)` | Display filter; missing `departmentId` → `boys_dars` |
| `emsStampDepartment(record)` | Set `departmentId` on new saves if absent |
| `emsRegisterDepartmentRefresh(moduleId, fn)` | Register UI refresh on department change |
| `emsRefreshDepartmentModules()` | Called on `ems:department-changed` |

---

## Files Modified

| File | Changes |
|------|---------|
| `department-context.js` | Filter, stamp, refresh registry + event listener |
| `admission.js` | Stamp on save; filter reg/rejected tables; refresh handler |
| `ems-import-export.js` | `cleanRecord()` stamps `departmentId` |
| `dashboard.js` | Dept-scoped counts; institution total widget; complaints/activity filter; refresh |
| `attendance.js` | Filter users/dropdowns; stamp attendance docs; refresh |
| `exams.js` | `exmGetUsers()` filter; stamp marks; refresh |
| `complaints.js` | Filter list; stamp new complaints; refresh |
| `training.js` | Filter users + records; stamp entries; refresh |
| `curriculum.js` | Filter teachers/plans/daily; stamp plans/entries; refresh |
| `parent-portal.js` | Filter linked students by dept; refresh |
| `index.html` | Institution hint UI + cache `dept2` |

---

## Firestore / Storage (additive only)

New optional field on records:

```json
{ "departmentId": "boys_dars" | "boys_hifz" | "girls_dars" | "girls_hifz" }
```

**Paths affected (merge writes only):**

- `All_Madrasas/{tenant}/Registrations/{id}` — via admission + import
- `All_Madrasas/{tenant}/Rejected/{id}` — via admission
- `All_Madrasas/{tenant}/Attendance/{dbKey}` — `departmentId` on sheet metadata
- Exam marks, complaints (IndexedDB + cloud sync), training/curriculum local keys — stamped on create

**No composite indexes added.** Server-side `where('departmentId', '==', …)` deferred to Phase D.

---

## Migration Status

**None.** Legacy records without `departmentId` are treated as `boys_dars` via `emsResolveRecordDepartmentId()`.

Bulk backfill utility planned for Phase D.

---

## Not in Phase B (Phase C / D)

- Finance, Ledger, Announcements optional dept filters (Phase C)
- Firestore query-level filtering / indexes (Phase D)
- Bulk migration script (Phase D)
- Dedicated Library module (does not exist; book list lives in exams/curriculum)

---

## Risks

1. **Cross-dept visibility:** Staff switching department sees filtered view only; underlying data unchanged.
2. **Legacy data:** All old records appear under **Boys → Dars-e-Nizami** until migrated or re-saved.
3. **Attendance sheets:** Existing sheets without `departmentId` still load; new saves get stamped.
4. **Promotion (exams):** Offline promotion updates filtered user list only — verify cross-dept edge cases in Phase D.

---

## Testing Checklist

- [ ] Switch department in ribbon → tables/dashboard refresh without reload
- [ ] New student registration → `departmentId` set to active department
- [ ] Import CSV/Excel → imported rows get current `departmentId`
- [ ] Dashboard: subcard counts change; institution total stays all-dept
- [ ] Attendance register shows only current-dept students for class
- [ ] Exams mark entry lists only current-dept students
- [ ] Complaints list filtered; new complaint stamped
- [ ] Training prayer/ethics lists filtered
- [ ] Curriculum planning list filtered by plan `departmentId`
- [ ] Parent portal (admin view) shows linked students for active dept only
- [ ] Switch back to `boys_dars` → legacy records visible

---

## Tests

```bash
npm test -- tests/unit/department-context.test.js
```

Phase B adds 3 static tests (helpers + module wiring + import stamp).

---

## Next: Phase C

Optional department filters for Finance, Payroll, Announcements — await user approval.
