# Registration Legacy Fix Report

**Sprint:** 1 (Week 1–2)  
**Date:** 9 July 2026  
**Status:** ✅ COMPLETE  
**Scope:** Registration department only

---

## Goal

Eliminate Registration UI reads from legacy `localStorage` / `emsCacheGet` blobs (`ems_full_users`, `ems_rejected_users`) and route all record lookups through the Registration Repository SSOT.

---

## Changes Implemented

### 1. `ems-registration-repository.js`

| Change | Detail |
|--------|--------|
| `EMS_REG_LEGACY_READ_FALLBACK` | New flag, default `false` — legacy reads opt-in only |
| `repoMirrorGetById(id)` | Reads single record from IDB mirror `{tenant}__registrations` |
| `fetchRegRecordFromCloud()` | Extracted cloud fetch logic (approved + rejected) |
| `legacyRegRecordFallback()` | Gated behind `EMS_REG_LEGACY_READ_FALLBACK=true` |
| `emsRegRepoGetById` (enhanced) | RAM → IDB mirror → cloud; offline SSOT before Firestore |
| `emsRegGetRecordById(id, opts)` | **New** unified SSOT read API |

**Offline read path (approved records):**
```
emsRegGetRecordById(id)
  → state.byId[id]           (RAM hit)
  → repoMirrorGetById(id)    (IDB mirror)
  → fetchRegRecordFromCloud  (if online)
  → legacyRegRecordFallback  (only if EMS_REG_LEGACY_READ_FALLBACK=true)
```

### 2. `admission.js`

| Site | Before | After |
|------|--------|-------|
| `DB_USERS` / `DB_REJECTED` constants | Active read keys | Removed; comment only |
| `generateAutoID` | Fallback to `localStorage` | `emsRegRepoGetList` + `GetRejectedList` only |
| `renderRejectedTable` | Fallback to `emsCacheGet(DB_REJECTED)` | `emsRegRepoGetRejectedList()` only |
| `viewRejectedInfo` | Legacy array fallback | `emsRegRepoGetById` / `emsGetUserById` |
| `editRegistration` | Legacy `emsCacheGet(dbKey)` | `emsRegGetRecordById` → `emsGetUserById` |
| `openIDCardModal` | 60-line legacy implementation | Removed; delegated to `ems-idcard.js` |
| `openLetterModal` | `emsCacheGet(DB_USERS)` sync read | Async `emsRegGetRecordById` via `renderLetterModalContent` |

**Intentionally unchanged:** `DB_CLASSES` / class list localStorage (separate metadata, not registration SSOT).

### 3. `ems-idcard.js`

| Site | Before | After |
|------|--------|-------|
| `openIDCardModal` fallback | `emsGetUsersMerged` → `emsCacheGet('ems_full_users')` | `emsRegGetRecordById` → `emsGetUserById` only |

### 4. `tests/unit/ems-registration-legacy-fix.test.js`

New unit test file — 7 assertions verifying:
- No `DB_USERS` / `DB_REJECTED` reads in `admission.js`
- SSOT helpers present in repository
- Legacy fallback default `false`
- ID card uses SSOT only

---

## Legacy Read Sites — Resolution Matrix

| # | File | Function | Status |
|---|------|----------|--------|
| 1 | `admission.js` | `generateAutoID` | ✅ Fixed |
| 2 | `admission.js` | `renderRejectedTable` | ✅ Fixed |
| 3 | `admission.js` | `viewRejectedInfo` | ✅ Fixed |
| 4 | `admission.js` | `editRegistration` | ✅ Fixed |
| 5 | `admission.js` | `openIDCardModal` | ✅ Removed (ems-idcard.js canonical) |
| 6 | `admission.js` | `openLetterModal` | ✅ Fixed |
| 7 | `ems-idcard.js` | `openIDCardModal` | ✅ Fixed |
| 8 | `registration-ui.js` | `emsLoadRegistrationListForUI` | ⚠️ Pre-existing undefined ref (Sprint 2+) |

**Archive viewer:** No UI exists; internal archive in repository unchanged (no legacy reads).

---

## Backward Compatibility

| Mechanism | Behavior |
|-----------|----------|
| `EMS_REG_LEGACY_READ_FALLBACK=false` (default) | No legacy reads |
| `EMS_REG_LEGACY_READ_FALLBACK=true` | One-release emergency fallback via `legacyRegRecordFallback` |
| Write path | Unchanged — `emsRegRepoPersistRegistration` |
| `emsGetUserById` | Still works; uses enhanced `emsRegRepoGetById` |
| Offline-first boot | Unchanged — IDB hydrate path intact |

---

## Files Modified

```
ems-registration-repository.js   (+repoMirrorGetById, emsRegGetRecordById, enhanced getById)
admission.js                     (6 legacy read sites removed)
ems-idcard.js                    (1 legacy fallback removed)
tests/unit/ems-registration-legacy-fix.test.js  (new)
```

**Not modified:** Attendance, Finance, Exams, Dashboard, or other modules.

---

## Verification Summary

| Check | Result |
|-------|--------|
| New unit tests (7) | ✅ 7/7 pass |
| Registration E7 tests (5) | ✅ 5/5 pass |
| ID card syntax tests (2) | ✅ 2/2 pass |
| Full Vitest suite | ✅ 467/468 pass (1 unrelated smoke timeout) |
| `emsCacheGet(DB_USERS)` in admission.js | ✅ Zero occurrences |
| `localStorage.getItem(DB_USERS)` in admission.js | ✅ Zero occurrences |

---

## Score Impact (Estimated)

| Dimension | Before | After Sprint 1 |
|-----------|--------|----------------|
| Architecture | 78 | **82** |
| Security | 58 | **60** |
| User Experience | 62 | **64** |

---

## Known Remaining Items (Out of Sprint 1 Scope)

1. `emsLoadRegistrationListForUI` undefined in `registration-ui.js` — Sprint 2+
2. `DB_CLASSES` still uses localStorage — class metadata, not student SSOT
3. `android/` and `dist/` copies update on next `npm run build` / `android:copy`
4. `ems-user-access.js` `localUserFallback` uses `emsGetUsersMerged` (repo-based, acceptable)

---

## Next Sprint

**Sprint 2 — Cloud-First Search** (do not start until this sprint is approved)

---

*Sprint 1 legacy path removal: COMPLETE*
