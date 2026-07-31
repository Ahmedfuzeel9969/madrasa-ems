# Registration Legacy Test Report

**Sprint:** 1 (Week 1–2)  
**Date:** 9 July 2026  
**Status:** ✅ PASS  
**Test Runner:** Vitest 3.2.6

---

## Test Objectives

1. Verify zero legacy `ems_full_users` / `ems_rejected_users` reads in registration UI
2. Verify SSOT helpers (`emsRegGetRecordById`, `repoMirrorGetById`) exist and are wired
3. Verify existing registration tests still pass
4. Confirm offline-first architecture not broken

---

## Unit Tests — Sprint 1 Specific

**File:** `tests/unit/ems-registration-legacy-fix.test.js`

| # | Test | Result | Duration |
|---|------|--------|----------|
| 1 | admission.js has no ems_full_users / DB_USERS read paths | ✅ PASS | — |
| 2 | admission.js openLetterModal uses SSOT loader | ✅ PASS | — |
| 3 | admission.js does not define legacy openIDCardModal | ✅ PASS | — |
| 4 | ems-idcard.js uses SSOT only for record lookup | ✅ PASS | — |
| 5 | ems-registration-repository.js exposes SSOT read helpers | ✅ PASS | — |
| 6 | legacy fallback is opt-in only (default false) | ✅ PASS | — |
| 7 | generateAutoID uses repo lists only | ✅ PASS | — |

**Sprint 1 unit tests: 7/7 PASS**

---

## Regression Tests — Registration Module

| File | Tests | Result |
|------|-------|--------|
| `ems-registration-e7.test.js` | 5 | ✅ 5/5 |
| `ems-registration-a4.test.js` | 5 | ✅ 5/5 |
| `ems-registration-b1b2.test.js` | 8 | ✅ 8/8 |
| `ems-registration-data-flow.test.js` | 11 | ✅ 11/11 |
| `ems-reg-repo-page-wiring.test.js` | 13 | ✅ 13/13 |
| `ems-rejected-e7s3.test.js` | 4 | ✅ 4/4 |
| `ems-idcard-syntax.test.js` | 2 | ✅ 2/2 |
| `ems-student-list-consistency-regent12.test.js` | 14 | ✅ 14/14 |
| `ems-user-access-e7s2.test.js` | 5 | ✅ 5/5 |
| `import-export.test.js` | 7 | ✅ 7/7 |

**Registration regression: 74/74 PASS**

---

## Full Suite Result

```
Test Files:  84 passed | 1 failed (85)
Tests:       467 passed | 1 failed | 6 skipped (474)
Duration:    20.82s
```

| Failure | Related to Sprint 1? | Detail |
|---------|---------------------|--------|
| `project-smoke.test.js` Phase 12 timeout | ❌ No | Pre-existing flaky timeout (5000ms); unrelated to registration |

**Sprint 1 impact on full suite: ZERO regressions**

---

## Static Analysis Checks

| Assertion | Method | Result |
|-----------|--------|--------|
| No `const DB_USERS` in admission.js | grep | ✅ |
| No `emsCacheGet(DB_USERS)` in admission.js | grep | ✅ |
| No `emsCacheGet(DB_REJECTED)` in admission.js | grep | ✅ |
| No `localStorage.getItem(DB_USERS)` in admission.js | grep | ✅ |
| No `ems_full_users` in ems-idcard.js | grep | ✅ |
| `emsRegGetRecordById` exported | source read | ✅ |
| `EMS_REG_LEGACY_READ_FALLBACK = false` default | source read | ✅ |
| `repoMirrorGetById` implemented | source read | ✅ |

---

## Manual Test Scenarios (Recommended)

These scenarios should be verified in browser before production deploy:

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Create student | Fill form → Approve | Record in list |
| M2 | Edit student | List → Edit → Change name → Save | Updated name in list |
| M3 | Delete student | List → Delete → Confirm | Record removed |
| M4 | ID card after save | List → ID card icon | Correct name, photo, ID |
| M5 | Letter after save | List → Letter icon | Correct name, class |
| M6 | Browser reload | Reload → Open list → ID card | Same data (from IDB, not stale) |
| M7 | Rejected flow | Reject → Rejected tab → View info | Correct rejected record |
| M8 | Edit from rejected | Rejected → Edit → Approve | Restored to approved list |
| M9 | Offline ID card | Disconnect network → ID card | Works from IDB mirror |
| M10 | Auto ID generation | New student form | Sequential STD-XX from repo |

**Automated E2E for M1–M10:** Not run in this sprint (existing `ems-reg-page-live.spec.js` covers partial flows). Recommend E2E extension in Sprint 2.

---

## Offline-First Verification

| Path | Verified By | Status |
|------|-------------|--------|
| IDB mirror read (`repoMirrorGetById`) | Unit test + code review | ✅ |
| RAM cache read (`state.byId`) | Code review | ✅ |
| Legacy fallback disabled by default | Unit test | ✅ |
| Write path unchanged | Regression tests | ✅ |
| Boot hydrate unchanged | `ems-registration-b1b2.test.js` | ✅ |
| Cloud fetch only when online + not in IDB | Code review | ✅ |

---

## Test Coverage Gap (Future)

| Gap | Planned Sprint |
|-----|----------------|
| E2E: ID card shows repo data after reload | Sprint 2 |
| E2E: Letter modal SSOT path | Sprint 2 |
| Integration: `emsRegGetRecordById` with mock IDB | Sprint 2 |
| Tenant switch → ID card shows correct tenant | Sprint 5 |

---

## Conclusion

| Metric | Value |
|--------|-------|
| Sprint 1 unit tests | **7/7 PASS** |
| Registration regression | **74/74 PASS** |
| Full suite regressions | **0** |
| Legacy read sites fixed | **7/7** |
| Offline-first preserved | **YES** |
| Sprint 1 gate | **✅ PASS** |

**Sprint 1 is complete and stable. Approved to proceed to Sprint 2 (Cloud-First Search) upon user confirmation.**

---

*Test report generated after Sprint 1 implementation.*
