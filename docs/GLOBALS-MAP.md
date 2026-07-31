# Globals map — Madrasa EMS

> The runtime is a **script-tag + `window` / `globalThis` global** architecture.  
> Moving files without preserving these names breaks the app.  
> Audited: 2026-07-18.

---

## Summary

| Metric | Value |
|--------|-------|
| Unique `window.` / `global.` / `globalThis.` **assignment** names (auto-scan) | **2139** |
| `JamiaApp.*` | **0** (not used in current client tree) |
| Full inventory | [`docs/GLOBALS-INVENTORY-RAW.md`](./GLOBALS-INVENTORY-RAW.md) |

Regenerate raw inventory:

```bash
node scripts/_tmp-scan-globals.js . docs/GLOBALS-INVENTORY-RAW.md
```

(Do not delete the inventory without regenerating.)

---

## Why globals are the migration risk

1. There is **no ES module import graph** for most UI.  
2. Loaders (`index.html`, `ems-post-auth-loader.js`, `ems-lazy-loader.js`) only ensure **script order**.  
3. Call sites use `typeof window.foo === 'function' && window.foo()`.  
4. Renaming a global or loading a file too late → silent no-ops or blank UI.

**Rule:** Compatibility wrappers must re-attach the **same** global names.

---

## Critical boot / auth / tenant globals

| Global | Typical writers | Role |
|--------|-----------------|------|
| `EMS_OFFLINE_ONLY` | runtime / auth / native boot | Offline-only mode — **timing sensitive** |
| `EMS_PENDING_NATIVE_GOOGLE_SUCCESS` | auth / native Google | Post native login; affects `waitForDb` |
| `EMS_FIREBASE_CONFIG` / `EMS_FIRESTORE_DB` | `ems-firebase-init.js` | Firebase config + db handle |
| `EMS_ENTERPRISE_BOOT_ENABLED` | `ems-boot-gate.js` | Boot gate switch |
| `EMS_POST_LOGIN_DIAG` | `auth.js` | Post-login diagnostics |
| `CURRENT_MADRASA_TENANT_ID` | auth, paths, session | Active tenant |
| `EMS_ACTIVE_TENANT_ID` | paths / tenant | Active tenant alias |
| `CURRENT_USER_TENANT_ROLE` | auth / identity | owner / staff / parent / … |
| `CURRENT_MADRASA_DATA` | auth / session | Tenant profile cache |
| `CURRENT_STAFF_LINK` / `CURRENT_PARENT_LINK` | auth / tenant-context | Linked identities |
| `firebase` | vendor compat | Firebase namespace |
| `waitForDb` | `auth.js` | Wait for Firestore |
| `unlockAppScreen` | `auth.js` (function; may be global or local — call path is auth) | Unlock shell |
| `showTopAlert` / `showToast` | auth / UI | Toasts |
| `emsInitFirebase` / `emsIsFirebaseReady` | `ems-firebase-init.js` | Init |
| `emsLoadCloudStack` | `cloud/ems-cloud-loader.js` | Load cloud scripts |
| `EmsCloudManifest` | `cloud/ems-cloud-manifest.js` | Cloud script lists |
| `emsEnsureLoginShellVisible` / `emsRecoverBlankBootUi` | `ems-boot-gate.js` | Anti white-screen |
| `emsIdbReady` / `emsIdbKv*` | `ems-idb-engine.js` | Durable DB |
| `EmsUtils` | `ems-utils.js` | Shared pure utils (**Slice #1**) |
| `printDiv` | `ems-utils.js` | Global print helper |

---

## Critical data / sync globals

| Global | Role |
|--------|------|
| `emsResolveFirestoreTenantId` / `emsFirestore*Ref` | Path SSOT |
| `emsCloudPullExecute` / `emsCloudPullGetStatus` | Cloud pull |
| `emsCloudEmitMutation` / `emsCloudFlushPendingMutations` | Push bridge |
| `emsOfflineFlushAll` / offline write APIs | Outbox |
| `emsRegRepoInit` / `emsRegRepoGetList` / Registration repo APIs | Registration SSOT |
| `RegistrationModule` | Lazy registration entry |
| `emsLazyLoadModule` | Module script loader |
| `emsEnsurePostAuthScripts` | Post-auth batches |
| `getDbOrNull` | Firestore accessor used by `waitForDb` |

---

## Namespace-style objects (`Ems*`, `Sa*`, …)

| Global | File area |
|--------|-----------|
| `EmsUtils` | utils |
| `EmsCloudManifest` | cloud manifest |
| `EmsBranding` / `EmsI18n` / `EmsMasterData` / `EmsCachePolicy` | shared |
| `EmsBackupService` / `EmsDirect` / `EmsImportExport` / … | cloud / import |
| `SaCore`, `SaNav`, `SaUi`, `SaTenants`, … | `sa/*` |
| `CmpCloud` / `CmpIDB` | complaints |
| `RBAC` / `PLATFORM_*` | admin / SA |

Full list: raw inventory.

---

## `JamiaApp.*`

**Not present** in the scanned client/source tree (0 matches).  
If legacy docs mention `JamiaApp`, treat as obsolete naming — do not introduce during migration.

---

## Migration checklist for any moved file

1. List every `global.X =` / `window.X =` in that file (see raw inventory).  
2. Ensure wrapper or new path still assigns **identical** names.  
3. Keep `index.html` / loader URL working (compat wrapper at old path).  
4. Run `npm run verify:regression` + hosting build.  
5. Smoke: login, offline boot, registration, attendance, sync queue.

---

## Slice #1 note (`ems-utils.js`)

Preserved globals after move:

- `globalThis.EmsUtils` (and `module.exports` for Vitest/Node)
- `printDiv` (idempotent install)

Do not rename `EmsUtils` methods (`sanitize`, `escAttr`, `saEmailDocKey`, `resolvePullConflict`, `simpleHash`, `stampCloudVersion`) — call sites depend on them (e.g. `ems-offline-write.js` → `EmsUtils.stampCloudVersion`).
