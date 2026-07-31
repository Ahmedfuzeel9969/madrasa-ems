# Registration Department — Strengths & Weaknesses

**Audit Date:** 9 July 2026  
**Scope:** Registration / Admission department only  
**Mode:** Read-only analysis

---

## Overall Assessment

The Registration department is the **strongest subsystem** in the Madrasa EMS codebase. It has undergone multiple repair sprints (E7 paginated repo, A4 write-trigger sync, B1/B2 desktop unlimited, v3 search index, P6 operational fixes) and now operates as a credible offline-first registration platform for single-tenant deployments.

However, **legacy storage paths, dual render paths, and API caps** create hidden weaknesses that would surface at scale or in multi-staff concurrent workflows.

---

## Strengths

### 1. Offline-First Architecture (Excellent)

- Default flags: `EMS_REGISTRATION_SSOT_OFFLINE=true`, `EMS_OFFLINE_FIRST_SSOT=true`
- Lite login hydrates from IndexedDB without requiring network
- Writes persist locally first, cloud sync is async via mutation queue
- Boot overlay blocks UI until hydration contract is satisfied
- **Evidence:** `ems-registration-bootstrap.js`, `ems-registration-repository.js` L26–46

### 2. Paginated Repository SSOT (Strong)

- `state.byId` + `state.order` in-memory with IDB mirror per-record
- No full-array blob rewrites on routine saves
- `emsRegRepoGetListPage`, `emsRegRepoGetListAsync` for scalable reads
- Incremental mirror writes (`repoMirrorPut`/`repoMirrorRemove`)
- **Evidence:** `ems-registration-repository.js` L278–347, L1460–1477

### 3. Write-Trigger Sync (A4 — Best Practice)

- `RegistrationMeta/current` onSnapshot instead of full `Registrations` collection listener
- Avoids Firestore read amplification on large tenants
- Targeted `getById(forceRefresh)` on meta change
- **Evidence:** `cloud/ems-registration-live-sync.js` L1–46; test `ems-registration-a4.test.js`

### 4. Search Index v3 (Major Improvement)

- Row-doc index: 10k index build dropped from **715s → 17.5s** (~41×)
- `noLoadAllOnSearch`, `noColAllOnSearch` safety checks pass
- Multi-tab leader lock prevents write amplification (4.7× → 1.0× @ 3k/5 tabs)
- **Evidence:** `docs/idb-browser-bench.json`, `ems-search-index-lock.js`

### 5. Import System (Comprehensive)

- 7-step wizard with column mapping, templates, duplicate detection
- Chunked queue (500 records/chunk) for large commits
- Cloud Function bulk import (2000 max, owner-only, 500 batch writes)
- Pre-import snapshots and mapping profiles
- Import history tracking
- **Evidence:** `ems-import-wizard.js`, `ems-import-queue.js`, `functions/lib/bulk-import-registrations.js`

### 6. Multi-Type Registration (Complete)

- Students, Teachers, Staff — separate forms with type-specific fields
- Auto-ID generation (`STD-*`, `TCH-*`, `STF-*`)
- Rejected applications workflow with restore
- Class management integrated
- **Evidence:** `admission.js` L16–83, L88–123, L345–605

### 7. Output Features (Good)

- ID card system with templates, designer, print/PDF
- Official acceptance letters with QR codes
- Branding/signatures panel
- **Evidence:** `ems-idcard.js`, `admission.js` L1914–2053

### 8. Disaster Recovery (Robust)

- `emsForceCloudDisasterRecoverySync` — explicit full server pull
- `emsRegRepoRebuildLocalCacheFromServer` — rebuild from Firestore
- Legacy blob migration with verification
- CLI DR backup/restore scripts
- **Evidence:** `ems-registration-repository.js` L1783–1985

### 9. Tenant Isolation (Good Foundation)

- Scoped IDB keys: `{tenantId}__registrations`
- `emsActivateTenantStorage` resets repo on tenant switch
- `emsAssertTenantIsolation` flags legacy global cache
- Firestore rules: `canReadTenantStaff`, `canWriteRegistration` (owner-only)
- **Evidence:** `ems-tenant-storage.js`, `firestore.rules` L87–89, L373–387

### 10. Test Coverage (Solid)

- 8+ unit tests for registration-specific behavior
- 2 E2E specs for incremental mirror and live page
- P6 preprod: 100k/10-tab stress verified
- 467/467 Vitest pass at audit time
- **Evidence:** `tests/unit/ems-registration-*.test.js`, `docs/PRIORITY-6-PREPROD-REPORT.json`

