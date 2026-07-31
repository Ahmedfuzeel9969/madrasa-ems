# Registration Phase 1 Action Plan

**Date:** 9 July 2026  
**Target Score:** ~75/100 overall (from 59)  
**Duration:** 12 weeks (3 months)  
**Scope:** Registration department only — no other modules

---

## Phase 1 Goal

Fix existing weaknesses without breaking offline-first architecture. Raise scores:

| Dimension | Current | Phase 1 Target |
|-----------|---------|----------------|
| Architecture | 78 | 85 |
| Performance | 72 | 80 |
| Security | 58 | 72 |
| Scalability | 65 | 72 |
| User Experience | 62 | 75 |
| Mobile Readiness | 38 | 65 |
| Global Readiness | 42 | 52 |
| **Overall** | **59** | **~75** |

---

## Sprint Schedule

### Sprint 1 (Weeks 1–2): Legacy Path Removal — Priority 1

**Report:** `REGISTRATION_LEGACY_PATH_REPORT.md`

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 1.1 | Create `emsRegGetRecordById(id, opts)` helper | `ems-registration-repository.js` | 1 day | Low |
| 1.2 | Wire `openIDCardModal` to repo | `admission.js`, `ems-idcard.js` | 1 day | Low |
| 1.3 | Wire `openLetterModal` to repo | `admission.js` | 0.5 day | Low |
| 1.4 | Wire `editRegistration` to `emsRegRepoGetById` | `admission.js` | 0.5 day | Low |
| 1.5 | Wire `renderRejectedTable` to repo only | `admission.js` | 0.5 day | Low |
| 1.6 | Remove `generateAutoID` localStorage fallback | `admission.js` | 0.5 day | Low |
| 1.7 | Add `EMS_REG_LEGACY_READ_FALLBACK` flag (default false) | `ems-registration-repository.js` | 0.5 day | Low |
| 1.8 | Unit + E2E tests | `tests/` | 1 day | — |

**Gate:** Zero `emsCacheGet(DB_USERS)` in admission.js. All Vitest pass.

---

### Sprint 2 (Weeks 3–4): Search Improvement — Priority 2

**Report:** `REGISTRATION_SEARCH_IMPROVEMENT_REPORT.md`

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 2.1 | Fix `regListSearch` cloud-first routing | `admission.js` | 1 day | Low |
| 2.2 | Create `emsRegSearchRouter` | `cloud/ems-enterprise-search.js` | 1 day | Low |
| 2.3 | Fast path for exact ID queries (STD-/TCH-/STF-) | `admission.js` | 0.5 day | Low |
| 2.4 | Search source badge in UI | `admission.js`, `index.html` | 0.5 day | Low |
| 2.5 | Session query cache (10 queries, 60s TTL) | `cloud/ems-enterprise-search.js` | 1 day | Low |
| 2.6 | Re-benchmark 100k search | `bench/` | 0.5 day | — |
| 2.7 | Unit tests: online→cloud, offline→local | `tests/unit/` | 1 day | — |

**Gate:** 100k cloud search <500ms. Offline search unchanged. Bench regression pass.

---

### Sprint 3 (Weeks 5–6): Duplicate Detection — Priority 3

**Report:** `REGISTRATION_DUPLICATE_DETECTION_PLAN.md`

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 3.1 | Create `emsRegCheckDuplicates(candidate, opts)` | `ems-registration-duplicates.js` (new) | 2 days | Medium |
| 3.2 | Integrate in `processRegistration` (hard block) | `admission.js` | 1 day | Medium |
| 3.3 | Duplicate warning modal UI | `admission.js`, `index.html` | 1 day | Low |
| 3.4 | CNIC/phone blur inline check | `admission.js` | 1 day | Low |
| 3.5 | Extend import `smartValidate` with repo cross-check | `ems-import-export.js` | 1 day | Medium |
| 3.6 | Unit tests for all rules D1–D7 | `tests/unit/` | 1 day | — |

**Gate:** Cannot save duplicate CNIC without owner override. Import flags existing CNIC.

---

### Sprint 4 (Weeks 7–8): Audit Trail — Priority 4

**Report:** `REGISTRATION_AUDIT_TRAIL_DESIGN.md`

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 4.1 | Extend `emsLogAudit` with device + changes fields | `ems-audit.js` | 1 day | Low |
| 4.2 | Create `emsRegDiffRecord(before, after)` | `ems-registration-repository.js` | 1 day | Low |
| 4.3 | Log create/edit/delete/restore in admission | `admission.js` | 1 day | Low |
| 4.4 | Offline audit outbox in IDB | `ems-audit.js` | 2 days | Medium |
| 4.5 | Audit sync queue | `ems-offline-write.js` | 1 day | Medium |
| 4.6 | Per-record audit viewer modal | `admission.js`, `index.html` | 1 day | Low |
| 4.7 | Firestore rules: EmsAudit append-only | `firestore.rules` | 0.5 day | Low |

