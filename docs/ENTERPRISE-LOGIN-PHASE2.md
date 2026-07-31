# Enterprise Login — Phase 2: Permissions & RBAC

**Date:** 2026-06-19  
**Builds on:** Phase 1 (`docs/ENTERPRISE-LOGIN-PHASE1.md`)

---

## Summary

Phase 2 activates **Admin Panel StaffPermissions** as the authoritative source for teacher/staff module access. Phase 1 hard-blocks (dashboard-only) are removed; navigation and ribbon tabs now respect **license + StaffPermissions + temporary grants**.

---

## Changes

### 1. Staff RBAC enforcement (client)

| File | Change |
|------|--------|
| `security-layer.js` | `CURRENT_STAFF_LINK.staffId` used for permission lookup; `emsStaffHasAnyModule`, `emsGetStaffAllowedModules`, improved `emsCheckFullModuleAccess` |
| `auth.js` | Removed dashboard-only staff block; staff uses `isModuleTabAllowed` / RBAC; teacher login pulls Admin permissions before unlock |
| `portal-access.js` | Dynamic teacher modules; `emsFindFirstAllowedModuleTab()` for post-login routing |
| `landing.css` | Removed CSS hard-hide of non-dashboard tabs (RBAC handles visibility) |
| `identity-gate.js` | After access key + permission pull, deny if no module grants |

### 2. JWT claims sync on permission save

| Component | Detail |
|-----------|--------|
| `admin-panel.js` | `apPushStaffClaimsForStaffId()` after `apSaveStaffPerm` |
| `security-layer.js` | `emsSyncStaffClaimsForMember(tenantId, targetUid)` |
| `functions/lib/staff-claims.js` | New callable `syncStaffClaimsForMember` (owner/SA only) |

### 3. Server-side Access Key verification

| Callable | Purpose |
|----------|---------|
| `verifyTeacherAccessKey` | Validates key against `StaffPermissions.accessKeyHash` + active Staff Link |
| `verifyParentAccessKey` | Validates key against `ParentAccessKeys` + active Parent Link |

Client (`access-keys.js`) uses Cloud Function first, falls back to client hash compare.

---

## Permission flow (Teacher)

```
Google Auth
  → Identity Gate (Staff Link + Access Key)
    → Pull StaffPermissions from Firestore
      → emsStaffHasAnyModule() ?
        → Yes: ribbon filtered by checkStaffModuleAccess(mod, 'view')
        → No: Access Denied
```

---

## StaffPermissions document

Path: `All_Madrasas/{tenantId}/StaffPermissions/{staffId}`

```javascript
{
  staffId, status, template,
  modules: { attendance: true, exams: true, ... },
  actions: { attendance: { view, create, edit, delete, ... } },
  temporary: { "attendance.create": { expiry, grantedBy, ... } },
  accessKeyHash, accessKeyIssuedAt
}
```

---

## Action guards (existing, Phase 2 aligned)

Modules use `emsRequireStaffAction(modId, action)` for write operations:
- admission, attendance, exams, finance, ledger, curriculum, training, complaints, announcements

---

## Deploy

```powershell
firebase deploy --only functions:syncStaffClaimsForMember,functions:verifyTeacherAccessKey,functions:verifyParentAccessKey
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

## Admin checklist

1. Staff record create + **Staff Link** (Gmail)
2. **Teacher Access Key** generate
3. **Staff Permissions** — enable modules/actions
4. Save → JWT claims auto-sync for linked staff

---

## Phase 3 (next)

- Firestore rules support for `temporary` grants (or materialize via CF)
- Parent view permissions move from localStorage → Firestore
- Key expiry rules (`accessKeyExpiresAt`)
- `assertStaffAction` callable for sensitive client-only operations

---

*End of Phase 2 Report*
