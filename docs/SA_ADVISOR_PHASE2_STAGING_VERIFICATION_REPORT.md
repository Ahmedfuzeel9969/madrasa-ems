# Super Admin AI Advisor Phase 2 — Staging Verification Report

**Date:** 2026-07-09  
**Environment:** Code complete — **staging deploy not executed in this session**  
**Production:** **NOT enabled** (`enabled: false` by design)

---

## Verification Status

| Area | Code ready | Deployed | Verified live |
|------|------------|----------|---------------|
| CMI sync script | ✅ | ⏳ | ⏳ |
| Firestore rules | ✅ | ⏳ | ⏳ |
| Cloud Functions | ✅ | ⏳ | ⏳ |
| Secret Manager key | ⏳ Operator | ⏳ | ⏳ |
| SA UI panel | ✅ | ⏳ (hosting) | ⏳ |
| End-to-end ask flow | ✅ | ⏳ | ⏳ |

**Legend:** ✅ Complete | ⏳ Pending operator action

---

## Pre-Flight Checklist

### 1. CMI Cloud Index
- [ ] Run `npm run cmi:build`
- [ ] Run `npm run cmi:sync-firestore`
- [ ] Confirm `Platform_CmiMeta/current` exists with `cmiVersion`, `gitSha`
- [ ] Confirm `Platform_Config/sa_advisor`:
  - `enabled: false`
  - `stagingEnabled: true`
  - `productionEnabled: false`
  - `monthlyCostCapUsd: 50`

### 2. GCP Secret
- [ ] Create secret `platform-gemini-advisor-key`
- [ ] Grant Cloud Functions SA `roles/secretmanager.secretAccessor`
- [ ] Do **not** store key in Firestore or client

### 3. Deploy (Staging Scope Only)
```bash
firebase deploy --only firestore:rules
firebase deploy --only functions:saAdvisorAsk,functions:saAdvisorGetStatus
npm run deploy:hosting   # UI panel — staging approval only
```
- [ ] **Do not** set `enabled: true`
- [ ] **Do not** run full `deploy:functions` to prod without approval

### 4. UI Verification
- [ ] Login as Super Admin
- [ ] Navigate: Reports → **Platform Advisor**
- [ ] Status bar shows **Staging**, CMI version, budget
- [ ] Ask: "registration module security weaknesses"
- [ ] Answer renders with verified citations list
- [ ] Repeat same question → cache hit badge, limits unchanged

### 5. Security Spot Checks
- [ ] Non-SA account cannot call functions
- [ ] Firestore client cannot write `Platform_AdvisorCache`
- [ ] Audit documents appear in `Platform_AiAuditLog`
- [ ] Invalid citation tags not shown in answer text

### 6. Cost Spot Checks
- [ ] `Platform_AdvisorBudget` increments on fresh query only
- [ ] Cache hit: `costEstUsd: 0` in audit entry
- [ ] Simulate cap: set `costUsdEst: 50` in budget doc → fresh ask blocked

---

## Staging Sign-Off Criteria

Production approval requires **all** of:

1. Manual checklist above complete
2. Unit tests pass (`sa-advisor-phase2` + `cmi-foundation`)
3. No P1 security findings in staging pen test
4. Monthly cost projection ≤ $50 under expected SA usage
5. Explicit written approval to set `enabled: true` (separate from this phase)

---

## Current Session Outcome

| Deliverable | Status |
|-------------|--------|
| Implementation | ✅ Complete in workspace |
| Unit tests | ✅ 14/14 pass |
| Production deploy | ❌ Not performed (per approval conditions) |
| Live staging E2E | ⏳ Awaiting operator deploy |

---

## Recommended Next Action

Operator runs pre-flight checklist on staging project `madrasa-mangment-app`, completes manual tests, then requests **separate production approval** if results are satisfactory.
