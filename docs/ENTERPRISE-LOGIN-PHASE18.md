# Enterprise Login — Phase 18: Security Webhooks + Device Rate Limiting

**Date:** 2026-06-19  
**Builds on:** Phase 1–17

---

## Summary

Phase 18 adds **outbound security webhooks** for critical login events and **rate limiting** on trusted device approval requests.

---

## Changes

### 1. Security Webhooks

| Component | Detail |
|-----------|--------|
| Policy | `enableSecurityWebhooks`, `securityWebhookUrl`, `securityWebhookSecret` |
| CF | `security-webhook.js` — HMAC-signed POST on critical events |
| Hook | `writeSecurityLog` auto-dispatches webhook (fire-and-forget) |
| CF | `testSecurityWebhook`, `getSecurityWebhookStatus` |
| Log | `SecurityWebhookLog` subcollection (delivery attempts) |
| Admin UI | Webhook config in Security Policy + status bar + Test button |

**Webhook events:** device request/approve/reject/revoke/rate-limit, SSO denied, MFA blocks.

### 2. Trusted Device Rate Limiting

| Component | Detail |
|-----------|--------|
| Policy | `trustedDeviceMaxRequestsPerDay` (default 5, 0 = unlimited) |
| CF | `requestTrustedDevice` — blocks excess daily requests |
| Audit | `trusted_device_rate_limited` SecurityLog + webhook |

### 3. Overview Extension

`getLoginSecurityOverview` now includes webhook enabled flag and device rate limit policy.

---

## Deploy

```powershell
firebase deploy --only firestore:indexes
firebase deploy --only functions:testSecurityWebhook,functions:getSecurityWebhookStatus,functions:requestTrustedDevice
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

*End of Phase 18 Report*
