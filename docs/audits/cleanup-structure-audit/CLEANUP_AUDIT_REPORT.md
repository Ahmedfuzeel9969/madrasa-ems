# Madrasa EMS — File Structure & Codebase Cleanup Audit

**Date:** 12 July 2026  
**Mode:** Read-only inventory and classification  
**Rule:** **No files deleted in this pass.** Deletion requires explicit approval of this report.  
**Scope root:** `F:\WPS\stackblitz-starters-nbktzqft (4)\stackblitz-starters-nbktzqft (4)`

**Method:**
- Full top-level + key-folder inventory
- Loader graph from `index.html`, `ems-post-auth-loader.js`, `ems-lazy-loader.js`, `cloud/ems-cloud-manifest.js`
- Root JS classification script (`scripts/_tmp-classify-root-js.js` — audit helper; candidate for removal)
- Dist / Android / Electron packaging path review
- Firebase init and sync-path grep

---

## Executive verdict

The tree is a **working multi-platform monorepo** with severe **artifact and mirror sprawl**, not a randomly broken project.

| Category | Approx. scale | Cleanup urgency |
|---|---|---|
| Active production client + cloud + SA | ~170–200 JS/HTML/CSS runtime files | Keep |
| Generated / deploy mirrors (`dist`, Android public) | ~190–200 each | Rebuild, don’t hand-edit |
| Historical Electron releases | **~2.7 GB** across 7 folders | **Highest safe win** |
| Workspace backups | 2400+ files under `backups/` | Archive / prune |
| Docs + audits | ~155 files | Keep (not shipped) |
| Tests | ~152 files | Keep |
| Dead / superseded load-path files | Small set (root `sync-engine.js`, `guest-demo.js`, …) | Medium — after approval |
| Accidental dist leaks (playwright configs, bench) | 10+ files in `dist/` | High — fix builder first |

**Do not start RB-01…RB-10 until Phase 0 of this cleanup plan is approved** (artifact prune + builder exclude list). Security fixes on a dirty tree risk patching stale Android/root duplicates.

---

## 1. Complete file inventory

### 1.1 Approximate counts (excl. `node_modules` / Gradle `build` where noted)

| Location | Files (approx.) | Role |
|---|---:|---|
| Project total (excl. node_modules/build) | ~4857 | Entire workspace |
| Root `.js` | 128 | Client source + test configs |
| `dist/` | 196 | Hosting / Electron / Cap webDir |
| `android/.../assets/public` | 188 | Capacitor web assets |
| `desktop/` (source + releases) | 396 | Electron + historical installers |
| `cloud/` | 24 | Cloud stack scripts |
| `sa/` | 17 | Super Admin UI |
| `functions/` (excl. nm) | 84 | Cloud Functions source |
| `scripts/` | 42 (+1 audit temp) | Build / DR / tooling |
| `tests/` | 152 | Unit + E2E |
| `docs/` | 155 | Human docs / audits |
| `backups/` | ~2422 | Local DR/workspace snapshots |
| `vendor/` | Firebase 9.22.0 compat bundles | CDN-local vendor |
| `bench/` | Perf harnesses | Copied into dist today |
| `.cmi/` | Code Memory Index | Dev / SA advisor tooling |
| `n)/` | Empty junk (`tests/unit` stub) | Accidental |

### 1.2 Top-level directories

| Dir | Classification | Notes |
|---|---|---|
| `android/` | Active Production (platform) | Assets currently **stale** vs dist |
| `backups/` | Generated / archive | Not runtime |
| `bench/` | Test-only (but shipped) | Should be exclude-from-hosting |
| `cloud/` | Active Production | Live sync/AI/search |
| `desktop/` | Active Production + Generated artifacts | `release*` folders are artifacts |
| `dist/` | Generated | Rebuild via `npm run build:hosting` |
| `docs/` | Active (human) / not shipped | Includes second-system audit |
| `functions/` | Active Production | Firebase backend |
| `sa/` | Active Production | Lazy-loaded Super Admin |
| `scripts/` | Active tooling | Not in hosting public |
| `tests/` | Test-only | |
| `test-results/` | Generated | Playwright output |
| `vendor/` | Active Production | Firebase SDK copies |
| `.cmi/` | Generated tooling | Regenerable |
| `.firebase/` | Generated | CLI cache |
| `.github/` | Active CI config | |
| `n)/` | Orphan / junk | Safe remove after approval |
| `node_modules/` | Generated | npm |

