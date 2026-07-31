# Enterprise Login — Phase 6: Reminders, Read Receipts, Security Policy, Auth E2E

**Date:** 2026-06-19  
**Builds on:** Phase 1–5

---

## Summary

Phase 6 completes the enterprise login hardening loop: **scheduled key rotation reminders**, **parent message read receipts**, **tenant security policy document**, and **identity gate auth E2E tests** with Firebase emulator config.

---

## Changes

### 1. Key Rotation Reminders

| Component | Detail |
|-----------|--------|
| `scheduledKeyRotationReminders` | Daily scan → materialize alerts |
| Storage | `All_Madrasas/{id}/KeyExpiryAlerts/{alertId}` |
| `getKeyExpiryAlerts` | Admin fetch active reminders |
| `dismissKeyExpiryAlert` | Owner dismisses reminder |

Respects `TenantSettings/securityPolicy.enableKeyExpiryAlerts`.

### 2. Parent Message Read Receipts

| Function | Marks |
|----------|-------|
| `markParentMessagesRead` role=`staff` | Parent → admin messages (`read`, `readAt`, `readBy`) |
| `markParentMessagesRead` role=`parent` | Admin → parent replies (`readByParent`, `readByParentAt`) |

- Admin thread open → CF + UI ✓ پڑھا
- Parent leave view → CF marks admin replies read

### 3. Tenant Security Policy

**Path:** `All_Madrasas/{tenantId}/TenantSettings/securityPolicy`

| Field | Default |
|-------|---------|
| `requireAccessKey` | true |
| `keyRotationReminderDays` | 30 |
| `enableKeyExpiryAlerts` | true |
| `parentDataCfOnly` | true |
| `parentMessagingCfOnly` | true |
| `enforceStaffRbac` | true |

Client: `tenant-security.js` — `emsLoadTenantSecurityPolicy`, `emsSaveTenantSecurityPolicy`  
Admin UI: **بیک اپ و سنک** tab → Security Policy checkboxes

### 4. Firebase Emulators + Auth E2E

`firebase.json` emulators: Auth `9099`, Firestore `8080`, Functions `5001`, Hosting `5000`, UI `4000`

| Test file | Coverage |
|-----------|----------|
| `tests/e2e/emulator-auth.spec.js` | Identity gate mock auth flows |
| `tests/unit/key-reminders.test.js` | Alert ID generation |

Run emulators locally:
```powershell
firebase emulators:start
```

Run auth E2E:
```powershell
npm run test:e2e -- tests/e2e/emulator-auth.spec.js
```

---

## Deploy

```powershell
firebase deploy --only firestore:rules
firebase deploy --only functions:scheduledKeyRotationReminders,functions:getKeyExpiryAlerts,functions:dismissKeyExpiryAlert,functions:markParentMessagesRead
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

## Phase 7 (next)

- Email/push notifications for key expiry
- Full emulator integration test with seeded Firestore
- Security policy enforcement in identity-gate runtime
- Audit log export for compliance

---

*End of Phase 6 Report*
