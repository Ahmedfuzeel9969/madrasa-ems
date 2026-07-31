# Enterprise Login — Phase 21: IP Allowlist Gate + Emulator Seed Update

**Date:** 2026-06-19  
**Builds on:** Phase 1–20

---

## Summary

Phase 21 adds **login IP allowlist enforcement** before domain/SSO gates, and **updates the emulator seed** with full enterprise login policy fields (Phases 12–21).

---

## Changes

### 1. Login IP Allowlist

| Field | Purpose |
|-------|---------|
| `enableIpAllowlist` | Enable IP restriction |
| `allowedIpRanges` | IPv4 single IPs or CIDR (e.g. `203.0.113.0/24`) |

| CF | Detail |
|----|--------|
| `validateLoginIpAddress` | Reads client IP from request, checks allowlist |
| `getLoginIpPolicySummary` | Admin dashboard — ranges, 7d denials, caller IP hint |

**Gate chain:** IP → domain → trusted device → MFA → access key  
**Bypass:** Owner + Super Admin  
**Audit:** `login_ip_denied` → SecurityLog + webhook + alert digest

### 2. Client Integration

- `emsValidateLoginIpForPortal` in `tenant-security.js` (fail-open on CF error)
- `runPortalSecurityGates` in `identity-gate.js`

### 3. Emulator Seed (Phase 21 update)

- Extended `scripts/seed-emulator-login.js` with phases 18–21 policy fields
- `ssoPolicy` doc seeded
- Unit tests: `tests/unit/emulator-seed.test.js`
- `require.main` guard — safe to import in tests

---

## Deploy

```powershell
firebase deploy --only functions:validateLoginIpAddress,functions:getLoginIpPolicySummary
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

**Emulator E2E (optional):**

```powershell
firebase emulators:start --only firestore,auth
npm run seed:emulator
set RUN_EMULATOR_E2E=1
npm run test:e2e:emulator
```

---

*End of Phase 21 Report*
