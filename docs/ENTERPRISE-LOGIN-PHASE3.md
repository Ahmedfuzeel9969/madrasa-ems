# Enterprise Login — Phase 3: Hardening & Parent Permissions

**Date:** 2026-06-19  
**Builds on:** Phase 1 + Phase 2

---

## Summary

Phase 3 closes security gaps: **Access Key expiry**, **Firestore-backed parent permissions**, **temporary grant enforcement in rules**, and **server-side parent view gates**.

---

## Changes

### 1. Access Key Expiry

| Layer | Field | Default TTL |
|-------|-------|-------------|
| Teacher keys | `StaffPermissions.accessKeyExpiresAt` | 365 days |
| Parent keys | `ParentAccessKeys.accessKeyExpiresAt` | 365 days |

- Client: `access-keys.js` — `emsIsAccessKeyExpired()`, verify skips expired keys
- Server: `functions/lib/access-keys.js` — returns `{ ok: false, reason: 'expired' }`
- Admin UI shows "365 دن" when generating keys

### 2. Parent Permissions — Firestore authoritative

| Before | After |
|--------|-------|
| Runtime read localStorage only | Parent login pulls `Admin` group → `ParentPermissions` |
| `checkParentViewAccess` temp key bug (`view.x` vs `x`) | Delegates to `parentCanView()` |
| No view gate on login | `emsParentHasAnyView()` — deny if zero views |

**Flow:**
```
Parent Google + Access Key
  → emsPullModuleGroup('Admin')
    → emsParentHasAnyView() ?
      → Parent Portal
```

**Storage:** `All_Madrasas/{tenantId}/ParentPermissions/{studentId}` (synced via `direct-firestore.js`)

### 3. Temporary Grants — `expiryAt` (ms)

Staff and parent temporary grants now include:
```javascript
{ expiry: ISO string, expiryAt: number, grantedBy, grantedAt, days }
```

Used by:
- Client: `security-layer.js`, `admin-panel.js`
- Firestore rules: `staffTempGrantActive`, `parentHasView`

### 4. Firestore Rules (Phase 3)

| Helper | Purpose |
|--------|---------|
| `staffTempGrantActive(madrasaId, tempKey)` | Temporary staff action active |
| `staffTempModuleAccess(madrasaId, moduleId)` | Temp view/create/edit/delete |
| `parentHasView(madrasaId, studentId, viewId)` | Parent permanent + temp views |
| Updated `staffHasAction` | Includes temp grants |

### 5. Server Parent Data API

`functions/lib/parent-data.js`:
- `assertParentViewPermission()` before returning attendance/results/fee/announcements
- Denies if view not in `ParentPermissions.views` or active `temporary`

---

## Files Modified

| File | Change |
|------|--------|
| `access-keys.js` | Expiry fields + checks |
| `functions/lib/access-keys.js` | Server expiry validation |
| `security-layer.js` | `emsParentHasAnyView`, fixed parent view checks |
| `admin-panel.js` | `expiryAt` on temp grants, key TTL |
| `auth.js` | Parent login pulls Admin permissions |
| `identity-gate.js` | Expired key messaging |
| `firestore.rules` | Temp grants + parent view helpers |
| `functions/lib/parent-data.js` | View permission enforcement |

---

## Deploy

```powershell
firebase deploy --only firestore:rules
firebase deploy --only functions:verifyTeacherAccessKey,functions:verifyParentAccessKey,functions:getParentStudentData,functions:getParentLinkedStudents
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

## Admin Checklist

1. **Parent:** Link Gmail → Generate Parent Key → Set **Parent Permissions** views → Save
2. **Staff temp grant:** Grant temporary module/action → auto includes `expiryAt`
3. **Expired keys:** Regenerate from Admin Panel (365-day default)

---

## Phase 4 (next)

- Admin-configurable key TTL UI
- Firestore-trigger auto materialize temp grants
- Parent CF-only data path (remove client-side student reads)
- Full E2E login smoke tests

---

*End of Phase 3 Report*
