# Enterprise Login — Phase 13: Parent SSO Gate + Device Revoke/Expiry + Audit

**Date:** 2026-06-19  
**Builds on:** Phase 1–12

---

## Summary

Phase 13 completes the SSO enforcement loop for **parent and admin portals**, adds **trusted device revoke and expiry**, and writes **server-side SecurityLog audit events** for device and SSO actions.

---

## Changes

### 1. Parent & Admin SSO Domain Gates

| Portal | Gate | Policy field |
|--------|------|--------------|
| Parent | `proceedParentDomainGate` before access key | `enforceParentEmailDomain` |
| Admin (owner) | `proceedAdminWithDomainGate` before dashboard | `enforceStaffEmailDomain` |
| Teacher | unchanged (Phase 12) | `enforceStaffEmailDomain` |

Shared helper: `runPortalDomainGate` in `identity-gate.js`.

### 2. Trusted Device Revoke + Expiry

| Component | Detail |
|-----------|--------|
| CF | `revokeTrustedDevice` — owner revokes approved device |
| Policy | `trustedDeviceExpiryDays` (0 = never expire) |
| Scheduled | `scheduledTrustedDeviceExpiry` — daily mark expired devices |
| Gate | `expired` / `revoked` statuses block staff login |
| Admin UI | Revoke button + expiry days input |

### 3. Server-Side Security Audit

| Event | Trigger |
|-------|---------|
| `trusted_device_requested` | Staff requests new device |
| `trusted_device_approved` | Owner approves |
| `trusted_device_rejected` | Owner rejects |
| `trusted_device_revoked` | Owner revokes |
| `trusted_device_expired` | Scheduled expiry |
| `sso_domain_denied` | Email domain validation fails |

Helper: `functions/lib/security-log-write.js`  
Events appear in existing SecurityLog export (Phase 7).

---

## Deploy

```powershell
firebase deploy --only firestore:indexes
firebase deploy --only functions:revokeTrustedDevice,functions:scheduledTrustedDeviceExpiry
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

(Re-deploy Phase 12 SSO/trusted device functions if not yet live.)

---

*End of Phase 13 Report*
