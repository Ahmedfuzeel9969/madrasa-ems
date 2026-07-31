# Madrasa EMS

**Advanced Educational Management System** for madrasa / institutional administration.

Package name: `madrasa-ems` · Android / Capacitor app ID: `com.madrasa.ems` · Desktop app ID: `com.madrasa.ems.desktop`

---

## Purpose

Madrasa EMS is a multi-tenant, offline-first institutional SPA that manages registration, attendance, exams, finance/ledger, curriculum, complaints, announcements, parent access, and super-admin platform operations. It runs on **Web (Firebase Hosting)**, **Android (Capacitor)**, and **Windows Desktop (Electron)**.

---

## Supported platforms

| Platform | How it runs | Key entry |
|----------|-------------|-----------|
| Web | Static SPA → Firebase Hosting `dist/` | `index.html` |
| Android | Capacitor WebView (`webDir: dist`) | `android/` + `capacitor.config.json` |
| Electron / Windows | Electron loads built `dist/` | `desktop/main.js` |
| Cloud backend | Firebase Functions + Firestore + Storage | `functions/`, `firestore.rules` |

---

## Main modules

| Module | Primary client files |
|--------|----------------------|
| Registration | `admission.js`, `ems-registration-*.js`, `registration-ui.js` |
| Attendance | `attendance.js`, `att-dashboard.js`, `attendance-helper.js` |
| Exams | `exams.js` |
| Finance / Ledger | `finance.js`, `ledger.js`, `ems-smart-slip.js` |
| Complaints | `complaints.js`, `cloud/complaints-firestore.js` |
| Curriculum | `curriculum.js` |
| Training | `training.js` |
| Dashboard | `dashboard.js`, `dashboard-pro.js` |
| Authentication / boot | `auth.js`, `landing.js`, `portal-access.js`, `ems-boot-gate.js` |
| Sync / offline | `ems-offline-write.js`, `ems-cloud-pull.js`, `ems-global-sync.js`, `sync-engine.js`, `cloud/sync-engine.js` |
| Mobile shell | `ems-mobile-shell.js`, `ems-native-app-boot.js` |
| Settings / builders | `sys-*.js` |
| Super Admin | `sa/*`, `superadmin.js`, `admin-panel.js` |
| Parent portal | `parent-portal.js`, `parent-shared.js` |

See [docs/MODULE-INVENTORY.md](docs/MODULE-INVENTORY.md) for the full inventory.

---

## Prerequisites

- **Node.js** 18+ (Functions engine target is Node 20)
- **npm**
- **Firebase CLI** (via `firebase-tools` in devDependencies or global)
- For Android: JDK + Android SDK + Gradle (Windows: `gradlew.bat`)
- For Electron: Windows x64; native rebuild uses `better-sqlite3`

---

## Installation

```bash
cd "path/to/project-root"
npm install
cd functions && npm install && cd ..
```

Optional: Playwright browsers install via `postinstall` (`playwright install chromium`).

---

## Local development

```bash
npm start
```

Serves the workspace root with live reload (`servor --reload`). Open the URL shown in the terminal (typically `http://localhost:8080`).

---

## Production build (Hosting artifact)

```bash
npm run build
# or
npm run build:hosting
```

Copies production assets into immutable `dist/` via `scripts/prepare-hosting.js`.  
Verify: `npm run verify:hosting`.

**Do not deploy the live workspace root.** Hosting `public` is `dist` (`firebase.json`).

---

## Firebase deployment

```bash
# Hosting only (recommended safe path)
npm run deploy:hosting
# or snapshot + preflight + hosting
npm run deploy:safe

# Firestore rules/indexes
npm run deploy:firestore

# Cloud Functions
npm run deploy:functions

# Full stack (preflight + everything)
npm run deploy:all
```

Preflight: `npm run preflight` (`scripts/deploy-preflight.js`).

---

## Android build

```bash
# Sync web assets into Capacitor Android project
npm run android:sync

# Debug APK
npm run android:build:debug

# Release APK
npm run android:build:release

# Open Android Studio
npm run android:open
```

Asset preflight: `npm run preflight:android`.

---

## Electron / Windows build

```bash
# Dev (Electron + native rebuild)
npm run desktop:dev

# Dev against local hosting build
npm run desktop:dev:local

# Portable Windows build
npm run desktop:build

# NSIS installer
npm run desktop:build:installer
```

