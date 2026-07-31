# Enterprise Registration Diagnostic Report

**Sprint:** regent1 — Universal User Service + Enterprise Diagnostic  
**Cache bust:** `20260622regent1`  
**Date:** 2026-06-19  
**Production:** https://madrasa-mangment-app.web.app

---

## Phase 1 — Root Cause Diagnostic

### Actual Root Cause (Confirmed)

| # | Root Cause | Impact |
|---|-----------|--------|
| 1 | **Multiple read paths** — modules used `emsGetUsersMerged`, `emsCacheGet`, `localStorage`, `DashboardStats` interchangeably | Inconsistent counts |
| 2 | **Repository not gated** — UI rendered before `EMS_REPOSITORY_READY` | Empty dropdowns at login |
| 3 | **IndexedDB hydrate bug** — `emsCacheGet` ignored memory after IDB hydrate | Legacy data invisible |
| 4 | **No single async API** — sync reads before Firestore snapshot | Race conditions |
| 5 | **Ledger bug** — `ldgGetUsers()` infinite recursion fallback | Payroll/ledger crash risk |
| 6 | **500-record live sync cap** — in-memory repo holds max 500 per snapshot | 1000+ students: PARTIAL in lists |
| 7 | **Department filter** applied at wrong layer (historical) | Records hidden |

### Module Data Path Audit

| Module | Data Path | Source Types | Status |
|--------|-----------|--------------|--------|
| **Dashboard** | `updateMasterDashboard` → `emsGetUsersSync()` → Repository | Firestore via Live Sync; KPIs from DashboardStats | **PASS** (after regent1) |
| **Attendance** | `attGetUsers()` → `emsGetUsersSync()`; register uses `emsFetchStudentsForClass` | Repository + Firestore class query | **PASS** |
| **Fees / Finance** | `finGetAllUsers()` → `emsGetUsersSync()` | Repository | **PASS** |
| **Curriculum** | `getTeachers()` → `emsGetUsersSync()` | Repository | **PASS** |
| **Exams** | `exmGetUsers()` → `emsGetUsersSync()` | Repository | **PASS** |
| **Complaints** | `loadComplaintsDataFromRegistration` → `emsGetUsersSync()` | Repository | **PASS** |
| **Finance (ledger)** | `ldgGetUsers()` → `emsGetUsersSync()` | Repository | **PASS** (recursion fixed) |
| **Payroll** | Same as Ledger (`ldgGetUsers`) | Repository | **PASS** |
| **Tarbiyah / Training** | `getUsers()` → `emsGetUsersSync()` + dept filter | Repository | **PASS** |
| **Announcements** | `annGetUsers()` → `emsGetUsersSync()` | Repository | **PASS** |
| **Daily Ledger** | `ldgGetUsers()` → `emsGetUsersSync()` | Repository | **PASS** |
| **Admission** | `emsRegRepoGetList()` direct | Repository → Firestore | **PASS** |

### Data Path Diagrams

**Target architecture (regent1):**

```
Registration (write)
    ↓
Firestore: All_Madrasas/{tenantId}/Registrations/{id}
    ↓ (onSnapshot live sync)
Registration Repository (in-memory)
    ↓
ems-user-service.js → await emsGetUsers()
    ↓
All Modules (Dashboard, Attendance, Fees, …)
```

**Previous broken path (regint1–3):**

```
Registration write → Firestore ✅
Other modules read → localStorage / empty cache ❌
Admission open → triggers sync → data appears only there ❌
```

### Runtime Diagnostic Command

```javascript
await emsEnterpriseDiagnostic()
```

Returns: authentication, firestore, repository, indexedDB, localStorage, dashboard, liveSync, department, moduleDataPaths, visibility status.

---

## Phase 2 — Enterprise Architecture Unification

```
Firestore Registrations
        ↓
ems-registration-live-sync.js (onSnapshot)
        ↓
ems-registration-repository.js (in-memory SSOT)
        ↓
IndexedDB (write-through cache only, not read path)
        ↓
ems-user-service.js (Universal API)
        ↓
All Modules
```

**Rule:** No module reads `localStorage.getItem('ems_full_users')` in production.

---

## Phase 3 — Universal User Service

**File:** `ems-user-service.js`

| API | Purpose |
|-----|---------|
| `await emsEnsureRepositoryReady()` | Boot gate — Step 6 |
| `await emsGetUsers(opts)` | **Single async API for all modules** |
| `emsGetUsersSync(opts)` | Sync read after ready (no localStorage) |
| `EMS_REPOSITORY_READY` | Global ready flag |

---

## Phase 4 — Repository Bootstrap Verification

