# Registration Permissions — Implementation Report

**Sprint:** 5 (Week 9–10)  
**Date:** 9 July 2026  
**Status:** ✅ COMPLETE  
**Scope:** Registration department only

---

## Goal

Enforce fine-grained Registration permissions on UI and API paths for Owner, Admin, Teacher, Staff, and Parent — with offline cache and backward compatibility.

---

## Permission Actions

| Action | API Guard | UI Hidden When Denied |
|--------|-----------|------------------------|
| `view` | list/rejected tabs | محفوظ ریکارڈ / مسترد tabs |
| `create` | new save | approve on new record |
| `edit` | update save | edit buttons, form tabs |
| `delete` | `deleteRegistration` | delete buttons |
| `print` | ID card, letter, print | print/id/letter icons |
| `export` | `exportData`, `emsDoExport` | export buttons |
| `import` | `commit`, pending import | import panels |
| `approve` | restore / approve save | restore + approve |
| `reject` | reject save | reject buttons |
| `duplicate_override` | hard dup override | owner override button |
| `audit_view` | `emsRegGetAuditTrail` | audit read (masked) |

---

## Role Matrix (Default)

| Role | Access |
|------|--------|
| Owner / Admin | All actions |
| Teacher (staff template) | view, print |
| Staff / Reception | view, create, edit, print, reject |
| Parent | **None** (registration blocked) |
| No staff config (legacy) | Owner path preserved |

---

## Architecture

**New file:** `ems-registration-permissions.js`

| API | Purpose |
|-----|---------|
| `emsRegCan(action)` | Permission check |
| `emsRegRequire(action, ctx)` | Guard with toast + security log |
| `emsRegGetRole()` | owner / admin / teacher / staff / parent |
| `emsRegGuardUI()` | Hide tabs, buttons, row actions |
| `emsRegApplyTableActionGuards()` | Post-render row button visibility |
| `emsRegRefreshPermCache()` | Offline snapshot → localStorage |
| `emsRegPermForSave()` | Map save path → permission |

**Bridge:** Registration actions map to Admin Panel `ADMIN_ACTIONS` (`print`, `import`, `approve1`, etc.)

---

## Protected Entry Points

| File | Guards |
|------|--------|
| `admission.js` | save, delete, edit, print, duplicate override, row buttons |
| `ems-idcard.js` | `openIDCardModal` |
| `ems-import-export.js` | `commit`, `exportData` |
| `ems-import-wizard.js` | `emsDoExport`, `emsProcessPendingImport` |
| `ems-registration-duplicates.js` | override via `emsRegCan` |
| `ems-registration-audit.js` | `audit_view` via `emsRegCan` |

---

## Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| Tenant owner (non-staff) | Full access (unchanged) |
| Madrasa admin | Full access |
| No `apGetStaffPerm` loaded | Cached snapshot or owner fallback |
| Offline | `ems_reg_perm_snapshot_v1` in localStorage |
| Parent portal | Blocked from registration actions |

---

## Admin Panel Updates

- Added `print` and `import` to `ADMIN_ACTIONS`
- Teacher template: `admission: ['view', 'print']`
- Reception template: added `print`

---

## Tests

`tests/unit/ems-registration-permissions-s5.test.js` — **12 tests**

- Owner/admin full access
- Parent blocked
- Teacher view/print only
- Reception no delete/import
- Escalation blocked (`emsRegRequire`)
- Offline cache snapshot
- Audit view permission
- Duplicate override
- Wiring static checks

---

## Score Impact (Target)

| Dimension | Before | After Sprint 5 |
|-----------|--------|----------------|
| Security | 72 | **75+** |
| UX | 70 | **72** |
| Overall Registration | ~72 | **~75/100** |

---

## Deferred

- Server-side Firestore rules for staff write (Phase 1b — ops)
- Per-record audit viewer UI (Sprint 4 Phase 1b)

---

## Next

**Sprint 6 — Mobile Usability** — start only after user confirms Sprint 5 acceptance.
