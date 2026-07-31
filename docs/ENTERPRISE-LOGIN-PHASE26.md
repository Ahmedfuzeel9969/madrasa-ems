# Enterprise Login — Phase 26: Login Audit Export

**Date:** 2026-06-19  
**Builds on:** Phase 1–25

---

## Summary

Phase 26 adds **combined login audit export** for compliance — security log, sessions, session anomalies, and brute-force lockouts in one bundle.

---

## Cloud Functions

| CF | Purpose |
|----|---------|
| `getLoginAuditSummary` | 30-day counts dashboard |
| `exportLoginAudit` | JSON bundle or CSV export |

**Includes:** SecurityLog, LoginSessions, SessionAnomalies, LoginFailures (lockouts)

---

## Admin UI

- **Login Audit Export** panel in backup/security tab
- Summary counts + JSON / CSV download buttons

---

## Deploy

```powershell
npm run preflight:login
firebase deploy --only functions:getLoginAuditSummary,functions:exportLoginAudit,functions:bulkImportRegistrations
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

**Cache:** `e26` on `admin-panel.js`

---

*End of Phase 26 Report*