### 1.3 Root runtime surface (non-JS)

| File | Class |
|---|---|
| `index.html` | Active Production (shell) |
| `style.css`, `landing.css` | Active Production |
| `manifest.json` | Active Production (PWA) |
| `404.html` | Active Production |
| `service-worker.js` | Active Production (registered from `core.js`) |
| `firebase-messaging-sw.js` | Active Production (push SW) |
| `firebase.json`, `.firebaserc` | Active Production config |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json` | Active Production |
| `capacitor.config.json` | Active Production (Android) |
| `package.json` / lock | Active tooling |

---

## 2. Classification

Legend for root JS tags from loader scan: **I**=index, **P**=post-auth, **L**=lazy, **C**=cloud manifest boot, **O**=not in those four (may still be Active via SW/side channel).

### 2.1 Active Production — boot / always-on (I / C / P foundation)

Examples (not exhaustive):  
`core.js`, `auth.js`, `ems-idb-engine.js`, `ems-repository.js`, `ems-online-mode.js`, `ems-post-auth-loader.js`, `ems-lazy-loader.js`, `ems-offline-write.js`, `ems-registration-repository.js`, `ems-user-service.js`, `ems-firebase-init.js`, `security-layer.js`, `identity-gate.js`, `cloud/sync-engine.js`, `cloud/direct-firestore.js`, `service-worker.js`, `firebase-messaging-sw.js`, all `sa/*.js` (lazy), all module UIs (`admission.js`, `finance.js`, …).

### 2.2 Active Production — deferred / module (L / P deferred)

Module tabs, import stack, diagnostics, sys-* builders, AI cloud clients, complaints Firestore adapter.

### 2.3 Legacy (still loaded or still shipped)

| Item | Why Legacy | Still live? |
|---|---|---|
| Root `sync-engine.js` | Superseded by `cloud/sync-engine.js` | **Not** in live loaders; **still copied to dist/Android** |
| `EMS_SyncDB` / `EMS_DirectSyncDB` queues | Migrated into unified outbox | Code still present; migration path active |
| `guest-demo.js` | Guest portal removed from lazy MANIFEST | File + hidden HTML shell remain; not loaded on root |
| `ems-import-legacy.js` | Named legacy; still in admission lazy list | **Yes** (L) |
| Direct `localStorage` reads in dashboard/finance | Parallel SSOT vs `emsRepo` | **Yes** (behavior legacy) |
| `ems_full_users` / `ems_reg_full_v2_*` keys | Superseded by IDB mirror (Phase A/B) | Migration still reads them |

### 2.4 Duplicate

| Pair | Nature |
|---|---|
| `sync-engine.js` (root) vs `cloud/sync-engine.js` | Divergent copies; only cloud is loaded |
| `dist/**` vs root / `cloud` / `sa` | Intentional generated mirror |
| `android/.../public/**` vs `dist/**` | Intentional Cap mirror (**currently stale**) |
| Multiple Playwright configs | Parallel test harnesses (OK as Test-only) |
| User APIs: `ems-user-service` + `ems-user-access` + `emsRegRepo*` | Layered, not accidental duplicates |
| Complaints: `MadrasaERP_DB` + `EMS_ComplaintsSyncDB` | Dual stores (legacy + cloud queue) |

### 2.5 Unknown / needs human confirmation

| Item | Question |
|---|---|
| Sibling `F:\WPS\stackblitz-starters-nbktzqft\` (`encrypted.emsbak`, `tenant-export.json`) | Intentional export vault? |
| Nested zip path `stackblitz-starters-nbktzqft (4)\(4)` | Permanent workspace layout? |
| Hidden `#module-guest-demo` in `index.html` | Keep for future demo or strip? |
| Dated `desktop/release-*` folders | Any customer-delivered build that must be retained? |

### 2.6 Generated

`dist/`, Android `assets/public` (via Cap), `desktop/release*`, `backups/`, `test-results/`, `.firebase/`, `.cmi/`, `android/app/build/`, `node_modules/`.

### 2.7 Test-only

`tests/**`, `vitest.config.js`, all `playwright*.config.js`, `bench/**` (should be test-only; currently shipped), smoke HTML under `scripts/`.

---

## 3. Full dependency / load graph

```text
index.html (defer boot chain ~42 scripts)
  ├─ runtime / IDB / search / tenant / repository / online-mode
  ├─ cloud/ems-cloud-manifest.js + cloud/ems-cloud-loader.js
  ├─ ems-deferred-libs.js  → on-demand Storage / Messaging / XLSX
  ├─ core.js → registers service-worker.js
  ├─ auth.js + ems-boot-gate.js
  ├─ ems-post-auth-loader.js
  │     ├─ [if cloud] emsLoadCloudStack()
  │     │     vendor Firebase
  │     │     → boot (ems-firebase-init, security-*, identity-gate, …)
  │     │     → foundation: cloud/sync-engine.js + cloud/direct-firestore.js
  │     │     → core: backup, read-api, reg sync, dashboard-stats
  │     ├─ OFFLINE_FOUNDATION (outbox-lock, data-cache, ems-offline-write, …)
  │     ├─ OFFLINE_CORE (registration stack, user-service, …)
  │     ├─ dashboard.js
  │     └─ deferred: Storage/Messaging → cloud deferred → AI stack → OFFLINE_DEFERRED
  └─ ems-lazy-loader.js
        └─ on tab open: MANIFEST[module] + cloud lazy extras
              admission → import stack + photo/search
              complaints → cloud/complaints-firestore.js
              ai-studio → AI macro + studio UI
              superadmin → sa/* + superadmin.js

Side channels:
  cloud/ems-push-register.js → firebase-messaging-sw.js
  prepare-hosting.js → dist/**  →  Firebase Hosting
                     →  Electron packages dist/**
                     →  Cap webDir=dist → Android assets (when synced)
```

### 3.1 Cache-bust skew (structural smell)

| Surface | Current tag |
|---|---|
| `ems-post-auth-loader` / `ems-lazy-loader` | `20260712_saas_lockdown_masterpiece` |
| `cloud/ems-cloud-manifest.js` | `20260711_exams_masterpiece` (older) |
| Many `index.html` `?v=` strings | Mixed historical tags |

Hosting validator only checks post-auth ↔ lazy equality — **not** index ↔ manifest alignment.

### 3.2 Double-loaded scripts (same session)

Confirmed in both index **and** post-auth:  
`ems-storage-quota.js`, `ems-firestore-paths.js`, `ems-cloud-pull.js`.

---

## 4. Source → Dist → Android → Windows parity map

```text
Source (root + cloud + sa + vendor + bench)
        │
        ▼  npm run build:hosting  (prepare-hosting.js)
      dist/   (immutable hosting artifact)
        │
        ├── firebase deploy --only hosting  →  https://madrasa-mangment-app.web.app
        │
        ├── electron-builder (desktop:build*)  →  desktop/release/*.exe
        │         packages: dist/** + desktop/* + better-sqlite3
        │         loads: local dist via 127.0.0.1  (or remote fallback)
        │
        └── npx cap sync/copy android  →  android/app/src/main/assets/public
                  then android-asset-preflight.js
```

| Edge | Status (this audit) |
|---|---|
| Source ↔ Dist | Dist built **2026-07-11**; regenerate before any deploy |
| Dist ↔ Android | **STALE** — last sync **2026-07-08**; 46 root hash mismatches; missing OFFLINE_CORE files (`parent-shared.js`, registration-* suite, `ems-demo-sandbox.js`, `reg-dashboard.js`, …) |
| Dist ↔ Windows package | Tracks dist **if** `desktop:build*` run after hosting build; historical `release-*` folders are **not** current |
| Desktop default mode | `offlineOnly: true` — packaged app ≠ web cloud behavior |

**Parity claim is invalid until `android:sync` succeeds and only one “current” Windows artifact is retained.**

---

## 5. Unused files and dead code list

### 5.1 Strong dead load-path (not in I/P/L/C)

| File | Notes |
|---|---|
| **`sync-engine.js` (root)** | Live path uses `cloud/sync-engine.js`. Root still shipped to dist. |
| **`guest-demo.js`** | Lazy entry removed; optional `initGuestDemo` if present. Hidden HTML remains. |

### 5.2 Apparent orphans that are actually Active

| File | Why Active |
|---|---|
| `service-worker.js` | Registered by `core.js` |
| `firebase-messaging-sw.js` | Registered by push register |

### 5.3 Test-only at root (should not ship)

All `playwright*.config.js` except the one already in `EXCLUDE_ROOT`, plus `vitest.config.js` (already excluded). **Ten playwright configs currently leak into `dist/`.**

### 5.4 Dead / low-value folders

| Path | Notes |
|---|---|
| `n)/` | Accidental empty tree |
| `test-results/` | Regenerable |
| Most of `desktop/release-*` (dated) | ~2.1 GB+ historical |
| Old `backups/2026-06-*` | Archive candidates |
| `android/app/build/` | Gradle intermediates |

### 5.5 Dead code patterns (behavior, not whole files)

- Root `sync-engine` divergence (`mayAutoSyncPush` differs from cloud)
- Guest-demo HTML/CSS shell with `display:none`
- Phase A/B: full-array localStorage blob writers removed, but legacy keys still readable for migration
- Dashboard/finance direct `localStorage` paths parallel to repository

---

## 6. Duplicate implementations

| Domain | Implementations | Keep | Deprecate later |
|---|---|---|---|
| Module sync | `cloud/sync-engine.js`, `cloud/direct-firestore.js`, `ems-offline-write.js` | All three (roles differ) | Root `sync-engine.js` |
| Complaints | `complaints.js` IDB + `cloud/complaints-firestore.js` queue | Both until tenant-bound redesign | Merge queues after RB-03 |
| Users | `ems-user-service`, `ems-user-access`, `emsRegRepo*` | Layered stack | Consolidate call sites over time |
| Firebase init | `core.js` + `ems-firebase-init.js` | Both (idempotent) | Document single owner; optional unify |
| Search index | `ems-search-index*.js` + cloud enterprise search | Both | — |
| Desktop storage | IDB (web) vs SQLite (`emsNativeDb`) | Both platforms | Android SQLite parity still missing |

---

## 7. Legacy sync paths

| Path | Entry | Status |
|---|---|---|
| **Unified outbox** | `ems-offline-write.js` → `EMS_OfflineWriteDB` | **Canonical** |
| **Outbox lock** | `ems-outbox-lock.js` | Active multi-tab |
| **EmsSyncEngine** | `cloud/sync-engine.js` → `EMS_SyncDB` | Active cloud foundation; migrates into unified |
| **EmsDirect** | `cloud/direct-firestore.js` → `EMS_DirectSyncDB` | Active; key-split with SyncEngine |
| **Root sync-engine** | `sync-engine.js` | **Legacy / not loaded** |
| **Complaints queue** | `cloud/complaints-firestore.js` → `EMS_ComplaintsSyncDB` | Active specialized; **tenant-less (RB-03)** |
| **Reg draft/audit outboxes** | KV keys per tenant | Active domain queues |
| **Manual online pull** | `ems-online-mode.js` sequential delta | Active (Phase A/B) |

---

## 8. Duplicate Firebase initialization points

| Location | Line / role | Runtime? |
|---|---|---|
| **`core.js`** | `firebase.initializeApp(firebaseConfig)` when online SDK present | Yes — early boot |
| **`ems-firebase-init.js`** | Guarded init; skips if `firebase.apps.length` | Yes — cloud stack |
| `functions/index.js` | `admin.initializeApp()` | Server |
| Scripts (`seed-*`, `tenant-firestore-*`, DR, CMI, SA staging) | Admin SDK | Tooling |
| E2E emulator specs | Admin / client emulator | Test |

**Client behavior:** Idempotent double-call is intentional; offline-only skips `core.js` init.  
**Cleanup recommendation:** Keep both for now; document ownership. Optional later: single `emsInitFirebase()` only from cloud boot.

---

## 9. Orphan folders and assets

| Path | Size / notes | Runtime dep? |
|---|---|---|
| `desktop/release/` | ~566 MB current builder output | Artifact only |
| `desktop/release-20260706132542/` | ~405 MB | No |
| `desktop/release-360engine20260706/` | ~405 MB | No |
| `desktop/release-ai20260706/` | ~406 MB | No |
| `desktop/release-aiui20260707/` | ~406 MB | No |
| `desktop/release-sync20260706/` | ~405 MB | No |
| `desktop/release-build/` | ~109 MB | No |
| `backups/` (many timestamps + `dr-*`) | Large snapshot set | Scripts write; app doesn’t read at runtime |
| `n)/` | Empty junk | No |
| `test-results/` | Playwright | No |
| `bench/` inside dist/Android | Shipped accidentally | Not user-facing |
| Dist `playwright.*.config.js` (10) | Hosting leak | No |

---

## 10. Safe cleanup plan (approval required before any delete)

### Phase 0 — Zero risk to runtime source (recommended first)

1. **Archive off-disk** dated `desktop/release-*` folders; keep only the latest verified installer under `desktop/release/` (or a single `desktop/release-current/`).  
2. Delete / empty `n)/`, `test-results/`.  
3. Prune old `backups/2026-06-*` after confirming latest DR snapshot is intact.  
4. Delete regenerable `android/app/build/` intermediates (Gradle will recreate).  
5. Remove audit temp `scripts/_tmp-classify-root-js.js` after this report is filed.  
6. **Fix `prepare-hosting.js` EXCLUDE_ROOT** to block all `playwright.*.config.js` and stop copying `bench/` into dist (builder change — not “delete source”).  
7. Run `npm run build:hosting` then `npm run android:sync` to restore parity (**sync, don’t delete Android public by hand**).

### Phase 1 — Retire dead load-path files (after grep + smoke)

1. Remove root **`sync-engine.js`** after updating any unit test that prefers root path; confirm only `cloud/sync-engine.js` remains.  
2. Remove **`guest-demo.js`** and strip hidden guest-demo HTML/CSS from `index.html` if product confirms guest portal is gone.  
3. Align cache-bust tags across index / post-auth / lazy / cloud manifest.

### Phase 2 — Structural consolidation (after RB security fixes)

1. Tenant-bind complaints queue (RB-03) then consider merging complaints stores.  
2. Collapse dashboard/finance onto repository-only reads.  
3. Document / optionally unify Firebase init ownership.  
4. Deprecate legacy SyncDB/DirectSyncDB once migration telemetry shows zero legacy queue hits.

### Phase 3 — Never auto-delete

- `functions/`, `cloud/` live files, `sa/`, `vendor/`, active root modules, `firestore.rules`, `storage.rules`, current `dist` after build, current Windows installer until replaced.

---

## Deletion candidates — detailed dossier

### D1. `desktop/release-20260706132542/` (+ other dated `release-*` except one keeper)

| Field | Value |
|---|---|
| Why safe | Historical electron-builder dumps; app loads `../dist` at runtime, not these folders |
| Who imports | Nobody |
| Production refs | No |
| Android/Windows builds depend? | No — builds recreate `desktop/release/` |
| Confidence | **High** |

### D2. `desktop/release/Madrasa-EMS-Portable-regent33.exe`, `*.blockmap.pre_refactor_bak`, old electron logs

| Field | Value |
|---|---|
| Why safe | Named legacy / backup artifacts beside current Setup/Portable |
| Who imports | Nobody |
| Production refs | No |
| Platform depend? | No |
| Confidence | **High** (confirm which `.exe` is the customer-facing current build first) |

### D3. `n)/`

| Field | Value |
|---|---|
| Why safe | Accidental empty directory (`tests/unit` stub only) |
| Who imports | Nobody |
| Production refs | No |
| Platform depend? | No |
| Confidence | **High** |

### D4. `test-results/`

| Field | Value |
|---|---|
| Why safe | Playwright output; gitignored; regenerable |
| Who imports | Nobody at runtime |
| Production refs | No |
| Platform depend? | No |
| Confidence | **High** |

### D5. Old `backups/2026-06-*` (keep last 2–3 + latest `dr-*`)

| Field | Value |
|---|---|
| Why safe | Workspace snapshots; not loaded by client |
| Who imports | Backup/DR scripts write; restore is manual |
| Production refs | No runtime |
| Platform depend? | No |
| Confidence | **Medium** — verify which snapshot is last known-good restore |

### D6. Root `sync-engine.js`

| Field | Value |
|---|---|
| Why safe | Not in index/post-auth/lazy/cloud manifest; live engine is `cloud/sync-engine.js` |
| Who imports | Possibly unit tests via path preference; prepare-hosting copies it into dist |
| Production refs | **Shipped but not loaded** by cloud stack |
| Android/Windows | Copied into bundles today; removing from source + rebuild removes from platforms |
| Confidence | **Medium** — update tests + rebuild + confirm no dynamic `src="sync-engine.js"` |

### D7. `guest-demo.js` (+ optional HTML shell)

| Field | Value |
|---|---|
| Why safe | Removed from root lazy MANIFEST; guest portal removal commit already landed |
| Who imports | Soft call `initGuestDemo` if function exists; `security-layer` still names `guest-demo` modId |
| Production refs | Hidden UI in `index.html`; file ships in dist |
| Android | Stale Android lazy loader may still list guest-demo |
| Confidence | **Medium** — product confirm + strip HTML + security-layer string |

### D8. Dist/Android copies of `playwright.*.config.js` (stop shipping; keep source)

| Field | Value |
|---|---|
| Why safe | Dev configs; not executed by browser app |
| Who imports | Playwright CLI only |
| Production refs | Accidentally present in `dist/` (10 files) |
| Platform depend? | Should not; exclude in builder |
| Confidence | **High** to exclude from build; **Low** to delete source configs |

### D9. `bench/` from production dist (keep folder for local benches)

| Field | Value |
|---|---|
| Why safe | Not part of user UX |
| Who imports | Bench HTML only |
| Production refs | Copied by `prepare-hosting` today |
| Platform depend? | No functional depend |
| Confidence | **Medium** (exclude from hosting copy) |

### D10. `scripts/_tmp-classify-root-js.js`

| Field | Value |
|---|---|
| Why safe | Created only for this audit |
| Who imports | Nobody |
| Production refs | No |
| Platform depend? | No |
| Confidence | **High** |

### D11. `.cmi/` local wipe

| Field | Value |
|---|---|
| Why safe | Regenerable via `cmi:build` |
| Who imports | SA advisor tooling |
| Production refs | Not in hosting |
| Platform depend? | No |
| Confidence | **Medium** |

### Do **not** delete without redesign

- `cloud/sync-engine.js`, `cloud/direct-firestore.js`, `ems-offline-write.js`
- `cloud/complaints-firestore.js` (fix tenant binding first — RB-03)
- `ems-firebase-init.js` or `core.js` init (either alone may break offline/online modes)
- Any `sa/*`, active module JS, `vendor/**`
- Entire `docs/` or `tests/`

---

## Root JS classification table (loader tags)

Full machine list: `I`/`P`/`L`/`C`/`O` as of this audit (128 root `.js` files).  
**O that are Active via side channel:** `service-worker.js`, `firebase-messaging-sw.js`.  
**O that are Test-only:** all `playwright*.config.js`, `vitest.config.js`.  
**O that are Legacy/dead-load:** `sync-engine.js`, `guest-demo.js`.

---

## IndexedDB / storage engine map (cleanup context)

| DB | Owner | Class |
|---|---|---|
| `ems_durable_v1` | `ems-idb-engine.js` | Active SSOT |
| `ems_sync_cursors_v1` | `ems-sync-cursor-idb.js` | Active |
| `EMS_OfflineWriteDB` | `ems-offline-write.js` | Active canonical outbox |
| `EMS_SyncDB` | cloud (+ orphan root) sync-engine | Legacy + migration source |
| `EMS_DirectSyncDB` | `direct-firestore.js` | Legacy + migration source |
| `EMS_ComplaintsSyncDB` | `complaints-firestore.js` | Active specialized |
| `MadrasaERP_DB` | `complaints.js` | Active local complaints |
| Desktop SQLite | `desktop/native-db*.js` | Active Windows |

---

## Approval gate

Reply with which phases to execute, for example:

1. **Approve Phase 0 only** (artifacts + builder excludes + android sync)  
2. **Approve Phase 0 + D6/D7** (also remove root sync-engine + guest-demo)  
3. **Hold all deletes** — keep report as reference until after RB-01…RB-10  

**No deletions will be performed until you approve a specific phase list.**
