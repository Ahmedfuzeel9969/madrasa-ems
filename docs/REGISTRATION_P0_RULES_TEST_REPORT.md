# Registration P0 Rules & Permission Test Report

**Date:** 9 July 2026  
**Scope:** P0 Fix 1 (Firestore rules) + P0 Fix 2 (client alignment)  
**Runner:** Vitest (`npm test`)

---

## Summary

| Test file | Tests | Status |
|-----------|-------|--------|
| `tests/unit/firestore-registration-p0-rules.test.js` | 12 | PASS |
| `tests/unit/ems-registration-p0-ssot-alignment.test.js` | 10 | PASS |
| `tests/unit/ems-registration-drafts-phasea.test.js` | 14 | PASS |
| `tests/unit/ems-registration-permissions-s5.test.js` | 12 | PASS |
| `tests/unit/ems-registration-a4.test.js` | 5 | PASS |
| **Registration total** | **108** | **PASS** |

---

## Fix 1 — RegistrationDrafts Rules Tests

### Static rules validation

| Test | Expected | Result |
|------|----------|--------|
| `RegistrationDrafts/{tenantId}/items/{docId}` match exists | Present | PASS |
| Helper functions defined | 5 helpers | PASS |
| Parent denied (`!isParentOf`) | In all draft helpers | PASS |
| Signed-in required | No public access | PASS |
| Payload validation | staffId, tenantId, type, revision | PASS |
| SSOT owner-only unchanged | `canWriteRegistration` on Registrations | PASS |

### Simulated access matrix (allowed / denied)

| Scenario | Read | Create | Update | Delete | Result |
|----------|------|--------|--------|--------|--------|
| Staff own draft + admission permission | ✓ | ✓ | ✓ | ✓ | PASS |
| Staff other staff draft | ✗ | ✗ | ✗ | ✗ | PASS |
| Owner any draft in tenant | ✓ | ✓ | ✓ | ✓ | PASS |
| Parent | ✗ | ✗ | — | — | PASS |
| Cross-tenant | ✗ | — | ✗ | — | PASS |
| Anonymous | ✗ | ✗ | — | — | PASS |
| Staff without admission module | — | ✗ | ✗ | — | PASS |
| Wrong docId (`staffId_type` mismatch) | — | ✗ | — | — | PASS |

> Note: Matrix uses a JavaScript simulator mirroring `firestore.rules` logic. Project does not yet use `@firebase/rules-unit-testing`; emulator integration tests recommended in a future sprint.

---

## Fix 2 — Client SSOT Alignment Tests (Model C)

| Test | Expected | Result |
|------|----------|--------|
| `emsRegCanWriteSsot` / `emsRegRequireSsotSave` exported | Yes | PASS |
| `admission.js` uses `emsRegRequireSsotSave` | Yes | PASS |
| Owner/admin SSOT approve + reject | Allowed | PASS |
| Staff create/edit — no SSOT approve/reject | Denied | PASS |
| Staff draft write allowed | Yes | PASS |
| Teacher — no draft or SSOT write | Denied | PASS |
| Parent — no access | Denied | PASS |
| Offline staff draft save (IDB) | Saved locally | PASS |
| Cloud sync permission denied | Outbox queued + security event | PASS |
| Staff with `approve1` — SSOT still blocked | Denied | PASS |

---

## Security Events Verified

| Event | Trigger |
|-------|---------|
| `reg_ssot_write_denied` | Staff attempts approve/reject via `emsRegRequireSsotSave` |
| `reg_draft_cloud_sync_denied` | Firestore rejects draft mirror write |
| `reg_permission_denied` | Existing — unchanged |

---

## Full Suite Run

```
npm test
```

| Metric | Value |
|--------|-------|
| Total tests | 582 |
| Passed | 574 |
| Skipped | 6 |
| Failed | 2 |

### Failures (not P0 regression)

| File | Failure | P0 related? |
|------|---------|-------------|
| `ems-android-asset-sync.test.js` | Android asset preflight exit code 1 | No — pre-existing asset sync drift |

All registration and P0 tests pass.

---

## Commands

```bash
# P0 + registration only
npx vitest run tests/unit/firestore-registration-p0-rules.test.js tests/unit/ems-registration-p0-ssot-alignment.test.js tests/unit/ems-registration

# Full suite
npm test
```

---

## Sign-off

| Check | Status |
|-------|--------|
| P0 Fix 1 rules in `firestore.rules` | DONE |
| P0 Fix 2 client Model C | DONE |
| Allowed/denied tests | GREEN |
| Phase B started | **NO** |
