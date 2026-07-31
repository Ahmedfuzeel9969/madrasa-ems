# Enterprise Login — Phase 7: Notifications, Policy Runtime, Audit Export

**Date:** 2026-06-19  
**Builds on:** Phase 1–6

---

## Summary

Phase 7 closes the enterprise login compliance loop: **key expiry notification queue**, **security policy runtime enforcement in identity gate**, **admin SecurityLog export**, and **emulator seed + integration tests**.

---

## Changes

### 1. Key Expiry Notifications

| Component | Detail |
|-----------|--------|
| `functions/lib/key-notifications.js` | Queues `KeyExpiryNotifications`, admin `Announcements` batch |
| Hook | `scheduledKeyRotationReminders` → `dispatchKeyExpiryNotifications` |
| Storage | `All_Madrasas/{id}/KeyExpiryNotifications/{notifyId}` |
| Channel | `email_queue` when `notifyOwnerOnKeyExpiry` + owner email; else `in_app` |

### 2. Security Policy Runtime (Identity Gate)

| Behavior | Detail |
|----------|--------|
| `emsEnsureTenantSecurityPolicy` | Loaded before teacher/parent key gate |
| `requireAccessKey: false` | Skips access key prompt; proceeds to portal |
| `auth.js` | Loads policy on madrasa profile unlock |

### 3. Audit Log Export

| Function | Detail |
|----------|--------|
| `exportSecurityLog` | Callable — owner-only JSON or CSV export |
| Admin UI | JSON / CSV buttons in backup tab |

### 4. Emulator Seed + Integration Tests

| Asset | Purpose |
|-------|---------|
| `scripts/seed-emulator-login.js` | Seeds demo tenant |
| `tests/e2e/emulator-integration.spec.js` | Policy skip E2E |

---

## Deploy

```powershell
firebase deploy --only firestore:rules
firebase deploy --only functions:scheduledKeyRotationReminders,functions:exportSecurityLog
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

*End of Phase 7 Report*
