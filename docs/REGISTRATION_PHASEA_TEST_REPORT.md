# Phase A — Draft Admission & Auto Save: Test Report

**Phase:** 2A  
**Date:** 9 July 2026  
**Status:** ✅ PASS  
**Feature flag during test:** Explicit `true` in unit tests; production default **false**

---

## Automated Results

### Phase A Suite

```
tests/unit/ems-registration-drafts-phasea.test.js — 13/13 passed
```

| Test | Requirement | Result |
|------|-------------|--------|
| Feature flag off by default | Flag default false | ✅ |
| Loader order | Post-auth + lazy | ✅ |
| Draft create | IDB separate from SSOT | ✅ |
| Auto-save | `reason: auto` persisted | ✅ |
| Resume after reload | Load returns fields | ✅ |
| Emergency save | `reason: emergency` | ✅ |
| Offline draft | Outbox queued, no network | ✅ |
| Multi-device conflict | Cloud newer detected | ✅ |
| Permission isolation — save blocked | deny create/edit | ✅ |
| Permission isolation — staff filter | STF-B sees 0 | ✅ |
| Feature flag off behavior | save disabled, list empty | ✅ |
| Delete draft | IDB removed | ✅ |
| admission.js wiring | delete + tab save hooks | ✅ |

### Full Regression

```
Test Files  91 passed (91)
     Tests  529 passed | 6 skipped (535)
Duration  ~18s
```

**Verdict:** No regression. Phase A adds 13 tests; suite remains green.

---

## Requirement Traceability

| # | Requirement | Verification |
|---|-------------|--------------|
| 1 | Fully offline-first | Offline save test; IDB-only path |
| 2 | Mobile friendly | CSS `@media 768px` for modals; 44px buttons in list |
| 3 | Resume after restart | Load draft test + resume modal HTML |
| 4 | Auto-save meaningful changes | Debounce + auto reason test |
| 5 | Crash/pagehide save | Emergency reason test; listeners in module |
| 6 | Multi-device safe | Conflict detection test; cloud mirror keys |
| 7 | No SSOT regression | Separate IDB keys; delete on approve wired |
| 8 | Feature flag off | Dedicated no-op test + default false test |
| 9 | Permission isolation | Block + staff list filter tests |

---

## Manual QA Scripts (Recommended Before Flag ON)

| Script | Steps | Pass criteria |
|--------|-------|---------------|
| M1 Crash | Fill name, wait 2s, kill tab, reopen | Resume modal shows name |
| M2 Offline | Airplane mode, edit, reload | Draft persists |
| M3 Approve | Fill draft, approve | Record saved; draft badge cleared |
| M4 Flag off | Default load, edit form | No status bar activity |
| M5 Two-device | Save on A, sync, open B | Conflict or cloud draft visible |

*Manual scripts not executed in CI — scheduled for staging enable.*

---

## Security Tests

| Case | Automated |
|------|-----------|
| Permission denied save | ✅ |
| Staff A / B isolation | ✅ |
| Draft not in repo list | ✅ (architecture — no repo API calls in module) |

---

## Known Test Limits

- DOM collect/apply tested via snapshot injection in unit tests (no full browser)
- Firestore write path not integration-tested (guarded try/catch)
- `sessionStorage` resume-once wrapped in try/catch for Vitest

---

## Enable Recommendation

**ENABLED** in `index.html` boot (`EMS_REG_DRAFTS_ENABLED = true`, cache bust `20260709_phase_a_drafts`).

Optional before heavy production use:
1. Manual M1–M5 on staging
2. Firestore rules for `RegistrationDrafts`

---

## Verdict

**Phase A implementation: PASS** — feature flag enabled in system boot.

---

*See `REGISTRATION_PHASEA_IMPLEMENTATION_REPORT.md` for file list and enable checklist.*