### 11. Enterprise UX Layer (Good)

- Accordion forms reduce scroll on long Urdu forms
- Smart reopen: skips full sync when `emsRegRepoGetCount() > 0`
- Event-driven refresh (`ems:users-changed`, `ems:repo-hydrated`)
- Virtual table for saved records list
- RTL-aware pagination
- **Evidence:** `registration-ui.js`, `admission.js` L1058–1312

### 12. Storage Quota Safety (P6)

- 80/90/95% threshold warnings with Urdu banners
- Write-failure hooks on bulk import, backup, index build
- "Clean temporary files" action
- **Evidence:** `ems-storage-quota.js`

---

## Weaknesses

### Critical

| # | Weakness | Impact | Evidence |
|---|----------|--------|----------|
| W1 | **ID card/letter modals read legacy localStorage** | Stale or missing data under SSOT; users see wrong photos/names | `admission.js` L1916+ reads `DB_USERS`/`emsCacheGet`, not `emsRegRepoGetById` |
| W2 | **`emsGetUsersMerged` capped at 1000** | Finance, exams, curriculum, training see truncated student/teacher lists at scale | `ems-user-service.js` L23, L254–267 |
| W3 | **Mirror put failures swallowed** | RAM and IDB can silently diverge; data loss on browser crash | `ems-registration-repository.js` L344–346 |
| W4 | **Loose hydration match** | Boot succeeds with mismatched counts; partial data served as complete | `ems-registration-repository.js` L626–628 |
| W5 | **Limited refresh replaces RAM with page 1** | Multi-tab or sync refresh drops in-memory records beyond first page | `ems-registration-repository.js` L2051–2061 |

### High

| # | Weakness | Impact | Evidence |
|---|----------|--------|----------|
| W6 | **Dual render paths** | `renderRegTableViaRepo` vs `renderRegTableLegacy` — behavior diverges | `admission.js` L1055–1316 |
| W7 | **Broad prefix search O(n) at 100k** | ~4.4s search latency for high-match queries | `docs/idb-browser-bench.json` |
| W8 | **Cold index build ~32 min @ 100k** | Fresh install or rebuild blocks search for extended period | `docs/idb-browser-bench.json` |
| W9 | **No field-level audit trail** | Cannot answer "who changed what when" for a registration | No audit log store found |
| W10 | **Owner-only cloud writes** | Staff cannot register students when owner is absent; no delegated permissions | `firestore.rules` L87–89 |
| W11 | **`emsLoadRegistrationListForUI` undefined** | Referenced but missing; falls back silently | `registration-ui.js` L122–123 |
| W12 | **Legacy storage paths still active** | `ems_full_users`, `ems_reg_full_v2_*` coexist during migration | `ems-tenant-storage.js` L28–48 |

### Medium

| # | Weakness | Impact | Evidence |
|---|----------|--------|----------|
| W13 | **No draft saving** | Long forms lost on tab switch or browser close | No draft store |
| W14 | **No duplicate detection on manual entry** | CNIC/phone duplicates possible at form save time | Only import has `emsImportAnalyzeDuplicates` |
| W15 | **Import CF max 2000 records** | Large school migrations need many sequential CF calls | `functions/lib/bulk-import-registrations.js` L9 |
| W16 | **Rejected cache separate from IDB mirror** | Rejected list can diverge from `rejectedById` | `ems-registration-repository.js` L595–605 |
| W17 | **No archive UI** | Archived records invisible to users | `ARCHIVE_KEY` in repo, no UI |
| W18 | **Inline onclick in dynamic rows** | XSS risk if IDs unsanitized; hard to maintain | `admission.js` L905–908 |
| W19 | **Photo upload no server-side validation** | File type/size not validated beyond `accept="image/*"` | `index.html` L530 |
| W20 | **Pause sync is no-op** | `emsPauseRegistrationLiveSync` empty body | `cloud/ems-registration-live-sync.js` L85–87 |

### Low

| # | Weakness | Impact | Evidence |
|---|----------|--------|----------|
| W21 | **Default tab is student form, not saved records** | Office staff must click extra tab to find existing records | `registration-ui.js` opens student tab |
| W22 | **No deep-link to list/search state** | Cannot bookmark or share a filtered list view | No URL routing |
| W23 | **Class management basic** | No class capacity, section management, or academic year binding | `admission.js` L608–662 |
| W24 | **Terms templates not versioned** | Template changes affect all future letters retroactively | `admission.js` L1866–1911 |
| W25 | **Finance has no cache-generation awareness** | May show stale student lists until manual refresh | `finance.js` uses `emsGetUsersSync` only |

