# Registration Duplicate Detection — Implementation Report

**Sprint:** 3 (Week 5–6)  
**Date:** 9 July 2026  
**Status:** ✅ COMPLETE (Phase 1a + blur checks)  
**Scope:** Registration department only

---

## Goal

Prevent duplicate student/teacher/staff admission via CNIC, phone, and soft identity rules. Block hard duplicates on save; warn on soft matches. Owner-only override for hard blocks.

---

## Changes Implemented

### 1. `ems-registration-duplicates.js` (new)

| API | Purpose |
|-----|---------|
| `emsRegCheckDuplicates(candidate, opts)` | RAM scan via `emsRegRepoForEach` + rejected list |
| `emsRegCheckDuplicatesAsync()` | Promise wrapper (future IDB index) |
| `emsRegCheckFieldDuplicate(field, value, opts)` | Blur-time single-field check |
| `emsRegDupNormalizeCnic/Phone/Name()` | Normalization helpers |
| `emsRegCanOverrideHardDuplicate()` | `isMadrasaAdmin` / `isSuperAdmin` |

**Rules implemented:**

| Rule | Severity | Match |
|------|----------|-------|
| D1 | Hard | CNIC 13-digit exact (normalized) |
| D2 | Hard | B-Form alias |
| D3 | Hard | Phone last 10 digits (≥10) |
| D4 | Soft | Name + father name |
| D5 | Soft | Name + class |
| D6 | Soft | Roll (`madrasaRollNo`, `rollNo`, `wifaqRollNo`) |
| D7 | Soft | Name + phone last 7 digits |

**Deferred (Phase 2):** D8 fuzzy name, import cross-check (`ems-import-export.js`), IDB secondary index.

### 2. `ems-post-auth-loader.js`

Loads `ems-registration-duplicates.js` immediately after `ems-registration-repository.js`.

### 3. `admission.js`

| Feature | Detail |
|---------|--------|
| `regRunDuplicateGate()` | Runs before photo upload + persist |
| `regShowDuplicateModal()` | Hard block / soft warn UI |
| Owner override | Prompt for reason + `emsLogAudit('duplicate_override')` if available |
| `regDupWireBlurChecks()` | CNIC + phone blur on student/teacher/staff forms |
| View existing | Opens `editRegistration()` from soft-warning modal |

### 4. `style.css`

Field hint classes: `.reg-dup-ok`, `.reg-dup-warn`, `.reg-dup-block`

### 5. Tests

`tests/unit/ems-registration-duplicates-s3.test.js` — 9 tests (static + vm runtime)

---

## UI Flow

```
processRegistration(type, status)
  → regRunDuplicateGate(user)
      → emsRegCheckDuplicates (scope: all)
      → hasHard → modal (block; Owner override only)
      → hasSoft only → modal (continue / view existing)
  → proceedRegistrationSave → persistUserToFirestore
```

---

## Permissions

| Action | Who |
|--------|-----|
| See duplicate warning | Staff with admission access |
| Continue soft duplicate | Any staff |
| Override hard duplicate | Owner / Madrasa admin only |

Full permissions sprint (Sprint 5) not started — uses existing `isMadrasaAdmin` / `isSuperAdmin` only.

---

## Audit

Hard override calls existing `emsLogAudit('admission', 'duplicate_override', …)` when loaded. Full audit trail sprint not started.

---

## Performance

RAM scan via `emsRegRepoForEach` — acceptable to ~50k in memory per plan. IDB duplicate index deferred to Phase 1b.

| Scale | Expected check time |
|-------|---------------------|
| 10k | <100ms |
| 50k | <800ms |

---

## Score Impact (Target)

| Dimension | Before | After Sprint 3 |
|-----------|--------|----------------|
| Security | 58 | **65** |
| UX | 68 | **70** |

---

## Files Changed

- `ems-registration-duplicates.js` (new)
- `ems-post-auth-loader.js`
- `admission.js`
- `style.css` (registration dup hints only)
- `cloud/ems-cloud-manifest.js` (typo fix)
- `bench/reg-cloud-search-bench.js` (Sprint 2 bench — scheduled)
- `tests/unit/ems-registration-duplicates-s3.test.js` (new)
- `docs/REGISTRATION_DUPLICATE_IMPLEMENTATION_REPORT.md` (this file)

---

## Next Sprint

Sprint 4 — Audit trail (registration-scoped). Do not start until user confirms Sprint 3 acceptance.
