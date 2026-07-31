# Registration Permission Matrix

**Date:** 9 July 2026  
**Phase:** 1 — Priority 5  
**Status:** Design document (pre-implementation)

---

## Current State

### Three permission layers exist — but only one is enforced

| Layer | Location | Enforced? | Detail |
|-------|----------|-----------|--------|
| **Firestore rules** | `firestore.rules` L87–89 | ✅ Server | `canWriteRegistration` = owner + MFA or superadmin |
| **Admin panel presets** | `admin-panel.js` L54–62, L1074–1080 | ⚠️ Stored only | `staffCanDo()` API exists but **admission.js never calls it** |
| **Client UI** | `admission.js` | ❌ None | All tabs/buttons visible to any logged-in user |

### Existing `ADMIN_ACTIONS` (global across modules)

| Action ID | Urdu Label | Used in admission? |
|-----------|------------|-------------------|
| `view` | دیکھیں | ❌ Not checked |
| `create` | بنائیں | ❌ Not checked |
| `edit` | ترمیم | ❌ Not checked |
| `delete` | حذف | ❌ Not checked |
| `export` | رپورٹ/ایکسپورٹ | ❌ Not checked |
| `approve1` | منظوری سطح 1 | ❌ Not checked |
| `approve2` | منظوری سطح 2 | ❌ Not checked |

### Preset role: Reception

```javascript
// admin-panel.js L1074–1080
reception: {
  actions: {
    admission: ['view', 'create', 'edit']  // no delete, no export
  }
}
```

**This preset is configured but never applied in the Registration UI.**

---

## Proposed Registration Permission Matrix

### New registration-specific actions

| Action ID | Urdu Label | Description | Maps to ADMIN_ACTION |
|-----------|------------|-------------|---------------------|
| `reg_view` | دیکھیں | View saved records, search | `view` |
| `reg_create` | نیا داخلہ | Create new student/teacher/staff | `create` |
| `reg_edit` | ترمیم | Edit existing records | `edit` |
| `reg_delete` | حذف | Delete records | `delete` |
| `reg_reject` | مسترد | Reject applications | `edit` |
| `reg_restore` | بحالی | Restore from rejected | `edit` |
| `reg_print` | پرنٹ | Print ID cards, letters | *(new)* |
| `reg_export` | ایکسپورٹ | Export registration data | `export` |
| `reg_import` | بلک امپورٹ | Bulk CSV/Excel import | *(new)* |
| `reg_branding` | برانڈنگ | Edit logos, signatures | `edit` (owner) |
| `reg_dr` | ڈیزاسٹر ریکوری | Cloud disaster recovery | *(owner only)* |
| `reg_dup_override` | Duplicate Override | Override hard duplicate block | `approve1` |

### Role × Permission Matrix

| Permission | Owner | Reception | Teacher | Accountant | Exam Officer | Supervisor |
|------------|-------|-----------|---------|------------|--------------|------------|
| `reg_view` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `reg_create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `reg_edit` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `reg_delete` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `reg_reject` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `reg_restore` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `reg_print` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `reg_export` | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `reg_import` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `reg_branding` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `reg_dr` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `reg_dup_override` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

> Owner always has all permissions. Matrix configurable per staff in Admin Panel.

---

## UI Enforcement Map

### Tab visibility

| Tab | Required Permission | Hide if missing |
|-----|-------------------|-----------------|
| طلباء (Students) | `reg_create` or `reg_edit` | View-only → redirect to list |
| اساتذہ (Teachers) | `reg_create` or `reg_edit` | Same |
| عملہ (Staff) | `reg_create` or `reg_edit` | Same |
| برانڈنگ | `reg_branding` | Hide tab |
| محفوظ ریکارڈ | `reg_view` | Hide tab |
| مسترد شدہ | `reg_view` | Hide tab |
| امپورٹ/ایکسپورٹ | `reg_import` or `reg_export` | Hide tab |

### Button visibility (saved records table)

| Button | Permission | Element |
|--------|-----------|---------|
| Edit | `reg_edit` | Row edit icon |
| Delete | `reg_delete` | Row delete icon |
| ID Card | `reg_print` | Row ID card icon |
| Letter | `reg_print` | Row letter icon |
| Approve (form) | `reg_create` | Form approve button |
| Reject (form) | `reg_reject` | Form reject button |
| Import wizard | `reg_import` | Data panel import button |
| Export | `reg_export` | Data panel export button |
| DR buttons | `reg_dr` | Desktop recovery buttons |

---

## Implementation API

### Client-side guard

```javascript
// New: ems-registration-permissions.js