**Gate:** Every save/edit/delete creates audit entry. Offline audits sync on reconnect.

---

### Sprint 5 (Weeks 9–10): Permissions — Priority 5

**Report:** `REGISTRATION_PERMISSION_MATRIX.md`

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 5.1 | Create `ems-registration-permissions.js` | New file | 1 day | Low |
| 5.2 | Add `data-reg-perm` to registration UI elements | `index.html` | 1 day | Low |
| 5.3 | `emsRegGuardUI()` on module init | `admission.js` | 1 day | Low |
| 5.4 | Guard save/delete/import with permission checks | `admission.js` | 1 day | Medium |
| 5.5 | Add `print` + `import` to ADMIN_ACTIONS | `admin-panel.js` | 0.5 day | Low |
| 5.6 | Update role presets (reception, teacher) | `admin-panel.js` | 0.5 day | Low |
| 5.7 | E2E: reception cannot delete | `tests/e2e/` | 1 day | — |

**Gate:** UI buttons hidden per staff permissions. Owner always has full access.

---

### Sprint 6 (Weeks 11–12): Mobile Usability — Priority 6

**Report:** `REGISTRATION_MOBILE_IMPROVEMENT_REPORT.md`

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 6.1 | Single-column form CSS (<768px) | `style.css` | 0.5 day | Low |
| 6.2 | 44px touch targets + 16px input font | `style.css` | 0.5 day | Low |
| 6.3 | Sticky save bar | `style.css`, `index.html` | 1 day | Low |
| 6.4 | Camera capture on photo input | `index.html` | 0.5 day | Low |
| 6.5 | Bottom navigation bar | `index.html`, `registration-ui.js` | 2 days | Medium |
| 6.6 | Mobile card list view | `admission.js`, `style.css` | 2 days | Medium |
| 6.7 | Tab count badges | `admission.js` | 0.5 day | Low |
| 6.8 | APK rebuild + manual mobile test | `android/` | 1 day | — |

**Gate:** Registration usable on 360px Android without horizontal scroll on forms.

---

## Cross-Cutting Requirements (All Sprints)

| Requirement | Verification |
|-------------|-------------|
| Offline-first preserved | All features work with `EMS_OFFLINE_ONLY=true` |
| Backward compatible | Legacy flag for one release cycle where needed |
| No other modules touched | Only registration files in diff |
| Tests pass | Vitest 467+ pass after each sprint |
| No breaking API changes | `emsGetUsersMerged` signature unchanged |
| Build succeeds | `npm run build` + `android:build:debug` |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Legacy removal breaks ID cards | Medium | High | Feature flag + E2E test |
| Cloud search adds latency when CF slow | Low | Medium | Timeout → local fallback (already exists) |
| Permission guards block owner | Low | Critical | Owner bypass in `emsRegCan` |
| Mobile CSS breaks desktop | Low | Medium | Desktop-first CSS unchanged; mobile in media query |
| Audit outbox fills storage | Low | Medium | 10k cap + rotation |

---

## Definition of Done (Phase 1)

- [ ] All 6 priority reports implemented
- [ ] Overall registration score ≥ 75/100
- [ ] Zero legacy `ems_full_users` reads in registration UI
- [ ] 100k search <500ms when online
- [ ] Duplicate CNIC blocked on manual entry
- [ ] Full audit trail for create/edit/delete
- [ ] Staff permissions enforced in UI
- [ ] Mobile forms usable on 360px screen
- [ ] 467+ Vitest pass, P6 E2E pass
- [ ] APK rebuilt and smoke-tested

---

## Team & Effort Summary

| Sprint | Duration | Dev Days | QA Days |
|--------|----------|----------|---------|
| S1 Legacy | 2 weeks | 5 | 2 |
| S2 Search | 2 weeks | 5 | 2 |
| S3 Duplicates | 2 weeks | 7 | 2 |
| S4 Audit | 2 weeks | 7 | 2 |
| S5 Permissions | 2 weeks | 5 | 2 |
| S6 Mobile | 2 weeks | 7 | 3 |
| **Total** | **12 weeks** | **36** | **13** |

---

*Phase 1 complete → proceed to Phase 2 global features.*
