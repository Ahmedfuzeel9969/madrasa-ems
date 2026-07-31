# Multi-Department System — Phase C Report

**Status:** Complete (local, not production-deployed)  
**Cache bust:** `dept3` in `index.html`  
**Depends on:** Phase A (selector) + Phase B (filter/stamp helpers)

---

## Goal

Add **optional** department filters to institution-wide modules.  
Default: show **all departments** (full institution view).  
When checkbox enabled: narrow display to current ribbon department.

---

## Core API (extended in `department-context.js`)

| Function | Purpose |
|----------|---------|
| `emsIsOptionalDeptFilterOn(moduleId)` | Read persisted toggle (`ems_opt_dept_filter_{module}`) |
| `emsSetOptionalDeptFilter(moduleId, on)` | Persist + dispatch `ems:dept-opt-filter-changed` |
| `emsApplyOptionalDeptFilter(records, moduleId)` | Filter when toggle ON |
| `emsFilterCollectionsByStudentDept(collections, users)` | Finance fee collections via student dept |
| `emsIsInstitutionWideRecord(record)` | Announcements with `audience: all` stay visible |
| `emsMountOptionalDeptFilter(mountId, moduleId, onChange)` | Checkbox UI |

---

## UI

Each global module has a checkbox bar below the ribbon:

- **فیس سسٹم** → `#fin-opt-dept-filter`
- **مالیات و تنخواہ** → `#ldg-opt-dept-filter`
- **اعلانات** → `#ann-opt-dept-filter`

Label: **صرف موجودہ شعبہ (…)** — reflects active ribbon department.

---

## Module Behavior

### Finance (`finance.js`)
- Toggle OFF: all students, all collections (unchanged legacy behavior)
- Toggle ON: students + collections filtered by student `departmentId`
- New fee collections stamped with student's department
- Dashboard, dues list, mini reports respect toggle

### Ledger & Payroll (`ledger.js`)
- Toggle OFF: all ledger entries, all payroll staff
- Toggle ON:
  - Ledger entries: match `departmentId` OR entries without `departmentId` (institution overhead)
  - Payroll generate: teachers/staff filtered by department
  - Payroll history: filtered by employee department
- New ledger entries stamped with current department

### Announcements (`announcements.js`)
- Toggle OFF: all announcements
- Toggle ON: department-specific + institution-wide (`audience: all` / `departmentId: all`)
- New announcements: `audience: all` → `departmentId: all`; others stamped with current dept
- `annNormalizeItem` preserves `departmentId`

---

## Files Modified

| File | Changes |
|------|---------|
| `department-context.js` | Optional filter API + mount helper |
| `style.css` | `.ems-opt-dept-filter-*` styles |
| `index.html` | Filter mount points + cache `dept3` |
| `finance.js` | Filter helpers, stamp collections, refresh |
| `ledger.js` | Entry/payroll filter, stamp entries, refresh |
| `announcements.js` | Display filter, stamp on save, refresh |

---

## Not in Phase C

- Dashboard finance/announcement cards still use Phase B dept scope (student modules)
- Bulk migration (Phase D)
- Firestore composite indexes (Phase D)

---

## Testing Checklist

- [ ] Finance: toggle OFF → all students in dues; ON → current dept only
- [ ] Finance: collection save gets student departmentId
- [ ] Ledger: toggle OFF → all entries; ON → dept + undepartmented entries
- [ ] Payroll generate respects toggle
- [ ] Announcements: institution-wide (`تمام مدرسہ`) visible even when toggle ON
- [ ] Department-specific announcement only visible when toggle ON + matching dept
- [ ] Switch ribbon department → filter label updates; data refreshes if toggle ON

---

## Tests

```bash
npm test -- tests/unit/department-context.test.js
```

Phase C adds 2 static tests (optional filter API + UI wiring).

---

## Next: Phase D

Bulk migration utility, Firestore indexes, backfill `departmentId` on legacy records — await approval.
