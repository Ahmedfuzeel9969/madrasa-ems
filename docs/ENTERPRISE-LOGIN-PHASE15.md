# Enterprise Login — Phase 15: Staff MFA Gate + Device Stats + Events Export

**Date:** 2026-06-19  
**Builds on:** Phase 1–14

---

## Summary

Phase 15 extends **MFA enforcement to staff/teacher login**, adds **trusted device statistics**, and enables **filtered security events export** (JSON/CSV).

---

## Changes

### 1. Staff / Teacher MFA Login Gate

| Component | Detail |
|-----------|--------|
| Policy | `SecuritySettings/mfa.requireMfaForStaff` |
| CF | `checkMfaCompliance` accepts `portal` (`admin` / `staff`) |
| Gate | `proceedTeacherMfaGate` after trusted device, before access key |
| Client | `emsCheckMfaComplianceForPortal(tenantId, portal)` |
| Admin UI | MFA policy checkbox for staff |

Flow: domain → trusted device → **MFA** → access key

### 2. Trusted Device Stats

| CF | Returns |
|----|---------|
| `getTrustedDeviceStats` | pending, approved, rejected, revoked, expired, total |

Admin UI: stats summary above Trusted Devices table.

### 3. Security Events Export

| CF | Detail |
|----|--------|
| `exportSecurityEvents` | Filtered device/SSO events, JSON or CSV |

Admin UI: JSON + CSV download buttons on Security Events section.

---

## Deploy

```powershell
firebase deploy --only functions:checkMfaCompliance,functions:getTrustedDeviceStats,functions:exportSecurityEvents
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

*End of Phase 15 Report*
