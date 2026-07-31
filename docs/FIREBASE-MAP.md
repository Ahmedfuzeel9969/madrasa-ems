# Firebase map — Madrasa EMS

> Collections, auth, storage, Cloud Functions, pull/push.  
> **Do not change path strings** without a data migration plan.  
> Audited: 2026-07-18.

---

## Project / config

| Item | Value | Source |
|------|-------|--------|
| Project ID | `madrasa-mangment-app` | `ems-firebase-init.js` → `EMS_FIREBASE_CONFIG` |
| Auth domain | `madrasa-mangment-app.firebaseapp.com` | same |
| Storage bucket | `madrasa-mangment-app.firebasestorage.app` | same |
| Init API | `emsInitFirebase()` | `ems-firebase-init.js` |
| Firestore handle | `window.EMS_FIRESTORE_DB` | set on init |
| Client SDK | Firebase **compat** 9.22.0 under `vendor/firebasejs/` | `cloud/ems-cloud-manifest.js` |
| Hosting public | `dist/` | `firebase.json` |
| Functions source | `functions/` (`main`: `index.js`) | `firebase.json` / `functions/package.json` |
| Rules | `firestore.rules`, `storage.rules` | repo root |

---

## Auth

| Concern | Detail |
|---------|--------|
| Client | `firebase.auth()` after cloud stack load |
| Persistence | `Auth.Persistence.LOCAL` (`emsInitFirebase`) |
| Web login | `auth.js` (Google / email flows) |
| Native Google | `ems-native-google-auth.js` → credential → `signInWithCredential` |
| Token refresh | `emsFirestoreEnsureAuthToken` (`ems-firestore-paths.js`) |
| Server gates | Callable functions: `checkLoginAllowed`, trusted devices, MFA, sessions, IP/country probes, etc. (`functions/lib/*`) |

Owner tenant rule (client SSOT): **owner `tenantId` === Auth `uid`** under `All_Madrasas/{tenantId}` (`ems-firestore-paths.js` header comments).

---

## Root collections (tenant model)

| Root collection | Role |
|-----------------|------|
| `All_Madrasas` | Production tenants (`ROOT` in `ems-firestore-paths.js`) |
| `Demo_Madrasas` | Demo sandbox (`DEMO_ROOT`) |

Tenant document:

```text
All_Madrasas/{tenantId}
```

`tenantId` resolution: `emsResolveFirestoreTenantId()` — owner → uid; staff/parent → linked tenant; never prefer `local_*` when Gmail session active.

---

## Tenant subcollections / documents (client SSOT + sync maps)

### Registration (path helpers)

| Path | Helper / const |
|------|----------------|
| `All_Madrasas/{tenantId}/Registrations` | `COL_REGISTRATIONS`, `emsFirestoreRegistrationsColRef` |
| `…/Rejected` | `COL_REJECTED` |
| `…/RegistrationMeta` | `COL_REGISTRATION_META` |

Probe: `emsFirestoreProbeRegistrationCount`.

### Module sync map (from `cloud/direct-firestore.js`)

Local cache keys map to Firestore collections/docs under the tenant, including (non-exhaustive):

| Local key pattern | Firestore target | Group |
|-------------------|------------------|-------|
| Registration blobs / arrays | `Registrations` (+ related) | Registration |
| Ledger array `ems_full_ledger` | `LedgerEntries` | Ledger |
| Ledger config blobs | `Ledger_Config/{docId}` (master_categories, blackouts, payroll_history, salary, funds, budgets, audit_log, settings, liabilities, employee_dues, payroll_special, archive, …) | Ledger |
| Other modules | Mapped similarly in the same file (attendance, fees, exams, …) | See `direct-firestore.js` KEY_MAP |

**Always treat `cloud/direct-firestore.js` + `ems-firestore-paths.js` as path SSOT before inventing new collections.**

### Complaints

Cloud helper: `cloud/complaints-firestore.js` (+ lazy load from manifest).

### Photos / files

| Client | Role |
|--------|------|
| `cloud/ems-photo-storage.js` | Photo upload/download via Storage |
| `cloud/photo-migration.js` | Migration helper (deferred cloud stack) |

Storage rules: `storage.rules`.

---

## Pull / push flows

### Push (local → cloud)