function emsRegCan(action) {
  // 1. If user is owner → true
  // 2. If superadmin → true
  // 3. Get current staffId from auth session
  // 4. return staffCanDo(staffId, 'admission', actionMap[action])
  // 5. Fallback: if no staff perms configured → owner-only (current behavior)
}

function emsRegGuardUI() {
  // Called on RegistrationModule.init()
  // Hide/disable elements based on emsRegCan()
  // Uses data-reg-perm="reg_delete" attributes on buttons
}
```

### Action mapping

```javascript
var REG_PERM_MAP = {
  reg_view: 'view',
  reg_create: 'create',
  reg_edit: 'edit',
  reg_delete: 'delete',
  reg_export: 'export',
  reg_import: 'create',       // until 'import' added to ADMIN_ACTIONS
  reg_print: 'view',          // until 'print' added to ADMIN_ACTIONS
  reg_dup_override: 'approve1'
};
```

### Server-side (Firestore rules — Phase 1b)

Current: owner-only write. Proposed: allow staff with `StaffPermissions` write access.

```
function canStaffWriteRegistration(madrasaId) {
  return canWriteRegistration(madrasaId)  // owner
    || (staffPermExists(madrasaId)
        && staffPerm(madrasaId).modules.admission == true
        && staffPerm(madrasaId).actions.admission.create == true);
}
```

**Important:** Server rules change is Phase 1b — client enforcement first (Phase 1a) to avoid breaking existing deployments.

---

## Admin Panel Updates

### Add new actions to `ADMIN_ACTIONS`

```javascript
{ id: 'print', name: 'پرنٹ', icon: 'fa-print' },
{ id: 'import', name: 'بلک امپورٹ', icon: 'fa-file-import' }
```

### Update reception preset

```javascript
reception: {
  actions: {
    admission: ['view', 'create', 'edit', 'print']  // add print
  }
}
```

### New teacher preset addition

```javascript
teacher: {
  actions: {
    admission: ['view', 'print']  // lookup + ID card only
  }
}
```

---

## Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| No staff permissions configured | Owner-only (current behavior preserved) |
| Staff with `admission: ['view']` only | Can see list, cannot edit/create |
| Offline mode | Permissions cached in localStorage from last login |
| Parent portal user | No registration access (unchanged) |
| Guest demo | Read-only demo data (unchanged) |

---

## Implementation Plan

### Phase 1a (Week 1–2) — Client UI only

- [ ] Create `ems-registration-permissions.js`
- [ ] Add `data-reg-perm` attributes to `index.html` registration buttons
- [ ] Call `emsRegGuardUI()` in `RegistrationModule.init()`
- [ ] Guard `processRegistration` — check `reg_create`/`reg_edit` before save
- [ ] Guard `deleteRegistration` — check `reg_delete`
- [ ] Unit tests for permission checks

### Phase 1b (Week 3–4) — Server enforcement

- [ ] Update Firestore rules for staff write
- [ ] Add `print` and `import` to `ADMIN_ACTIONS`
- [ ] Update admin panel presets
- [ ] E2E: reception staff cannot delete

---

## Estimated Score Impact

| Dimension | Before | After P5 |
|-----------|--------|----------|
| Security | 58 | 75 |
| User Experience | 62 | 68 |
| Global Readiness | 42 | 55 |

---

*Next step: Phase 1a — create ems-registration-permissions.js with client-side guards only.*
