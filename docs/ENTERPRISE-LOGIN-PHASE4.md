# Enterprise Login — Phase 4: Admin TTL, Temp Grant Lifecycle, CF-Only Parent Data

**Date:** 2026-06-19  
**Builds on:** Phase 1–3

---

## Summary

Phase 4 adds **admin-configurable Access Key TTL**, **automatic temporary grant cleanup**, **parent portal Cloud Function-only data path**, and **login E2E smoke tests**.

---

## Changes

### 1. Admin-configurable Key TTL

| UI | Location |
|----|----------|
| Teacher key TTL dropdown | Admin Panel → Staff permissions modal |
| Parent key TTL dropdown | Admin Panel → Parent permissions modal |

**Options:** 7 / 30 / 90 / 365 days (`ACCESS_KEY_TTL_OPTIONS` in `access-keys.js`)

Selection persists in `localStorage.ems_access_key_ttl_days` for convenience.

### 2. Temporary Grant Auto-Purge

| Trigger | Schedule / Event |
|---------|------------------|
| `purgeExpiredTempGrantsScheduled` | Every 24 hours — all tenants |
| `onStaffPermissionsWrite` | On write — strip expired `temporary` keys |
| `onParentPermissionsWrite` | On write — strip expired `temporary` keys |

**Logic:** `functions/lib/temp-grants.js` — uses `expiryAt` (ms) with ISO `expiry` fallback.

### 3. Parent CF-Only Data Path

`parent-portal.js` no longer falls back to:
- Direct Firestore `Registrations` reads
- localStorage attendance/exam/fee/announcement cache

All views call `getParentStudentData` except **leave/messages** (parent-submitted messages remain client-side).

**New server views:** `progress`, `teacher_notes`, `complaints`

### 4. E2E Login Smoke Tests

| File | Coverage |
|------|----------|
| `tests/e2e/login-smoke.spec.js` | 4 portal cards, guest login panel, script load, parent shell |
| `tests/unit/temp-grants.test.js` | Purge logic unit tests |

Run:
```powershell
npm test
npm run test:e2e
```

---

## Files Modified / Added

| File | Change |
|------|--------|
| `access-keys.js` | `ACCESS_KEY_TTL_OPTIONS`, `emsAccessKeyTtlMs`, `emsFormatKeyTtlLabel` |
| `admin-panel.js` | TTL dropdowns on key generation |
| `parent-portal.js` | CF-only fetches, error UI |
| `functions/lib/parent-data.js` | progress, teacher_notes, complaints views |
| `functions/lib/temp-grants.js` | **new** — purge + triggers |
| `functions/index.js` | export temp grant functions |
| `tests/e2e/login-smoke.spec.js` | **new** |
| `tests/unit/temp-grants.test.js` | **new** |

---

## Deploy

```powershell
firebase deploy --only functions:purgeExpiredTempGrantsScheduled,functions:onStaffPermissionsWrite,functions:onParentPermissionsWrite,functions:getParentStudentData,functions:getParentLinkedStudents
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

---

## Phase 5 (next)

- Tenant-level default TTL in Firestore settings
- Parent messaging via Cloud Function
- Full authenticated E2E (Google test account + emulator)
- Key rotation reminders / expiry admin dashboard

---

*End of Phase 4 Report*
