# Enterprise Login — Phase 9: VAPID Admin UI, Retry Dashboard, Signed Audit URLs

**Date:** 2026-06-19  
**Builds on:** Phase 1–8

---

## Summary

Phase 9 removes manual push setup and adds operational tooling: **VAPID key in admin UI**, **failed notification retry dashboard**, and **signed URL download** for Cloud Storage audit exports.

---

## Changes

### 1. VAPID Key (Admin UI)

| Component | Detail |
|-----------|--------|
| Storage | `TenantSettings/notificationDelivery` → `fcmVapidKey` |
| Client | `tenant-delivery.js` — load/save |
| Admin UI | **بیک اپ و سنک** → Push / FCM section |
| Push register | `ems-push-register.js` uses `getTenantPushConfig` CF or Firestore |

No more `window.EMS_FCM_VAPID_KEY` manual setup required.

### 2. Failed Notification Retry

| Function | Detail |
|----------|--------|
| `getFailedNotifications` | Lists failed key expiry + parent push items |
| `retryFailedNotification` | Owner retry single item |
| Scheduled | `scheduledDeliverKeyExpiryNotifications` also retries failed (max 5 attempts) |
| Admin UI | Failed Notifications table with Retry buttons |

### 3. Signed Audit Export Download

| Function | Detail |
|----------|--------|
| `getAuditExportDownloadUrl` | 15-minute signed URL for last `ems-audit/{tenantId}/...` file |
| Admin UI | **Signed Download URL** button |

---

## Deploy

```powershell
firebase deploy --only firestore:rules
firebase deploy --only functions:getTenantPushConfig,functions:getFailedNotifications,functions:retryFailedNotification,functions:getAuditExportDownloadUrl
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

## Phase 10 (completed)

See `docs/ENTERPRISE-LOGIN-PHASE10.md` — audit history, bulk retry, retention, FCM background SW.

---

*End of Phase 9 Report*
