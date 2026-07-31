# Architecture — Madrasa EMS (as-built)

> Documentation of the **current** system. Claims reference real files and functions.  
> Last audited: 2026-07-17 · **No source moves in this phase.**

---

## 1. Layer overview

```
┌─────────────────────────────────────────────────────────────┐
│ UI                                                          │
│  index.html (shell + templates)                             │
│  landing.js · auth.js · ems-mobile-shell.js · module *.js   │
│  sys-layout-builder.js · ems-ui-kit.js · dashboard*.js      │
└───────────────────────────┬─────────────────────────────────┘
                            │ globals / window APIs
┌───────────────────────────▼─────────────────────────────────┐
│ Services                                                    │
│  ems-user-service.js · ems-user-access.js                   │
│  ems-registration-permissions.js · security-layer.js        │
│  ems-cloud-pull.js · ems-global-sync.js · sync-engine.js    │
│  cloud/* (when cloud stack loaded)                          │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ Repositories / storage helpers                              │
│  ems-registration-repository.js · ems-repository.js         │
│  ems-offline-write.js · ems-durable-storage.js              │
│  ems-tenant-storage.js · ems-data-cache.js                  │
│  ems-offline-module-store.js · ems-sync-cursor-idb.js       │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ IndexedDB / local persistence                               │
│  ems-idb-engine.js → DB name: ems_durable_v1                │
│  Outbox / locks: ems-outbox-lock.js · ems-storage-quota.js  │
└───────────────────────────┬─────────────────────────────────┘
                            │ online + authenticated
┌───────────────────────────▼─────────────────────────────────┐
│ Sync queue → Cloud Pull / Push                              │
│  ems-offline-write.js (queue)                               │
│  ems-cloud-mutation.js · ems-cloud-pull.js                  │
│  cloud/sync-engine.js · cloud/direct-firestore.js           │
│  ems-firestore-paths.js (All_Madrasas/{tenantId}/…)         │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ Firebase                                                    │
│  Auth · Firestore · Storage · Hosting · Functions           │
│  Client init helpers · functions/index.js → functions/lib/* │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. App startup

### 2.1 Script boot chain (`index.html` defer scripts)

Order at end of `index.html` (representative; cache-bust query strings vary):

1. `ems-runtime-mode.js` — native vs web / offline-first flags  
2. `ems-native-app-boot.js` — Capacitor/native splash & boot helpers  
3. `ems-status-bar.js` · `ems-mobile-shell.js` — mobile chrome  
4. `ems-search-index*.js` · `ems-idb-engine.js` · `ems-storage-quota.js` — local DB foundation  
5. `ems-query-utils.js` · `ems-repository.js` · `ems-online-mode.js`  
6. `cloud/ems-cloud-manifest.js` · `cloud/ems-cloud-loader.js`  
7. `ems-deferred-libs.js` · `ems-utils.js` · `ems-sync-cursor-idb.js` · `cache-policy.js`  
8. Branding / i18n / tenant: `ems-master-data.js`, `ems-ui-kit.js`, `ems-branding.js`, `ems-i18n.js`, `tenant-context.js`, `ems-tenant-storage.js`, `ems-firestore-paths.js`, `ems-cloud-pull.js`, `ems-tenant-resolver.js`, `department-context.js`  
9. `ems-sw-update.js` · **`core.js`** — shell / navigation / module switching  
10. `portal-access.js` · `landing.js` — landing / access gates  
11. `ems-offline-session-cache.js` · `ems-offline-policy.js` · `ems-native-google-auth.js`  
12. **`auth.js`** · **`ems-boot-gate.js`** · **`ems-post-auth-loader.js`** · `ems-lazy-loader.js`  
13. Offline mode helpers · `ems-global-sync.js`

Heavy feature modules are **not** all in this list; they load via `ems-post-auth-loader.js` and `ems-lazy-loader.js`.

### 2.2 Post-auth loading

`ems-post-auth-loader.js` defines ordered batches:

| Batch | Examples | Role |
|-------|----------|------|
| `OFFLINE_FOUNDATION` | `ems-outbox-lock.js`, `ems-offline-write.js`, `ems-cloud-mutation.js`, … | Must exist before offline saves |
| `OFFLINE_CORE` | registration repos, `ems-cloud-pull.js`, `ems-user-service.js`, … | Tenant data / access |
| `DASHBOARD_LAST` | `dashboard.js` | Dashboard after core |
| `AI_CLIENT_STACK` | `cloud/ems-ai-*.js` | Sequential AI client |
| `OFFLINE_DEFERRED` | `sys-*.js`, `dashboard-pro.js`, diagnostics | Lower priority |

### 2.3 Lazy module load

`ems-lazy-loader.js` → `emsLazyLoadModule(modId)` loads per-module script lists (e.g. `admission`, `attendance`, `ledger`) when a tab/module opens. Registration calls `RegistrationModule.init()` after admission scripts load.

---

## 3. Login

| Step | File / function | Notes |
|------|-----------------|-------|
| Landing UI | `landing.js`, markup in `index.html` | Shown while locked / pre-auth |
| Access / portal gate | `portal-access.js` | Includes blank-boot recovery helpers |
| Firebase / Google auth | `auth.js` (`emsRunGoogleSignIn`, etc.) | Web + native credential paths |
| Native Google | `ems-native-google-auth.js` | Capacitor SocialLogin bridge |
| Boot gate / splash | `ems-boot-gate.js` | Keeps splash until UI ready; white-screen recovery |
| Unlock shell | `auth.js` → `unlockAppScreen()` | Shows app shell; finalizes native offline-first **after** madrasa/boot ready |
| Session / MFA | `security-mfa.js`, `security-layer.js`, `identity-gate.js` | Enterprise login stack |
| Post-auth scripts | `ems-post-auth-loader.js` | Offline foundation before modules |

**Safety note (documented behavior):** premature `emsFinalizeNativeInstantBootMode()` before unlock caused white-screen / contradictory toasts; finalize belongs after successful unlock path in `unlockAppScreen()` (see `docs/POST_LOGIN_BOOT_FAILURE_REPORT.md`).

---

## 4. Tenant / madrasa resolution

| Concern | File | Role |
|---------|------|------|
| Tenant context globals | `tenant-context.js` | Current tenant identity in session |
| Resolver | `ems-tenant-resolver.js` | Resolve madrasa / tenant for user |
| Local tenant prefs | `ems-tenant-storage.js` | Client-side tenant storage helpers |
| Firestore path SSOT | `ems-firestore-paths.js` | e.g. `All_Madrasas/{tenantId}/Registrations/{docId}` |
| Department scope | `department-context.js`, `department-selector.js`, `department-migration.js` | Multi-department |

**Do not change Firebase path conventions** without a data migration plan.

---

## 5. Local database opening

| Item | Value / location |
|------|------------------|
| Engine | `ems-idb-engine.js` |
| Database name | `ems_durable_v1` (`DB_NAME`) |
| Open API | `indexedDB.open(DB_NAME, DB_VERSION)` inside engine |
| Higher-level wait | Auth / boot flows use `waitForDb()` (defined in auth/boot path; short-circuits carefully when offline-only) |
| Quota / corruption | `ems-storage-quota.js`, `ems-data-corruption.js` |
| Search index | `ems-search-index.js`, `ems-search-index-lock.js`, `ems-search-index-bg.js` |
| Sync cursors | `ems-sync-cursor-idb.js` |

**Invariant:** IndexedDB name and schema must remain stable across packaging changes.

---

## 6. Offline boot

1. `ems-runtime-mode.js` sets runtime / offline-first flags (including native).  
2. `ems-native-app-boot.js` coordinates Capacitor splash / native boot.  
3. IDB engine + search index scripts load early (before auth UI completes).  
4. `ems-offline-session-cache.js` / `ems-offline-policy.js` restore or constrain session.  
5. If previously unlocked with local data, shell can open without full cloud.  
6. `ems-post-auth-loader.js` ensures offline write stack is present before attendance/registration saves.  
7. Mobile: `ems-mobile-shell.js` builds phone chrome; desktop ribbon stays in `index.html` / `core.js` for wider viewports.

White-screen / splash: `docs/MOBILE_WHITE_SCREEN_FIX.md`, `ems-boot-gate.js`, `portal-access.js` (`emsRecoverBlankBootUi` and related).

---

## 7. Sync flow

```
UI action (save)
  → repository / module writer
  → ems-offline-write.js (durable local + outbox)
  → ems-outbox-lock.js (concurrency)
  → when online: ems-cloud-mutation.js / sync engines
  → Firestore via path helpers (ems-firestore-paths.js)
  ← ems-cloud-pull.js (inbound reconcile)
  ← ems-sync-cursor-idb.js (cursor progress)