---

## Security Review (Part 7)

### Permissions & Access Rules

| Area | Status | Detail |
|------|--------|--------|
| **Firestore read** | Good | `canReadTenantStaff(madrasaId)` or `parentHasLinkedStudent` |
| **Firestore write** | Restrictive | `canWriteRegistration` = owner + MFA (when required) or superadmin |
| **Bulk import** | Good | `assertOwner` — only madrasa owner can bulk import |
| **Enterprise search** | Good | `assertTenantAccess` on CF call |
| **Client-side permissions** | Weak | No role-based UI hiding in `admission.js`; all tabs visible to any logged-in user |
| **Staff delegation** | Missing | No `StaffPermissions` entry for registration write |

### Data Leakage Risks

| Risk | Severity | Detail |
|------|----------|--------|
| Legacy `ems_full_users` in localStorage | Medium | Unscoped key may contain cross-tenant data until purged |
| ID card modal reads all users from cache | Medium | No filter by current tenant in legacy path |
| Photo base64 in records | Low | Stripped on lean, but may exist in legacy blobs |
| Import file contents in memory | Low | Parsed CSV/XLSX held in wizard state until commit |

### Cross-Tenant Risks

| Risk | Severity | Detail |
|------|----------|--------|
| Tenant switch without full purge | Medium | `emsActivateTenantStorage` resets repo but legacy global keys may persist |
| `emsAssertTenantIsolation` detection | Good | Flags `LEGACY_GLOBAL_CACHE` if unscoped keys found |
| CF tenantId validation | Good | Server validates `tenantId` + owner/auth on all calls |

### Import Security

| Control | Status |
|---------|--------|
| Authentication required | Yes (CF + client) |
| Owner-only bulk import | Yes |
| Record count limit (2000) | Yes |
| Field sanitization (`cleanRecord`) | Yes — strips `_` prefixed fields |
| File type validation | Weak — client-side only |
| Malicious CSV injection | Not tested |
| Rate limiting on CF | Not found |

### File Upload Security

| Control | Status |
|---------|--------|
| Photo accept filter | `image/*` only (client) |
| Server-side photo validation | Not found in `ems-photo-storage.js` |
| File size limit | Not found |
| Virus/malware scan | Not implemented |

### Validation

| Area | Status |
|------|--------|
| Required fields on save | Partial — name required; CNIC format not enforced |
| CNIC duplicate check | Missing on manual entry |
| Phone format validation | Missing |
| Auto-ID collision check | Yes — repo-aware async generation |
| Import smart validation | Yes — `EmsImportExport.smartValidate` |

### Audit Logging

| Event | Logged? |
|-------|---------|
| Registration create/update/delete | No dedicated audit log |
| Import operations | Yes — import history |
| Rejection/restore | No |
| Disaster recovery | Console logs only |
| Permission changes | Firestore rules only (no client log) |
| Login/access to registration | No |

### Hidden Security Risks Summary

1. **Any authenticated staff can access all registration UI** — Firestore blocks writes but client shows full UI
2. **Legacy localStorage path bypasses tenant scoping** in ID card/letter modals
3. **No rate limiting** on registration save or import CF
4. **No input sanitization** on dynamic table row HTML generation
5. **MFA enforcement** only at Firestore rules level, not client UI

---

## Risk Matrix

```
                    IMPACT
              Low    Med    High   Critical
         ┌──────┬──────┬──────┬──────────┐
  High   │ W21  │ W13  │ W6   │ W1       │
LIKELI-  │ W22  │ W15  │ W7   │ W2       │
HOOD     │ W23  │ W18  │ W9   │ W3       │
         ├──────┼──────┼──────┼──────────┤
  Med    │ W24  │ W16  │ W10  │ W4       │
         │ W25  │ W19  │ W12  │ W5       │
         ├──────┼──────┼──────┼──────────┤
  Low    │ W20  │      │ W8   │          │
         └──────┴──────┴──────┴──────────┘
```

---

## Competitive Position

Against the system's own modules, Registration ranks **#1 in maturity**. Against global educational ERP standards, it ranks **#3 in offline capability** but **#8 in workflow automation, audit, and analytics**.

---

*End of Strengths & Weaknesses Report*