Output directory: `desktop/release/`.

---

## Test commands

```bash
# Default unit suite
npm test

# Minimum migration / regression gate (as currently wired)
npm run verify:regression

# Watch mode
npm run test:watch

# E2E (Playwright) — various configs
npm run test:e2e
npm run test:e2e:auth
npm run test:e2e:dist
```

Additional e2e configs: `test:e2e:outbox`, `test:e2e:cursor`, `test:e2e:sw`, `test:e2e:p5b`, `test:e2e:p6`, etc. (see `package.json`).

---

## Important directories

| Path | Role |
|------|------|
| `/` (root `*.js`) | Client source (legacy flat layout — ~131 JS files) |
| `index.html` | SPA shell (~6,200+ lines) |
| `cloud/` | Cloud-optional client scripts (sync, AI, Firestore helpers) |
| `sa/` | Super-admin client UI |
| `dist/` | **Generated** Hosting / Capacitor / Electron web artifact |
| `functions/` | Cloud Functions entry + `lib/` (hand-written Node source) |
| `android/` | Capacitor Android project |
| `desktop/` | Electron main/preload/native DB |
| `scripts/` | Build, backup, deploy, benchmark tooling |
| `tests/` | Vitest unit + Playwright e2e |
| `docs/` | Architecture, audits, migration plans |
| `backups/` | Local / DR snapshots (not source) |

---

## Offline architecture (summary)

1. **Local persistence:** IndexedDB database `ems_durable_v1` (`ems-idb-engine.js`).
2. **Offline writes:** Queued via `ems-offline-write.js` (+ outbox lock, durable storage, quota helpers).
3. **Cloud pull:** `ems-cloud-pull.js` + path helpers in `ems-firestore-paths.js` (tenant paths under `All_Madrasas/{tenantId}/…`).
4. **Sync:** `ems-global-sync.js`, root `sync-engine.js`, and `cloud/sync-engine.js` (loaded when cloud stack is enabled).
5. **Boot:** Native/offline-first path via `ems-runtime-mode.js` → `ems-native-app-boot.js` → auth/boot gate → `ems-post-auth-loader.js` loads offline foundation before heavy modules.
6. **Service worker:** `service-worker.js` (+ `ems-sw-update.js` for update UX).

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Data backup warning

This is a **production institutional system**. Before any structural change, relocation, or migration slice:

1. Run `npm run backup` or `npm run backup:snapshot`.
2. Prefer `npm run backup:full` / DR scripts when touching persistence or deploy pipelines.
3. **Never** rename IndexedDB names/schemas, Firebase collection paths, or sync queue semantics without an approved data-migration plan.
4. Keep `dist/` rebuildable from source; do not treat `dist/` as the only copy of truth.

See also: `docs/PRE-REFACTOR-BACKUP-CHECKLIST.md`, `docs/DISASTER-RECOVERY-PROCEDURE.md`.

---

## Current project status

| Aspect | Status |
|--------|--------|
| Production builds / Hosting | Operational |
| Android / Capacitor | Operational |
| Electron packaging | Operational |
| Offline / online + sync | Operational (institutionally used) |
| Regression / CI scripts | Present |
| Source layout | **Legacy flat root** — no `src/`; large `index.html` |
| Nested folder name | `stackblitz-starters-nbktzqft (4)\…` — rename planned only |
| Source migration to `src/` | **Documentation only** — not started |

Planning docs:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/FOLDER-MAP.md](docs/FOLDER-MAP.md)
- [docs/MODULE-INVENTORY.md](docs/MODULE-INVENTORY.md)
- [docs/DEPENDENCY-MAP.md](docs/DEPENDENCY-MAP.md)
- [docs/SOURCE-MIGRATION-PLAN.md](docs/SOURCE-MIGRATION-PLAN.md)
- [docs/RUNTIME-BOOT-SEQUENCE.md](docs/RUNTIME-BOOT-SEQUENCE.md)
- [docs/INDEXEDDB-MAP.md](docs/INDEXEDDB-MAP.md)
- [docs/FIREBASE-MAP.md](docs/FIREBASE-MAP.md)
- [docs/GLOBALS-MAP.md](docs/GLOBALS-MAP.md)

**Migration Slice #1** (`ems-utils.js` → `src/shared/utils/` + root wrapper): see [docs/MIGRATION-SLICE-01.md](docs/MIGRATION-SLICE-01.md).
