# Enterprise Login — Phase 19: OIDC/SAML SSO Policy Hooks

**Date:** 2026-06-19  
**Builds on:** Phase 1–18

---

## Summary

Phase 19 adds **OIDC and SAML SSO policy hooks** for enterprise IdP integration, extended **sign-in provider enforcement**, and an **admin SSO provider summary** dashboard.

---

## Changes

### 1. OIDC Provider Policy

| Field | Purpose |
|-------|---------|
| `oidcEnabled` | Enable OIDC provider gate |
| `oidcProviderId` | Firebase provider ID (e.g. `oidc.school`) |
| `oidcIssuerUrl` | OIDC issuer for discovery |
| `oidcClientId` | Public client ID (reference) |

**CF:** `validateOidcIssuerConfig` — fetches `.well-known/openid-configuration`, stores validation result.

### 2. SAML Provider Policy

| Field | Purpose |
|-------|---------|
| `samlEnabled` | Enable SAML provider gate |
| `samlProviderId` | Firebase SAML provider ID |
| `samlEntityId` | IdP entity ID |
| `samlSsoUrl` | SSO endpoint URL |

### 3. Extended Provider Enforcement

| Component | Detail |
|-----------|--------|
| `resolveAllowedProviders` | google + configured OIDC/SAML + extras |
| `validateStaffEmailDomain` | denies unauthorized sign-in providers |
| Audit | `sso_provider_denied` includes `allowedProviders` |

### 4. Admin UI + Summary

| CF | `getSsoProviderSummary` — allowed providers, OIDC/SAML status |
| Admin | OIDC/SAML config fields, Validate Issuer button, summary bar |
| Login | `ems-org-sso-hint` banner when org SSO configured |

---

## Deploy

```powershell
firebase deploy --only functions:validateOidcIssuerConfig,functions:getSsoProviderSummary,functions:validateStaffEmailDomain,functions:getTenantSsoPolicy
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

**Note:** Actual OIDC/SAML login buttons require provider setup in **Firebase Console → Authentication → Sign-in method**.

---

*End of Phase 19 Report*
