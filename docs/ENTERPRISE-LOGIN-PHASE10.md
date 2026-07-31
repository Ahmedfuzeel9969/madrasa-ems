# Enterprise Login — Phase 10: Audit History, Bulk Retry, Retention, FCM Background

**Date:** 2026-06-19  
**Builds on:** Phase 1–9

---

## Summary

Phase 10 completes the compliance operations loop: **audit export history with per-file download**, **bulk failed notification retry**, **delivery stats dashboard**, **scheduled compliance retention**, and **FCM background service worker**.

---

## Changes

### 1. Audit Export History

| Component | Detail |
|-----------|--------|
| Storage | `SecurityAuditExports/{exportId}` on each Cloud Storage export |
| `listAuditExportHistory` | Owner lists recent exports |
| Admin UI | Export History table + per-row download (signed URL) |

### 2. Bulk Retry + Delivery Stats

| Function | Detail |
|----------|--------|
| `retryAllFailedNotifications` | Retry all failed items (max 50) |
| `getNotificationDeliveryStats` | Sent / queued / failed / in-app counts |
| Admin UI | Stats bar + **Retry All Failed** button |

### 3. Compliance Retention

| Function | Detail |
|----------|--------|
| `scheduledComplianceRetention` | Daily purge of old SecurityLog + audit exports |
| Policy | `enableComplianceRetention`, `auditRetentionDays` (default 365) |

### 4. FCM Background Push

| File | Detail |
|------|--------|
| `firebase-messaging-sw.js` | Background notifications + click → open app |
| `ems-push-register.js` | Registers messaging SW before getToken |

---

## Deploy

```powershell
firebase deploy --only firestore:rules
firebase deploy --only functions:listAuditExportHistory,functions:retryAllFailedNotifications,functions:getNotificationDeliveryStats,functions:scheduledComplianceRetention
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

## Phase 11 (completed)

See `docs/ENTERPRISE-LOGIN-PHASE11.md` — login sessions registry + notification analytics.

---

*End of Phase 10 Report*
