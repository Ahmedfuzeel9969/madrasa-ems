# Registration P0 Security Fix Report

**Date:** 9 July 2026  
**Scope:** Phase A accepted — P0 fixes only (no Phase B)  
**Status:** GREEN for registration P0 scope

---

## Executive Summary

Two P0 security gaps from the Phase A audit are closed:

1. **RegistrationDrafts Firestore rules** — previously missing; all cloud draft writes were silently denied.
2. **Client vs server permission mismatch** — staff could attempt SSOT approve/reject while Firestore allows only owner/admin writes to `Registrations` / `Rejected`.

**Approved model:** **C — Staff draft/request; owner/admin approves into SSOT**

---

## Model Recommendation (Fix 2)

| Option | Description | Verdict |
|--------|-------------|---------|
| **A** | Staff local/offline only; owner syncs later | Partial — local drafts work, but Phase A already mirrors drafts to Firestore |
| **B** | Staff direct Firestore SSOT write with permission checks | **Rejected** — expands PII SSOT attack surface; contradicts existing `canWriteRegistration` owner-only policy |
| **C** | Staff saves drafts; owner/admin commits to SSOT | **Approved** — aligns Phase A architecture, Firestore rules, and audit expectations |

### Model C behavior (implemented)

| Actor | Draft (local + `RegistrationDrafts`) | SSOT (`Registrations` / `Rejected`) |
|-------|--------------------------------------|-------------------------------------|
| Owner / Admin | Full tenant draft access | Full write via `canWriteRegistration` |
| Staff (admission create/edit) | Own draft only | **Blocked** — use draft; owner approves |
| Teacher | No draft write | No SSOT write |
| Parent | Denied | Denied (read linked student only on approved records) |
| Anonymous | Denied | Denied |

---

## P0 Fix 1 — Firestore Rules

**Path:** `RegistrationDrafts/{tenantId}/items/{staffId}_{type}`

**File:** `firestore.rules`

### Helpers added

- `isValidRegistrationDraftData(tenantId)` — required fields, tenant match, revision int
- `registrationDraftDocMatchesId(docId)` — doc id must equal `staffId_type`
- `canReadRegistrationDraft(tenantId)`
- `canCreateRegistrationDraft(tenantId, docId)`
- `canUpdateRegistrationDraft(tenantId)`
- `canDeleteRegistrationDraft(tenantId)`

### Access policy

| Rule | Enforcement |
|------|-------------|
| Staff own draft | Read/write/delete only when `resource.data.staffId == staffRecordId(tenantId)` |
| Owner/admin | Full read/write/delete for tenant drafts |
| Cross-tenant | Denied via `tenantId` + payload validation |
| Parent | Explicit `!isParentOf(tenantId)` on all draft ops |
| Public | Denied — all paths require `isSignedIn()` |
| PII | Signed-in only; payload schema enforced; no list-all for anonymous |

### SSOT unchanged (intentional)

`All_Madrasas/{madrasaId}/Registrations` and `Rejected` remain **owner/admin only** via `canWriteRegistration(madrasaId)`.

---

## P0 Fix 2 — Client Alignment

**Files:**

- `ems-registration-permissions.js`
- `admission.js`
- `ems-registration-drafts.js`

### New APIs

| API | Purpose |
|-----|---------|
| `emsRegCanWriteSsot()` | Owner/admin only — mirrors Firestore SSOT write |
| `emsRegCanDraftWrite(editingId)` | Staff create/edit for draft workflow |
| `emsRegRequireSsotSave(status, …)` | Blocks staff approve/reject to SSOT; logs `reg_ssot_write_denied` |

### Permission changes

- Removed staff default `reject: true` from reception template defaults
- Removed approve/reject grant via create/edit bridge (was allowing SSOT bypass)
- `processRegistration` now calls `emsRegRequireSsotSave` before any SSOT persist

### Draft module fixes

- Restored missing `applyTeacherFields()` (teacher draft resume bug)
- Cloud sync failure now logs `reg_draft_cloud_sync_denied` and queues outbox retry (offline-safe)

---

## Deployment Notes

1. Deploy rules: `npm run deploy:firestore`
2. Deploy hosting after `npm run build:hosting` (client permission changes)
3. **Do not start Phase B** until operator confirms rules + hosting deployed to target environment

---

## Test Results

| Suite | Result |
|-------|--------|
| Registration unit tests (`tests/unit/ems-registration*`) | **108/108 PASS** |
| P0 rules tests | **12/12 PASS** |
| P0 SSOT alignment tests | **10/10 PASS** |
| Full unit suite (`npm test`) | **574/576 PASS** — 1 pre-existing unrelated failure (`ems-android-asset-sync.test.js` preflight); not introduced by P0 |

See `REGISTRATION_P0_RULES_TEST_REPORT.md` for detailed matrix.

---

## Phase B

**Not started.** P0 registration security fixes are complete and green for scoped tests.
