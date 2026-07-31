# Multi-Department / Multi-Branch — Phase A Report

**Date:** 2026-06-19  
**Status:** ✅ Complete — **awaiting approval before Phase B**

---

## Scope (Phase A only)

Global **department context system** + **permanent UI selector** in the main ribbon bar.  
No module filtering, no Firestore writes, no migration.

---

## 1. Files modified / added

| File | Action |
|------|--------|
| `department-context.js` | **Added** — context API, registry, localStorage |
| `department-selector.js` | **Added** — ribbon dropdown + ⋮ menu UI |
| `index.html` | **Modified** — selector in `ribbon-actions`, script tags |
| `style.css` | **Modified** — `.ems-dept-*` styles |
| `tests/unit/department-context.test.js` | **Added** — smoke tests |
| `docs/MULTI-DEPARTMENT-PHASE-A.md` | **Added** — this report |

**Not touched:** Registration, Attendance, Exams, Finance, Firestore rules, sync engine.

---

## 2. Firestore paths affected

**None in Phase A.**  
No new collections. No `departmentId` field writes yet.

Planned (Phase B+): additive field `departmentId` on existing docs under `All_Madrasas/{tenantId}/...`

---

## 3. Migration status

**Not started.**  
Default for future migration documented: missing `departmentId` → `boys_dars`.

Helper stubs only (no data changes):

- `emsResolveRecordDepartmentId(record)`
- `emsRecordMatchesDepartment(record, departmentId)`

---

## 4. Global context API

| Symbol | Purpose |
|--------|---------|
| `window.EMS_CURRENT_DEPARTMENT` | Active code (`boys_dars` default) |
| `localStorage.ems_current_department` | Persistence |
| `emsGetDepartmentId()` | Current id |
| `emsGetDepartment()` | Full meta object |
| `emsSetDepartment(id)` | Change + persist + toast |
| `emsListDepartments()` | All four departments |
| `emsIsDepartmentScopedModule(id)` | Phase B module list |
| `emsIsGlobalModule(id)` | Finance, Ledger, etc. |
| Event `ems:department-changed` | UI / future module refresh |

### Department codes

| Code | Label |
|------|--------|
| `boys_dars` | Boys → Dars-e-Nizami |
| `boys_hifz` | Boys → Hifz |
| `girls_dars` | Girls → Dars-e-Nizami |
| `girls_hifz` | Girls → Hifz |

---

## 5. UI placement

- **Ribbon top bar** → right side (`ribbon-actions`), before logout
- **Dropdown** `#ems-dept-select` — desktop
- **Three-dot menu** `#ems-dept-more-btn` → `#ems-dept-menu` — mobile / quick pick
- Selection survives refresh (localStorage)

---

## 6. Remaining risks

| Risk | Mitigation (later phases) |
|------|---------------------------|
| Existing records have no `departmentId` | Phase D migration → `boys_dars` |
| Module lists still show all data | Phase B filtering |
| Finance/Announcements need optional scope | Phase C `departmentId: "all"` |
| Firestore composite indexes for `where(departmentId)` | Phase B index audit |
| Parent portal multi-department students | Phase B design review |

---

## 7. Testing checklist

- [ ] Login → ribbon shows department dropdown (4 options)
- [ ] Default = **طلبہ — درس نظامی** (`boys_dars`)
- [ ] Change department → toast appears
- [ ] Refresh page → same department selected
- [ ] ⋮ menu opens/closes; picking item updates selection
- [ ] Mobile width: badge + ⋮ menu visible
- [ ] `npm test -- tests/unit/department-context.test.js` passes
- [ ] Existing modules behave **unchanged** (no filter yet)

---

## 8. Next phase (blocked until approval)

**Phase B:** Integrate `departmentId` + filtering into student-related modules (Dashboard, Registration, Attendance, Exams, Complaints, Training, Curriculum, Parent Portal).

**Do not start Phase B without explicit approval.**

---

*End of Phase A Report*
