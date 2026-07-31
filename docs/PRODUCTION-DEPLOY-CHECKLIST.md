# Production Deploy Checklist — EMS Madrasa

**Last updated:** 2026-06-19  
**Project:** `madrasa-mangment-app`  
**Live URL:** https://madrasa-mangment-app.web.app

---

## Pre-deploy (automated)

```powershell
npm run preflight:login
node scripts/prepare-hosting.js
npm test
```

Expected: **96 tests pass**, preflight **PASSED**, dist build **OK**.

---

## Deploy sequence

```powershell
# 1. Firestore rules & indexes
firebase deploy --only firestore:rules,firestore:indexes

# 2. Login security + import functions (Phase 12–26)
firebase deploy --only functions:checkTrustedDevice,functions:validateStaffEmailDomain,functions:getLoginSecurityOverview,functions:testSecurityWebhook,functions:getSecurityAlertSummary,functions:validateLoginIpAddress,functions:validateOidcIssuerConfig,functions:getLoginSecurityHealthCheck,functions:validateLoginCountry,functions:probeLoginSecurityBackend,functions:checkTenantLoginAllowed,functions:recordTenantLoginFailure,functions:clearTenantLoginSuccess,functions:getTenantLoginLockouts,functions:unlockTenantLoginLockout,functions:registerLoginSession,functions:getSessionAnomalySummary,functions:listSessionAnomalies,functions:dismissSessionAnomaly,functions:getLoginAuditSummary,functions:exportLoginAudit,functions:bulkImportRegistrations

# 3. Hosting (SPA + admin UI)
firebase deploy --only hosting
```

---

## Firebase Console — manual setup (cannot be done from code)

| Item | Where | Status |
|------|-------|--------|
| **TOTP MFA** | Authentication → Sign-in method → Multi-factor | Owner enables in admin panel after CF deploy |
| **SMTP / Email** | TenantSettings or Functions env for key expiry emails | Configure `enableEmailDelivery` + SMTP in policy |
| **VAPID (Web Push)** | Cloud Messaging → Web Push certificates | Admin panel → FCM VAPID key field |
| **OIDC/SAML** | Authentication → Sign-in providers | Per-tenant SSO policy (Phase 19) |
| **IAM for Functions deploy** | GCP Console → Cloud Functions bucket | If deploy fails: grant `529775229216-compute@...` Storage Admin |

---

## Post-deploy verification

1. Open **Registration → Import/Export** — Legacy + Smart panels visible  
2. Admin **Backup tab** — Login Audit Export (Phase 26)  
3. Run **Probe Backend** — version `e26`  
4. Test **Legacy quick import** with small CSV  
5. Test **Smart wizard** with template apply (Step 3)

---

## Completed in code (no deploy yet)

| Area | Phases | Tests |
|------|--------|-------|
| Enterprise Login | 1–26 | 96/96 ✅ |
| Import/Export | Legacy + Smart + Phase 2 | ✅ |
| Preflight | Phase 12–26 | PASSED ✅ |
| `dist/` build | prepare-hosting | ✅ |

**Deploy to production:** run commands above when approved.

---

*End of checklist*
