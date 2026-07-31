# Enterprise Login — Phase 23: Country Allowlist + Backend Probe

**Date:** 2026-06-19  
**Builds on:** Phase 1–22

---

## Summary

Phase 23 adds **geo/country login restrictions** (via request headers) and a **backend probe** to verify live Cloud Functions wiring before production.

---

## Changes

### 1. Country Allowlist Gate

| Field | Purpose |
|-------|---------|
| `enableCountryAllowlist` | Enable country restriction |
| `allowedCountries` | ISO codes (e.g. `PK, SA, AE`) |

**Headers read:** `CF-IPCountry`, `X-Country-Code`  
**CF:** `validateLoginCountry`  
**Audit:** `login_country_denied`

**Gate chain:** Country → IP → Domain → Device → MFA → Key

### 2. Backend Probe

| CF | `probeLoginSecurityBackend` |
|----|----------------------------|
| Returns | version, function list, policy gate flags |

Admin UI: **Probe Backend** button on health check panel.

### 3. Extended IP Summary

`getLoginIpPolicySummary` now includes country allowlist stats + caller country hint.

---

## Deploy

```powershell
npm run preflight:login
firebase deploy --only functions:validateLoginCountry,functions:probeLoginSecurityBackend
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

**Note:** Country detection requires Cloudflare (`CF-IPCountry`) or a proxy that sets `X-Country-Code`. Without header, gate **fail-open** (skipped).

---

*End of Phase 23 Report*
