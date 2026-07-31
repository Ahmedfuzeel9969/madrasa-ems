# Enterprise Login — Phase 5: Tenant TTL, Parent Messaging CF, Key Expiry Dashboard

**Date:** 2026-06-19  
**Builds on:** Phase 1–4

---

## Summary

Phase 5 adds **Firestore-backed tenant default key TTL**, **Cloud Function parent messaging**, **admin key expiry dashboard**, and **extended auth E2E tests**.

---

## Changes

### 1. Tenant Default Access Key TTL

| Storage | Path |
|---------|------|
| Firestore | `All_Madrasas/{tenantId}/TenantSettings/accessKeys` |
| Fields | `defaultTtlDays`, `updatedAt`, `updatedBy` |

- Admin UI: **بیک اپ و سنک** tab → "Access Key — ادارہ ڈیفالٹ TTL"
- Key generation dropdowns use tenant default (cached in `EMS_TENANT_KEY_TTL_DAYS`)
- Client: `emsLoadTenantAccessKeySettings`, `emsSaveTenantAccessKeySettings`

### 2. Parent Messaging via Cloud Functions

| Function | Purpose |
|----------|---------|
| `submitParentMessage` | Parent sends message (link-validated) |
| `getParentMessages` | Fetch thread(s) for parent or staff |
| `listParentMessageThreads` | Admin comm center summary |

- `parent-portal.js`: submit + sync via CF
- `admin-panel.js`: parent role uses CF; admin test compose keeps direct Firestore write

### 3. Key Expiry Dashboard

| Function | Purpose |
|----------|---------|
| `getAccessKeyExpiryReport` | Scan expiring/expired teacher + parent keys |

- Admin UI table in backup tab with quick link to regenerate keys
- Shows expired + expiring within 30 days

### 4. Firestore Rules

```
match /TenantSettings/{docId} {
  allow read: if canReadTenantStaff(madrasaId);
  allow write: if canManageTenantAccess(madrasaId) || isSuperAdmin();
}
```

### 5. E2E / Unit Tests

| File | Coverage |
|------|----------|
| `tests/e2e/login-auth.spec.js` | Access key shell, portal session, identity helpers |
| `tests/unit/access-key-expiry.test.js` | Expiry status logic |

---

## Files Modified / Added

| File | Change |
|------|--------|
| `access-keys.js` | Tenant TTL load/save |
| `admin-panel.js` | TTL settings UI, expiry dashboard, CF parent submit |
| `parent-portal.js` | CF messaging sync + leave view |
| `functions/lib/parent-messages.js` | **new** |
| `functions/lib/access-key-expiry.js` | **new** |
| `functions/index.js` | exports |
| `firestore.rules` | TenantSettings |
| `index.html` | Admin UI sections |

---

## Deploy

```powershell
firebase deploy --only firestore:rules
firebase deploy --only functions:submitParentMessage,functions:getParentMessages,functions:listParentMessageThreads,functions:getAccessKeyExpiryReport
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

## Admin Checklist

1. **بیک اپ و سنک** → set default TTL (e.g. 90 days) → Save
2. Review **Key Expiry** table — regenerate expired keys
3. Parent messages now route through secure CF when parent logs in

---

## Phase 6 (next)

- Key rotation email/push reminders
- Firebase Auth emulator E2E (full Google flow)
- Parent message read receipts via CF
- Tenant-wide security policy document

---

*End of Phase 5 Report*
