# Enterprise Login — Phase 20: Security Alert Digest + Threshold Notifications

**Date:** 2026-06-19  
**Builds on:** Phase 1–19

---

## Summary

Phase 20 adds **daily security alert digests** with configurable **threshold-based notifications** for critical login events (SSO blocks, MFA blocks, device rate limits).

---

## Changes

### 1. Security Alert Digest Policy

| Field | Purpose |
|-------|---------|
| `enableSecurityAlertDigest` | Enable daily scheduled digest |
| `securityAlertThreshold7d` | Min critical events to trigger (0 = always) |
| `notifyOwnerOnSecurityAlert` | Queue owner email via existing delivery pipeline |

### 2. Cloud Functions

| CF | Detail |
|----|--------|
| `getSecurityAlertSummary` | Owner dashboard — 7d counts, threshold, last digest |
| `scheduledSecurityAlertDigest` | Daily scan all tenants with digest enabled |

**Critical events:** `sso_domain_denied`, `sso_provider_denied`, `mfa_session_required`, `trusted_device_rate_limited`

### 3. Storage

| Collection | Purpose |
|------------|---------|
| `SecurityAlertDigest/{dateKey}` | One digest per tenant per day |
| `Announcements` | In-app admin alert |
| `KeyExpiryNotifications` | Email queue (`type: security_alert`) |

### 4. Admin UI

Security Policy checkboxes + **Security Alert Digest** summary bar in backup tab.

---

## Deploy

```powershell
firebase deploy --only firestore:indexes
firebase deploy --only functions:getSecurityAlertSummary,functions:scheduledSecurityAlertDigest
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

*End of Phase 20 Report*
