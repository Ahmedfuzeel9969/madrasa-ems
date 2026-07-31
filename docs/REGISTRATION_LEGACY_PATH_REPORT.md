# Registration Legacy Path Report

**Date:** 9 July 2026  
**Phase:** 1 — Priority 1  
**Status:** Pre-implementation audit (no code changes yet)

---

## Executive Summary

Registration writes correctly flow through `emsRegRepoPersistRegistration` → IDB mirror SSOT. However, **14 read paths** in Registration UI still fall back to legacy `localStorage` / `emsCacheGet` keys (`ems_full_users`, `ems_rejected_users`). The highest-risk sites are **ID card modals**, **letter modals**, and **rejected-table rendering** — these can show stale or empty data under offline-first SSOT.

**Remediation scope:** 6 files, ~22 call sites, estimated 3–5 dev-days.

---

## Legacy Keys Still Referenced

| Key | Scoped? | Migration Status | Risk |
|-----|---------|------------------|------|
| `ems_full_users` (`DB_USERS`) | ❌ Global | Migrated to IDB; key purged on tenant switch | **High** |
| `ems_rejected_users` (`DB_REJECTED`) | ❌ Global | Partial — repo has `rejectedById` | **High** |
| `ems_reg_full_v2_{tenantId}` | ✅ Tenant | One-time migration in repo | Low (read-only fallback) |
| `ems_repo_{tenantId}` | ✅ Tenant | Legacy blob alias | Low |
| `registrations_cache` | ❌ Global | Deprecated | Medium |
| `ems_global_terms_{prefix}` | ⚠️ Per-prefix | UI preference, not registration data | Low (keep) |
| `DB_CLASSES` (class list) | ❌ Global | Not in repo | Medium (separate concern) |

---

## Complete Call-Site Inventory

### `admission.js` — 12 legacy read sites

| Line(s) | Function | Legacy Path | SSOT Replacement |
|---------|----------|-------------|------------------|
| L5–6 | Constants | `DB_USERS = 'ems_full_users'`, `DB_REJECTED = 'ems_rejected_users'` | Deprecate constants; use repo APIs only |
| L88–98 | `generateAutoID` | Fallback: `emsCacheGet(DB_USERS)` + `localStorage(DB_REJECTED)` | Always use `emsRegRepoFetchMaxIdNum` or `emsRegRepoForEach` |
| L92–94 | `generateAutoID` | `emsCacheGet(DB_USERS, [])` when repo unavailable | `emsRegRepoGetList` + `emsRegRepoGetRejectedList` (already primary; remove fallback) |
| L468–470 | `processRegistration` | `emsCacheGet(DB_CLASSES)` for class validation | Tenant-scoped class store or `emsRegRepoCollectClasses` |
| L611, L631, L650 | Class management | `localStorage.getItem(DB_CLASSES)` | Dedicated `ems_classes_{tenantId}` or repo meta collection |
| L1365–1367 | `renderRejectedTable` | Fallback: `emsCacheGet(DB_REJECTED)` | `emsRegRepoGetRejectedList()` only |
| L1491–1493 | `clearRejectedHistory` | `emsCacheGet(DB_REJECTED)` | `emsRegRepoClearRejected()` (new) or repo API |
| L1574–1577 | `editRegistration` | `emsCacheGet(dbKey)` for DB_USERS/DB_REJECTED | `emsRegRepoGetById(id, fromRejected)` |
| L1917–1919 | `openIDCardModal` | `emsCacheGet(DB_USERS, [])` | **`emsRegRepoGetById(userId)`** |
| L1980–1982 | `openLetterModal` | `emsCacheGet(DB_USERS, [])` | **`emsRegRepoGetById(userId)`** |

### `ems-idcard.js` — 2 legacy read sites

| Line(s) | Function | Legacy Path | SSOT Replacement |
|---------|----------|-------------|------------------|
| L31 | Template storage | `localStorage.getItem(KEY)` | Keep (template prefs, not registration data) |
| L195–196 | `openIDCardModal` user lookup | `emsCacheGet('ems_full_users', [])` | `emsRegRepoGetById(id)` with async fallback |

### `registration-ui.js` — 1 indirect risk

| Line(s) | Issue | Detail |
|---------|-------|--------|
| L122–123 | `emsLoadRegistrationListForUI` undefined | Falls back to `emsEnsureRegistrationSync()` — not legacy but broken reference |

### No legacy reads found in

- `ems-registration-repository.js` (write path correct)
- `ems-registration-bootstrap.js`
- `ems-import-export.js` (writes via repo/CF)
- `cloud/ems-registration-*.js`

