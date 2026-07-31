# Enterprise Login — Phase 24: Tenant-Scoped Brute-Force Protection

**Date:** 2026-06-19  
**Builds on:** Phase 1–23

---

## Summary

Phase 24 adds **tenant-scoped login brute-force protection** with per-email failure counters, temporary lockouts, admin unlock, and integration into the identity gate chain.

---

## Changes

### 1. Brute-Force Policy

| Field | Purpose |
|-------|---------|
| `enableLoginBruteForceProtection` | Enable lockout after repeated failures |
| `maxLoginFailuresPerEmail` | Failures before lockout (default 5) |
| `loginLockoutMinutes` | Lockout duration (default 15 min) |

**Storage:** `All_Madrasas/{tenantId}/LoginFailures/{emailDocId}`

### 2. Cloud Functions

| CF | Purpose |
|----|---------|
| `checkTenantLoginAllowed` | Pre-login lockout check |
| `recordTenantLoginFailure` | Increment counter; trigger lockout |
| `clearTenantLoginSuccess` | Clear counter on successful login |
| `getTenantLoginLockouts` | Owner: list active lockouts |
| `unlockTenantLoginLockout` | Owner: manual unlock |

**Audit:** `login_lockout_triggered`, `login_lockout_cleared`

### 3. Identity Gate Integration

**Gate order (teacher/parent/admin):** Brute-force → Country → IP → Domain → Device → MFA → Key

Failures recorded on:
- Country / IP / domain denials
- Wrong access key submission

Success clears failure record on portal completion.

### 4. Admin UI

- Policy toggles in Security Policy panel
- **Login Lockouts** table with unlock button
- Overview + health check include brute-force status

### 5. Webhooks & Alerts

- Webhook actions: `login_lockout_triggered`, `login_lockout_cleared`
- Alert digest counts lockouts as critical events

---

## Deploy

```powershell
npm run preflight:login
firebase deploy --only functions:checkTenantLoginAllowed,functions:recordTenantLoginFailure,functions:clearTenantLoginSuccess,functions:getTenantLoginLockouts,functions:unlockTenantLoginLockout,functions:probeLoginSecurityBackend
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

**Cache bust:** `e24` on `identity-gate.js`, `tenant-security.js`, `admin-panel.js`

---

*End of Phase 24 Report*
