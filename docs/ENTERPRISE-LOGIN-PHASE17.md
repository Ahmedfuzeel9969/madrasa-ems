# Enterprise Login — Phase 17: Parent Trusted Device + Google SSO + Security Overview

**Date:** 2026-06-19  
**Builds on:** Phase 1–16

---

## Summary

Phase 17 adds **parent trusted device approval**, **Google Sign-In provider enforcement**, and a **unified login security overview** dashboard for admins.

---

## Changes

### 1. Parent Trusted Device Gate

| Component | Detail |
|-----------|--------|
| Policy | `requireTrustedDeviceForParents` in `securityPolicy` |
| CF | `checkTrustedDevice` accepts `portal: 'parent'` |
| Gate | `proceedParentTrustedGate` — domain → device → MFA → key |
| Admin UI | Parent trusted device checkbox |

### 2. Google Sign-In Provider Enforcement

| Component | Detail |
|-----------|--------|
| Policy | `enforceGoogleSignInOnly` in `ssoPolicy` |
| CF | Provider check in `validateStaffEmailDomain` |
| Audit | `sso_provider_denied` SecurityLog event |
| Admin UI | "صرف Google Sign-In" checkbox |

### 3. Login Security Overview

| CF | Returns |
|----|---------|
| `getLoginSecurityOverview` | sessions, device stats, 7d SSO/MFA/device events, active policies |

Admin UI: overview bar at top of security section.

---

## Parent Login Chain (full)

```
Google Auth → domain → trusted device → MFA → access key → portal
```

---

## Deploy

```powershell
firebase deploy --only functions:checkTrustedDevice,functions:validateStaffEmailDomain,functions:getLoginSecurityOverview
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

*End of Phase 17 Report*
