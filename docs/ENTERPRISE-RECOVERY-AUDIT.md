# Enterprise Registration Recovery — Emergency Audit (regent2)

**Date:** 2026-06-19  
**Prior deploy:** regent1 (`20260622regent1`) — critical regression confirmed  
**Recovery deploy:** regent2 (`20260622regent2`)

---

## 1. Tenant Resolution Path

```
firebase.auth().onAuthStateChanged
  → listenMadrasaProfile()
  → emsResolveTenantContext(user, firestore)     [tenant-context.js]
       Priority: owner profile > Staff_Links > Parent_Links
  → CURRENT_MADRASA_TENANT_ID = ctx.tenantId
  → applyMadrasaProfile / applyStaffTenantProfile
  → finishMadrasaLogin()
       → emsStartSyncEngine() uses emsGetTenantId() || user.uid  ⚠ race risk
```

**regent2 fix:** `ems-tenant-resolver.js` — `emsRequireTenantId()` blocks Firestore queries without confirmed tenant.

---

## 2. Repository Initialization Sequence

```
finishMadrasaLogin
  → emsStartSyncEngine
       → EmsSyncEngine.init(tenantId)
       → emsBootRegistrationData(tenantId)
            → emsRegRepoInit(tenantId)
            → emsIdbHydrateCache
            → mergeIdbUsersIntoRepo
            → mergeLegacyLocalStorageUsers
            → emsStartRegistrationLiveSync
            → emsRegRepoEnsureReady (fallback if empty)
            → emsDeptMigrationEnsureRegistrations
            → emsMarkRepositoryReady
```

---

## 3. Live Sync Lifecycle (regent1 — broken)

```
Login → emsStartRegistrationLiveSync → onSnapshot → repo upsert
Module leave (non-admission) → emsPauseRegistrationSync
  → emsStopRegistrationSync
  → emsRegRepoStop()  ❌ REPO DESTROYED
```

**regent2 fix:** Live sync stays attached entire session. Pause only detaches listener (optional). Repo destroyed **only on logout**.

---

## 4. UI Unlock Lifecycle (regent1 — broken)

```
finishMadrasaLogin
  → emsEnsureRepositoryReady (may return ready:false, count:0)
  → unlockAppScreen() always runs (even in .catch)  ❌
  → Dashboard renders with emsGetUsersSync() → []
```

**regent2 fix:** Unlock only after `EMS_REPOSITORY_BOOT_COMPLETE`. If Firestore has data but repo empty → block + show hydration error. If truly empty tenant → show "No records found" message.

---

## 5. Repository Destruction Lifecycle (regent1 — forbidden behaviour)

| Trigger | regent1 | regent2 |
|---------|---------|---------|
| Logout | `emsStopRegistrationSync` → destroy | `emsDestroyRegistrationSession` → destroy ✅ |
| Module navigation | destroy ❌ | **no destroy** ✅ |
| Session idle | none | none |
| Tenant switch | partial | full destroy + re-boot |

---

## 6. Registration Form Initialization (regent1 — broken)

```
admission.js lazy-loaded via ems-lazy-loader.js
  → document.addEventListener('DOMContentLoaded', ...)  ❌
  → DOMContentLoaded already fired → listeners never attach
```

**regent2 fix:** `RegistrationModule.init()` called from `navigateToModule('admission')` after script load.

---

## 7. Firestore Permissions Matrix

| Collection | Owner read | Staff read | Parent read | Owner write | Staff write |
|------------|------------|------------|-------------|-------------|-------------|
| `All_Madrasas/{id}` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `Registrations` | ✅ | ✅ (active link) | ✅ (linked student) | ✅ (MFA if required) | ❌ |
| `Rejected` | ✅ | ✅ | ❌ | ✅ | ❌ |
| `DashboardStats/current` | ✅ | ✅ | ❌ | ❌ (CF only) | ❌ |

---

## Root Cause Summary (regent1)

1. **Repository destroyed on module navigation** — primary regression for empty dashboard after tab switch.
2. **UI unlocks with empty repository** — silent empty state at login.
3. **Lazy module DOMContentLoaded** — admission buttons dead.
4. **Tenant race** — boot may query wrong tenant before context set.
5. **Dashboard KPIs from repo** — fails when repo empty; should use DashboardStats.

---

## regent2 Architecture Target

```
Login → Tenant Resolve → Repo Init → IDB Hydrate → Live Sync → BOOT_COMPLETE
  → Repository alive entire session
  → Dashboard KPIs ← DashboardStats/current
  → Module lists ← Repository (≤1000 active, overflow → IDB archive)
  → Student detail ← on-demand Firestore fetch
  → Logout only → destroy session
```
