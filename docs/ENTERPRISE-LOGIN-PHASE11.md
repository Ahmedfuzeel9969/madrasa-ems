# Enterprise Login — Phase 11: Login Sessions + Notification Analytics

**Date:** 2026-06-19  
**Builds on:** Phase 1–10

---

## Summary

Phase 11 adds **login session registry with device tracking and revoke**, plus **7-day notification analytics rollup** for operational visibility.

---

## Changes

### 1. Login Session Registry

| Component | Detail |
|-----------|--------|
| Storage | `LoginSessions/{sessionId}` |
| Client | `ems-session-registry.js` — deviceId, register, touch every 5 min |
| CFs | `registerLoginSession`, `listLoginSessions`, `revokeLoginSession`, `touchLoginSession` |
| Policy | `enableLoginSessionRegistry`, `maxActiveSessionsPerUser` (default 5) |
| Admin UI | Active sessions table + revoke |

Revoked sessions force logout on next touch.

### 2. Notification Analytics

| Function | Detail |
|----------|--------|
| `scheduledNotificationAnalytics` | Daily rollup → `NotificationAnalyticsDaily/{dateKey}` |
| `getNotificationAnalytics` | Owner fetches last 7–30 days |
| Admin UI | 7-day sent/failed/queued table |

---

## Deploy

```powershell
firebase deploy --only firestore:rules
firebase deploy --only functions:registerLoginSession,functions:listLoginSessions,functions:revokeLoginSession,functions:touchLoginSession,functions:getNotificationAnalytics,functions:scheduledNotificationAnalytics
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

*End of Phase 11 Report*