```text
UI save
  → repository / module writer
  → ems-offline-write.js (EMS_OfflineWriteDB queue)
  → emsCloudEmitMutation / emsOfflineFlushAll  [ems-cloud-mutation.js]
  → cloud/direct-firestore.js and/or sync-engine queues
  → Firestore under All_Madrasas/{tenantId}/…
```

Version stamp: `EmsUtils.stampCloudVersion` / local equivalent (`clientUpdatedAt`, `_version`).

### Pull (cloud → local)

```text
emsCloudPullExecute  [ems-cloud-pull.js]
  → ensure cloud stack / auth token / tenant id
  → pullRegistrations (+ broader pull when scope=all)
  → conflict policy via EmsUtils.resolvePullConflict
  → write local IDB / repos
  → emsFirestoreAlignSessionTenant when needed
  → cursors in ems_sync_cursors_v1
```

Manual sync UI bound via `emsCloudPullInitUI`.

### Sync engines

| Surface | DB | File |
|---------|-----|------|
| Offline write outbox | `EMS_OfflineWriteDB` | `ems-offline-write.js` |
| Sync engine | `EMS_SyncDB` | `sync-engine.js` / `cloud/sync-engine.js` |
| Direct queue | `EMS_DirectSyncDB` | `cloud/direct-firestore.js` |

---

## Cloud Functions (`functions/`)

**Entry:** `functions/index.js`  
**Modules:** `functions/lib/*.js` (**handwritten source** — do not rename folder yet)

### Deploy commands (existing)

```bash
npm run deploy:functions          # firebase deploy --only functions
npm run deploy:hosting            # hosting (+ preflight)
npm run deploy:firestore          # rules + indexes
npm run deploy:storage
npm run deploy:all                # preflight + full deploy
npm run deploy:login              # curated login/security function subset + hosting
```

Functions package scripts: `functions/package.json` → `deploy`, `serve` (emulators).

### Export groups (representative)

| Area | Examples (`exports.*`) | Lib module |
|------|------------------------|------------|
| RBAC | `assignRoles`, `getRbacCatalogue` | `lib/rbac.js` |
| Users | `onAuthCreate`, `setUserStatus`, `linkTenant`, … | `lib/users.js` |
| Payments | `initiatePayment`, Stripe webhook, … | `lib/payments.js` |
| Stats | `scheduledAggregate`, `refreshStats` | `lib/stats.js` |
| Security / login | `checkLoginAllowed`, lockouts, sessions, trusted devices, webhooks, … | `lib/security*.js`, `login-*.js`, `trusted-devices.js` |
| Tenant links | `activateTenantLink`, `resolveTenantLink` | `lib/tenant-links.js` |
| Parent | student data, messages, push tokens | `lib/parent-*.js` |
| MFA / staff claims | `checkMfaCompliance`, `syncStaffClaims` | `lib/mfa.js`, `staff-claims.js` |
| Access keys | verify teacher/parent keys, expiry | `lib/access-keys.js`, … |
| Notifications | delivery, retry, analytics | `lib/notification-*.js` |
| AI / SA advisor | under `lib/ai/`, `lib/sa-advisor/` | required from index as wired |
| Tenant ops | kill switch, dashboard stats, registration search, academic archive | `lib/tenant-*.js` |

Full list: read `functions/index.js` (`exports.` lines).

### Import / dependency note (pre-rename)

Before any `functions/lib` → `functions/src` rename, document and update:

1. Every `require('./lib/…')` in `functions/index.js` and nested libs  
2. `firebase.json` → `functions.source`  
3. `npm run deploy:functions` / CI  
4. `functions/test/*`  
5. No compile step today — renaming is path-only  

---

## Hosting / client delivery

| Step | Command / file |
|------|----------------|
| Build artifact | `npm run build:hosting` → `scripts/prepare-hosting.js` → `dist/` |
| Deploy | `firebase deploy --only hosting` (`public: dist`) |
| SW | `service-worker.js`, `firebase-messaging-sw.js` |

---

## Forbidden

- Rename `All_Madrasas` / `Registrations` / ledger collection names  
- Change owner===uid tenant rule casually  
- Deploy Functions from a renamed folder before import map is complete  
- Point Hosting `public` back at workspace root  

See: `docs/INDEXEDDB-MAP.md`, `docs/RUNTIME-BOOT-SEQUENCE.md`.
