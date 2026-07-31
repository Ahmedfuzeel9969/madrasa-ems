# Enterprise Login — Phase 12: Trusted Devices + SSO Email Domain

**Date:** 2026-06-19  
**Builds on:** Phase 1–11

---

## Summary

Phase 12 adds **trusted device approval** for staff login and **SSO/email domain policy hooks** so tenants can restrict which email domains may access teacher and parent portals.

---

## Changes

### 1. Trusted Devices

| Component | Detail |
|-----------|--------|
| Storage | `All_Madrasas/{tenantId}/TrustedDevices/{deviceId}` |
| Status | `pending` → `approved` / `rejected` |
| Client | `ems-trusted-device.js` — `emsCheckTrustedDevice`, `emsRequestTrustedDevice` |
| CFs | `checkTrustedDevice`, `requestTrustedDevice`, `approveTrustedDevice`, `rejectTrustedDevice`, `listTrustedDevices` |
| Policy | `requireTrustedDeviceForStaff` in `TenantSettings/securityPolicy` |
| Gate | `identity-gate.js` — domain check then trusted device before access key |
| Admin UI | Pending devices table with approve/reject |
| Owner | Bypasses trusted device check |

When policy is enabled, a teacher on a new browser must request approval; admin approves from the Trusted Devices table.

### 2. SSO / Email Domain Policy

| Component | Detail |
|-----------|--------|
| Storage | `TenantSettings/ssoPolicy` |
| Client | `tenant-sso.js` — load/save policy, `emsValidateEmailDomainForPortal` |
| CFs | `getTenantSsoPolicy`, `validateStaffEmailDomain` |
| Fields | `enforceStaffEmailDomain`, `enforceParentEmailDomain`, `allowedEmailDomains[]` |
| Admin UI | SSO policy section with domain list |

Server validates email domain before staff proceeds past identity gate.

---

## Deploy

```powershell
firebase deploy --only firestore:rules
firebase deploy --only functions:checkTrustedDevice,functions:requestTrustedDevice,functions:approveTrustedDevice,functions:rejectTrustedDevice,functions:listTrustedDevices,functions:getTenantSsoPolicy,functions:validateStaffEmailDomain
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

*End of Phase 12 Report*