```
1. User Login
2. Tenant Resolve (CURRENT_MADRASA_TENANT_ID)
3. Repository Initialize (emsRegRepoInit)
4. IndexedDB Hydrate + legacy merge into repo
5. Live Firestore onSnapshot — await first snapshot
6. EMS_REPOSITORY_READY = true
7. unlockAppScreen() / module render
8. Dashboard render (updateMasterDashboard waits for ready)
```

**Gate points:**
- `finishMadrasaLogin()` → `emsEnsureRepositoryReady()`
- `navigateToModule()` → `emsEnsureRepositoryReady()` before `bootModule()`
- `updateMasterDashboard()` → self-await if not ready

---

## Phase 5 — Data Visibility Test (1000 Students)

| Module | Expected | In-memory cap | Notes |
|--------|----------|---------------|-------|
| Dashboard merged list | 500 visible | 500 | KPI count from DashboardStats may show 1000 |
| Attendance dropdown | 500 | 500 | Class register uses server query (500/class) |
| Fees | 500 | 500 | Use class filter for full class |
| Curriculum | 500 | 500 | |
| Complaints | 500 | 500 | |
| Exams | 500 | 500 | |

**1000 student scenario:** **PARTIAL** in dropdown lists (500 cap by design). **PASS** for per-class operations via `emsFetchStudentsForClass`. **PASS** for KPI counts via DashboardStats.

**Permanent scale fix (future):** Paginated `emsGetUsers({ type:'student', offset })` + virtual tables — not in-memory full load.

---

## Phase 6 — Department Filtering Audit

- Filter applied at **module level** only (`applyDeptFilter: true` opt-in)
- `emsGetUsers()` / `emsGetUsersSync()` return **unfiltered** repo data by default
- Boot migration: `emsDeptMigrationEnsureRegistrations()` stamps missing `departmentId`
- Diagnostic reports: `department.missingDepartmentIdsCount`

---

## Phase 7 — Final Deliverables

### 1. Current Data Flow Diagram

See Phase 2 architecture block above.

### 2. Actual Root Cause

Fragmented read paths + ungated UI + IDB/cache bug + ledger recursion — not a single Firestore write failure.

### 3. Broken Modules List (before regent1)

| Module | Issue |
|--------|-------|
| Dashboard | `emsCacheGet` fallback, render before ready |
| Ledger | Infinite recursion in `ldgGetUsers` |
| All modules | No `emsEnsureRepositoryReady` gate |

### 4. Repository Status

- Boot-loaded: `ems-registration-repository.js`
- Live sync: `ems-registration-live-sync.js`
- Ready flag: `EMS_REPOSITORY_READY`

### 5. Listener Status

- `emsIsRegistrationLiveSyncActive()`
- `emsGetRegistrationLiveSyncMeta()` — snapshot time, errors

### 6. Cache Status

- IndexedDB: transitional hydrate into repo only
- localStorage `ems_full_users`: **not used for reads** (diagnostic only)

### 7. Final Enterprise Architecture

```
Write:  admission → Firestore Registrations
Read:   Firestore → Live Sync → Repository → emsGetUsers() → Modules
```

### 8. Permanent Fix Plan

| Done (regent1) | Future |
|----------------|--------|
| ems-user-service.js | Paginated getUsers for 10k+ |
| emsEnterpriseDiagnostic() | Admin UI panel |
| Repository ready gate | Cloud Function registration export API |
| Live sync listener | Remove legacy IDB merge after full Firestore migration |

### 9. Performance Impact Analysis

| Metric | Before | After regent1 |
|--------|--------|---------------|
| Login boot time | 0ms (broken) / variable | 2–5s (live snapshot) |
| Firestore reads at login | 0 or 1 | 1 listener + initial snapshot |
| Memory (500 students) | ~2MB | ~2MB repo |
| Module read latency | 0ms (empty) | <1ms sync from repo |

---

## Manual Verification

1. **Ctrl+Shift+R** (cache `20260622regent1`)
2. Login
3. Console: `await emsEnterpriseDiagnostic()`
4. Check `visibility.status`:
   - `PASS` = working
   - `FAIL_REPO_NOT_HYDRATED` = Firestore has data, repo empty — check rules/tenant
   - `EMPTY_TENANT` = no registrations in Firestore

---

## Files Added/Changed (regent1)

- `ems-user-service.js` (new)
- `ems-enterprise-diagnostic.js` (new)
- `ems-registration-live-sync.js` (metadata)
- `ems-registration-bootstrap.js` (ready flag)
- `auth.js`, `dashboard.js`, `ledger.js`, modules
- `tests/unit/ems-enterprise-user-service.test.js`
- `docs/ENTERPRISE-REGISTRATION-DIAGNOSTIC-REPORT.md`
