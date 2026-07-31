# Enterprise Login — Phase 25: Session Anomaly Detection

**Date:** 2026-06-19  
**Builds on:** Phase 1–24

---

## Summary

Phase 25 adds **login session anomaly detection** when sessions register — flagging new devices, session surges, concurrent portal use, and country changes.

---

## Changes

### 1. Anomaly Policy

| Field | Purpose |
|-------|---------|
| `enableSessionAnomalyDetection` | Enable anomaly checks on session register |
| `notifyOwnerOnSessionAnomaly` | Queue owner email on anomaly |
| `sessionAnomalyMaxPerHour` | Max sessions/user/hour before surge alert (default 3) |

### 2. Anomaly Types

| Type | Trigger |
|------|---------|
| `new_device` | First login from unknown deviceId for user |
| `session_surge` | Too many sessions created in 1 hour |
| `concurrent_portals` | Active sessions on different portals within 15 min |
| `new_country` | Country header differs from previous session |

**Storage:** `All_Madrasas/{tenantId}/SessionAnomalies/{id}`  
**Audit:** `session_anomaly_detected`, `session_anomaly_dismissed`

### 3. Cloud Functions

| CF | Purpose |
|----|---------|
| `getSessionAnomalySummary` | Dashboard stats (7d open/total) |
| `listSessionAnomalies` | Admin table |
| `dismissSessionAnomaly` | Mark anomaly reviewed |

Hooked into `registerLoginSession` — stores `clientIp` + `countryCode` on session docs.

### 4. Admin UI

- Policy toggles in Security Policy panel
- **Session Anomalies** table with dismiss
- Overview shows anomaly count + detection status

### 5. Integrations

- Security webhooks: `session_anomaly_detected`
- Security events feed includes anomaly actions
- Health check includes session anomaly policy

---

## Deploy

```powershell
npm run preflight:login
firebase deploy --only functions:registerLoginSession,functions:getSessionAnomalySummary,functions:listSessionAnomalies,functions:dismissSessionAnomaly,functions:probeLoginSecurityBackend
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

**Cache bust:** `e25` on `admin-panel.js`, `tenant-security.js`, `ems-session-registry.js`

---

*End of Phase 25 Report*