### Archive viewer

- **No UI exists.** Archive data in `ems_cache_{tenantId}_archive` via `ems-registration-repository.js` L428–445 is internal only. When archive UI is built, it must read from `emsRegRepoGetArchivedList()` (new API), not legacy blobs.

---

## Data Flow — Current vs Target

```
CURRENT (broken path):
  User clicks ID Card
    → openIDCardModal(id)
    → emsCacheGet('ems_full_users')     ← STALE / EMPTY under SSOT
    → find user by id in array
    → render card (wrong/missing photo)

TARGET (Phase 1 fix):
  User clicks ID Card
    → openIDCardModal(id)
    → emsRegRepoGetById(id)             ← RAM → IDB mirror
    → emsGetUserPhotoSrc(user)          ← photo URL or lean base64
    → render card (correct data)
```

---

## Migration Strategy (Backward Compatible)

### Step 1 — Unified read helper (new, no breaking changes)

Create `emsRegGetRecordById(id, opts)` in `ems-registration-repository.js`:

```javascript
// Pseudocode — implementation in Phase 1 sprint
function emsRegGetRecordById(id, opts) {
  opts = opts || {};
  // 1. Try RAM (state.byId / rejectedById)
  // 2. Try async IDB get if not in RAM
  // 3. Legacy fallback ONLY if EMS_REG_LEGACY_READ_FALLBACK=true
  // 4. Return null if not found
}
```

Default: SSOT only. Legacy fallback behind explicit debug flag for one release cycle.

### Step 2 — Replace call sites (ordered by risk)

| Order | File | Function | Risk if skipped |
|-------|------|----------|-----------------|
| 1 | `admission.js` | `openIDCardModal` | Wrong photos/names on ID cards |
| 2 | `admission.js` | `openLetterModal` | Wrong data on official letters |
| 3 | `admission.js` | `editRegistration` | Edit form loads stale record |
| 4 | `admission.js` | `renderRejectedTable` | Empty rejected list |
| 5 | `ems-idcard.js` | `openIDCardModal` | Duplicate implementation diverges |
| 6 | `admission.js` | `generateAutoID` | ID collision if legacy has old data |
| 7 | `admission.js` | `clearRejectedHistory` | Operates on wrong dataset |

### Step 3 — Legacy key deprecation

1. Add `emsRegLegacyReadWarn(site)` console warning when fallback used
2. Log count of legacy reads per session in diagnostics
3. After 2 releases with zero legacy reads in production telemetry → remove fallbacks
4. Keep `migrateLegacyRegistrationBlob` for one-time migration (already exists)

### Step 4 — Verification tests

| Test | Assertion |
|------|-----------|
| Unit: `emsRegGetRecordById` | Returns from repo, not localStorage |
| Unit: ID card modal | Mocks repo; never calls `emsCacheGet(DB_USERS)` |
| E2E: Save student → open ID card | Name/photo match saved record |
| E2E: Tenant switch → ID card | Shows correct tenant's student only |
| Regression: Offline save → ID card | Works without network |

---

## What NOT to Change

| Item | Reason |
|------|--------|
| `ems_global_terms_*` localStorage | UI preference, not registration SSOT |
| ID card template storage (`ems_idcard_templates`) | Design prefs, not student data |
| Import mapping profiles | Separate concern |
| `ems-audit.js` Firestore writes | Already cloud-native |
| Write path (`emsRegRepoPersistRegistration`) | Already correct |

---

## Acceptance Criteria

- [ ] Zero `emsCacheGet(DB_USERS)` calls in `admission.js` and `ems-idcard.js`
- [ ] Zero `localStorage.getItem(DB_USERS)` in registration read paths
- [ ] ID card and letter modals use `emsRegRepoGetById`
- [ ] Rejected table uses `emsRegRepoGetRejectedList` exclusively
- [ ] `generateAutoID` uses `emsRegRepoFetchMaxIdNum` (async path mandatory)
- [ ] Legacy fallback behind `EMS_REG_LEGACY_READ_FALLBACK` flag (default `false`)
- [ ] All existing Vitest + E2E tests pass
- [ ] No regression in offline-first boot

---

## Estimated Impact on Scores

| Dimension | Before | After Phase 1 P1 |
|-----------|--------|------------------|
| Architecture | 78 | 82 |
| Security | 58 | 62 |
| User Experience | 62 | 66 |

---

*Next step: Implement Step 1 helper + Step 2 call-site replacements in a dedicated sprint.*