```

Related UI: `ems-sync-failure-ui.js`, status via `ems-status-bar.js` / online mode (`ems-online-mode.js`).

Root `sync-engine.js` and `cloud/sync-engine.js` both exist — treat as **related sync surfaces**; cloud stack is gated by `cloud/ems-cloud-loader.js` + `emsIsCloudEnabled()`.

---

## 8. Cloud Pull / Push

| Direction | Primary files |
|-----------|---------------|
| Pull | `ems-cloud-pull.js`, registration live/sync under `cloud/ems-registration-*.js` |
| Push / mutations | `ems-offline-write.js`, `ems-cloud-mutation.js`, `cloud/direct-firestore.js` |
| Paths | `ems-firestore-paths.js` |
| Manifest / loader | `cloud/ems-cloud-manifest.js`, `cloud/ems-cloud-loader.js` |
| Server APIs | `functions/index.js` exports → `functions/lib/*` (RBAC, users, security, parent, payments, …) |

---

## 9. Android shell

| Piece | Location |
|-------|----------|
| Capacitor config | `capacitor.config.json` (`appId: com.madrasa.ems`, `webDir: dist`) |
| Native project | `android/` |
| Asset sync | `npm run android:sync` → `build:hosting` + `npx cap sync android` + `scripts/android-asset-preflight.js` |
| Boot / splash | `ems-native-app-boot.js`, `ems-boot-gate.js` |
| Google sign-in | `ems-native-google-auth.js` + Capacitor SocialLogin plugin config |
| Mobile UI | `ems-mobile-shell.js`, CSS in `style.css`, templates in `index.html` |

---

## 10. Electron shell

| Piece | Location |
|-------|----------|
| Main process | `desktop/main.js` |
| Preload | `desktop/preload.js` |
| Native SQLite helpers | `desktop/native-db.js`, `desktop/native-db-sqlite.js` |
| Packaged web content | `dist/**/*` (electron-builder `files` in `package.json`) |
| Dev | `npm run desktop:dev` / `desktop:dev:local` |
| Build | `npm run desktop:build` → `desktop/release/` |

---

## 11. Service worker

| File | Role |
|------|------|
| `service-worker.js` | PWA / asset caching |
| `firebase-messaging-sw.js` | FCM (if used) |
| `ems-sw-update.js` | Client update prompts / reload coordination |
| Hosting headers | `firebase.json` — `service-worker.js` and `index.html` use `no-cache, must-revalidate` |

---

## 12. Build output

| Artifact | Producer | Consumer |
|----------|----------|----------|
| `dist/` | `scripts/prepare-hosting.js` (`npm run build:hosting`) | Firebase Hosting, Capacitor `webDir`, Electron files |
| `.hosting-manifest.json` | prepare-hosting | Integrity / verify (`npm run verify:hosting`) |
| Android APK | Gradle via `android:build:*` | Device install |
| Electron portable / NSIS | `electron-builder` | Windows distribution |
| Functions | Deploy as Node source from `functions/` (no separate compile step today) | Firebase Functions |

`prepare-hosting.js` **excludes** `node_modules`, `functions`, `docs`, `scripts`, `dist`, `.git`, etc., and copies root client assets into `dist/`.

---

## 13. UI → data call patterns (examples)

| UI surface | Service / repo | Storage |
|------------|----------------|---------|
| Registration forms (`admission.js`, `registration-ui.js`) | `ems-registration-repository.js`, drafts/audit/permissions modules | IDB + Firestore paths |
| Attendance (`attendance.js`) | Offline write pipeline | IDB outbox → cloud |
| Ledger (`ledger.js`) | Module + offline/cloud | IDB + Firestore |
| Dashboard (`dashboard.js`) | Summaries / stats helpers | Local cache + optional cloud stats |
| Mobile More menu (`ems-mobile-shell.js`) | Reads live `button.reg-tab` + ribbon/`MODULE_MENUS` via layout helpers | DOM only (presentation) |

---

## 14. What this architecture deliberately does **not** change

- Firebase collection path strings  
- IndexedDB database name / schema  
- Sync queue semantics  
- Business workflows inside modules  
- Mass file moves under `src/` (planned only — see `SOURCE-MIGRATION-PLAN.md`)
