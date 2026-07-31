# Folder map — Madrasa EMS

> Classification of directories and root assets.  
> Legend: **source** · **generated** · **build output** · **configuration** · **test** · **script** · **documentation** · **legacy** · **duplicate** · **unused** · **unknown**  
> Audited: 2026-07-17 · **Documentation only — no moves.**

---

## 1. Top-level directories

| Path | Classification | Notes |
|------|----------------|-------|
| `*.js` at project root (~131) | **source** (+ some **configuration** / **test** config) | Legacy flat layout; primary client code |
| `index.html` | **source** | ~6,283 lines / ~561 KB — SPA shell + templates |
| `style.css` / other root CSS/assets | **source** | Global styles / static assets |
| `cloud/` | **source** | Optional cloud client stack (sync, AI, Firestore helpers) |
| `sa/` | **source** | Super-admin client modules |
| `vendor/` | **source** / third-party | Vendored front-end libs if present |
| `dist/` | **build output** / **generated** | Immutable Hosting artifact from `scripts/prepare-hosting.js` |
| `functions/` | **source** (Node) | Cloud Functions; `main: index.js` |
| `functions/lib/` | **source** (misnamed “lib”) | Hand-written CommonJS modules — **not** a TypeScript compile output |
| `functions/node_modules/` | **generated** | Functions dependencies |
| `functions/test/` | **test** | Functions tests |
| `android/` | **source** + **generated** build trees | Capacitor Android; `app/build/` is build output |
| `desktop/` | **source** | Electron main/preload/native DB |
| `desktop/release/` | **build output** | electron-builder output |
| `scripts/` | **script** | Hosting, backup, deploy, benchmarks |
| `tests/` | **test** | Vitest + Playwright specs |
| `docs/` | **documentation** | Architecture, audits, phase reports |
| `backups/` | **generated** / operational | Snapshots & DR — not app source |
| `node_modules/` | **generated** | Root npm deps |
| `.firebase/` | **generated** | Firebase CLI cache |
| `.github/` | **configuration** | CI workflows |
| `.cmi/` | **unknown** / tooling | CMI-related local state |
| `bench/` | **test** / tooling | Benchmark helpers |
| `n/` | **unknown** / **legacy** | Inspect before any delete |
| `test-results/` | **generated** | Playwright/report output |

---

## 2. Nested project path (normalization target)

**Current live path (do not rename yet):**

```text
F:\WPS\stackblitz-starters-nbktzqft (4)\stackblitz-starters-nbktzqft (4)
```

**Proposed future folder name:** `madrasa-ems` (see Phase 2 in `SOURCE-MIGRATION-PLAN.md`).

Classification of outer wrapper: **legacy** packaging leftover from StackBlitz export. Absolute paths appear in generated manifests (`dist/.hosting-manifest.json`, Android assets, backups) — regenerated after relocate.

---

## 3. `functions/lib` clarity

| Question | Finding |
|----------|---------|
| Is it compiled output? | **No.** `functions/package.json` has no `build`/`tsc` step; `main` is `index.js`. |
| Is it source? | **Yes.** `functions/index.js` does `require('./lib/…')` for RBAC, users, security, parent, payments, etc. |
| Mixed? | Only in the sense that the **folder name** suggests output; content is source. |
| Proposed rename (later) | Prefer `functions/src/` + keep deploy root, **or** keep `lib/` but document as source; optional future `functions/dist/` only if a compile step is introduced. |

**Do not rename until** all `require('./lib/…')`, Firebase `functions.source`, and function tests are remapped and verified.

---

## 4. Root JavaScript inventory

Approx sizes in KB. **Runtime entry** = how the browser loads it. **Safe to move** = first-pass judgment for future `src/` migration (still requires wrappers + tests).

### 4.1 Early boot / shell (loaded from `index.html` defer)

| File | ~KB | Purpose | Runtime entry | Proposed folder | Safe to move? |
|------|-----|---------|---------------|-----------------|---------------|
| `ems-runtime-mode.js` | 3 | Native/web/offline mode flags | `index.html` | `src/app/boot/` | **No** (boot-critical) |
| `ems-native-app-boot.js` | 6 | Capacitor splash/boot | `index.html` | `src/platform/android/` | **No** |
| `ems-status-bar.js` | 3 | Status chrome | `index.html` | `src/app/shell/` | Low–medium |
| `ems-mobile-shell.js` | 28 | Phone MS Word–style nav | `index.html` | `src/app/navigation/` | **No** (DOM + globals) |
| `ems-search-index.js` | 4 | Search index API | `index.html` | `src/core/database/` | **No** |
| `ems-idb-engine.js` | 61 | IndexedDB `ems_durable_v1` | `index.html` | `src/core/database/` | **No** |
| `ems-search-index-lock.js` | 9 | Index lock | `index.html` | `src/core/database/` | **No** |
| `ems-storage-quota.js` | 16 | Quota helpers | `index.html` / post-auth | `src/core/database/` | **No** |
| `ems-search-index-bg.js` | 7 | Background index | `index.html` | `src/core/database/` | **No** |
| `ems-query-utils.js` | 10 | Query helpers | `index.html` | `src/shared/utils/` | **Candidate** (verify side effects) |
| `ems-repository.js` | 11 | Generic repo helpers | `index.html` | `src/core/database/` | Medium |
| `ems-online-mode.js` | 18 | Online/offline UX state | `index.html` | `src/core/sync/` | **No** |
| `ems-deferred-libs.js` | 3 | Deferred third-party loads | `index.html` | `src/app/boot/` | Medium |
| `ems-utils.js` | 5 | Shared utils | `index.html` | `src/shared/utils/` | **Yes (preferred first slice)** |
| `ems-sync-cursor-idb.js` | 10 | Sync cursors in IDB | `index.html` | `src/core/sync/` | **No** |
| `cache-policy.js` | 9 | Cache policy | `index.html` | `src/core/firebase/` | Medium |
| `ems-master-data.js` | 7 | Master data helpers | `index.html` | `src/shared/constants/` | Medium |
| `ems-ui-kit.js` | 11 | Shared UI helpers | `index.html` | `src/shared/ui/` | **Candidate** |
| `ems-branding.js` | 10 | Branding | `index.html` | `src/shared/ui/` | Medium |
| `ems-i18n.js` | 12 | i18n | `index.html` | `src/shared/utils/` | Medium |
| `ems-module-perf.js` | 9 | Perf hooks | `index.html` | `src/shared/utils/` | Medium |
| `ems-demo-sandbox.js` | 6 | Demo/sandbox | `index.html` | `src/shared/` | Medium / possibly unused paths |
| `tenant-context.js` | 6 | Tenant globals | `index.html` | `src/core/security/` | **No** |
| `ems-tenant-storage.js` | 8 | Tenant local storage | `index.html` | `src/core/database/` | **No** |
| `ems-firestore-paths.js` | 14 | Firestore path SSOT | `index.html` | `src/core/firebase/` | **No** |
| `ems-cloud-pull.js` | 25 | Cloud pull | `index.html` + post-auth | `src/core/sync/` | **No** |
| `ems-tenant-resolver.js` | 5 | Resolve tenant | `index.html` | `src/app/auth/` | **No** |
| `department-context.js` | 12 | Department scope | `index.html` | `src/core/security/` | **No** |
| `ems-sw-update.js` | 7 | SW update UX | `index.html` | `src/platform/web/` | Medium |
| `core.js` | 33 | App shell / nav / modules | `index.html` | `src/app/shell/` | **No** |
| `portal-access.js` | 13 | Access / blank recovery | `index.html` | `src/app/auth/` | **No** |
| `landing.js` | 30 | Landing / login UI logic | `index.html` | `src/app/auth/` | **No** |
| `ems-offline-session-cache.js` | 7 | Offline session | `index.html` | `src/core/security/` | **No** |
| `ems-offline-policy.js` | 11 | Offline policy | `index.html` | `src/core/sync/` | **No** |
| `ems-native-google-auth.js` | 17 | Native Google bridge | `index.html` | `src/platform/android/` | **No** |
| `auth.js` | 145 | Auth, unlock, Google | `index.html` | `src/app/auth/` | **No** |
| `ems-boot-gate.js` | 7 | Splash / boot gate | `index.html` | `src/app/boot/` | **No** |
| `ems-post-auth-loader.js` | 9 | Dynamic script batches | `index.html` | `src/app/boot/` | **No** |
| `ems-lazy-loader.js` | 5 | Per-module lazy scripts | `index.html` | `src/app/boot/` | **No** |
| `ems-offline-mode.js` | 3 | Offline mode flag helpers | `index.html` | `src/core/sync/` | **No** |
| `ems-offline-config.js` | 5 | Offline config | `index.html` | `src/core/sync/` | Medium |
| `ems-device-identity.js` | 2 | Device identity | `index.html` | `src/core/security/` | Medium |
| `ems-global-sync.js` | 9 | Global sync orchestration | `index.html` | `src/core/sync/` | **No** |

Importer pattern for these: primarily **script tags** and dynamic `<script>` injection (not ES module `import`). Coupling is via **`window` globals**.

### 4.2 Post-auth / offline foundation (via `ems-post-auth-loader.js`)

| File | ~KB | Purpose | Proposed folder | Safe to move? |
|------|-----|---------|-----------------|---------------|
| `ems-outbox-lock.js` | 5 | Outbox lock | `src/core/sync/` | **No** |
| `ems-data-corruption.js` | 6 | Corruption detection | `src/core/database/` | **No** |
| `ems-data-cache.js` | 8 | Data cache | `src/core/database/` | Medium |
| `ems-durable-storage.js` | 8 | Durable storage helpers | `src/core/database/` | **No** |
| `ems-data-pipeline-debug.js` | 3 | Debug | `src/shared/utils/` | **Candidate** |
| `ems-offline-write.js` | 58 | Offline write / queue | `src/core/sync/` | **No** |
| `ems-cloud-mutation.js` | 14 | Cloud mutations | `src/core/sync/` | **No** |
| `ems-sync-failure-ui.js` | 13 | Sync failure UI | `src/shared/ui/` | Medium |
| `parent-shared.js` | 9 | Shared parent helpers | `src/modules/` / shared | Medium |
| `ems-registration-repository.js` | 108 | Registration repo | `src/modules/registration/` | **No** |
| `ems-registration-duplicates.js` | 9 | Duplicate detection | `src/modules/registration/` | Medium |
| `ems-registration-audit.js` | 18 | Audit trail | `src/modules/registration/` | Medium |
| `ems-registration-permissions.js` | 13 | RBAC for reg | `src/modules/registration/` | **No** |
| `ems-registration-drafts.js` | 40 | Drafts | `src/modules/registration/` | Medium |
| `ems-user-service.js` | 16 | User service | `src/app/auth/` | **No** |
| `ems-registration-bootstrap.js` | 26 | Reg bootstrap | `src/modules/registration/` | **No** |
| `ems-user-access.js` | 16 | Access checks | `src/core/security/` | **No** |
| `ems-offline-module-store.js` | 3 | Module store | `src/core/database/` | Medium |
| `dashboard.js` | 81 | Main dashboard | `src/modules/dashboard/` | **No** (late in phase) |
| `sys-*.js` | 17–37 | Settings / builders | `src/modules/` settings | Medium–late |
| `dashboard-pro.js` | 89 | Pro dashboard | `src/modules/dashboard/` | Late |
| `ems-audit.js` | 2 | Audit helper | `src/core/security/` | Medium |
| Diagnostics / virtual table / summaries / perf | various | Ops UI | `src/shared/` | Medium |

### 4.3 Lazy-loaded feature modules (`ems-lazy-loader.js`)

| File | ~KB | Purpose | Proposed folder | Safe to move? |
|------|-----|---------|-----------------|---------------|
| `admission.js` | 113 | Registration UI/workflows | `src/modules/registration/` | **No** (early phases) |
| `reg-dashboard.js` | 14 | Reg dashboard | `src/modules/registration/` | Medium |
| `ems-registration-mobile.js` | 7 | Mobile registration | `src/modules/registration/` | Medium |
| `registration-ui.js` | 13 | Reg UI helpers | `src/modules/registration/` | Medium |
| `ems-idcard.js` | 18 | ID cards / print | `src/modules/registration/` | Medium |
| `ems-import-*.js` | 4–43 | Import/export suite | `src/modules/registration/` | Medium |
| `attendance.js` | 147 | Attendance | `src/modules/attendance/` | **No** early |
| `att-dashboard.js` | 54 | Attendance dashboard | `src/modules/attendance/` | Medium |
| `attendance-helper.js` | 23 | Helpers | `src/modules/attendance/` | Medium |
| `exams.js` | 82 | Exams | `src/modules/exams/` | Late |
| `curriculum.js` | 74 | Curriculum | `src/modules/curriculum/` | Late |
| `training.js` | 58 | Training | `src/modules/` (training) | Late |
| `finance.js` | 85 | Finance | `src/modules/finance/` | **No** early |
| `ems-smart-slip.js` | 12 | Slips | `src/modules/finance/` | Medium |
| `ledger.js` | 169 | Ledger (largest) | `src/modules/finance/` | **No** early |
| `announcements.js` | 78 | Announcements | `src/modules/` | Late |
| `complaints.js` | 70 | Complaints | `src/modules/complaints/` | Late |
| `admin-panel.js` | 158 | Admin panel | `src/modules/` / admin | Late |
| `access-keys.js` | 12 | Access keys UI | `src/core/security/` | Late |
| `parent-portal.js` | 38 | Parent portal | `src/modules/` | Late |
| `superadmin.js` | 16 | SA entry | `src/modules/` / sa | Late |

### 4.4 Security / identity / tenant extras

| File | ~KB | Purpose | Safe to move? |
|------|-----|---------|---------------|
| `identity-gate.js` | 35 | Identity gate | **No** early |
| `security-layer.js` | 21 | Security layer | **No** |
| `security-mfa.js` | 22 | MFA | **No** |
| `tenant-security.js` | 11 | Tenant security | **No** |
| `tenant-sso.js` | 9 | SSO | Late |
| `tenant-delivery.js` | 3 | Delivery | Medium |
| `ems-session-registry.js` | 3 | Sessions | Medium |
| `ems-trusted-device.js` | 2 | Trusted device | Medium |
| `ems-firebase-init.js` | 3 | Firebase init helper | **No** |
| `guest-demo.js` | 12 | Guest demo | Possibly **legacy**/low traffic — verify before delete |

### 4.5 Sync / service workers / config-as-JS

| File | Classification | Notes |
|------|----------------|-------|
| `sync-engine.js` (~34 KB) | **source** | Root sync; related to `cloud/sync-engine.js` — treat carefully (**duplicate-ish surfaces**) |
| `service-worker.js` | **source** | SW |
| `firebase-messaging-sw.js` | **source** | Messaging SW |
| `playwright*.config.js`, `vitest.config.js` | **configuration** / **test** | Stay at root or `tests/` later |

### 4.6 Importers (how “importing files” works today)

This codebase is largely **non-module script globals**, not ES `import` graphs.

| Mechanism | Files |
|-----------|--------|
| Static `<script defer>` | Boot chain in `index.html` |
| Dynamic load lists | `ems-post-auth-loader.js`, `ems-lazy-loader.js`, `cloud/ems-cloud-loader.js` |
| Node `require` | `functions/index.js` → `functions/lib/*`; Electron `desktop/*`; `scripts/*` |
| Electron packaging list | `package.json` → `build.files` includes selected root JS + `dist/**` |

For any future move: update **all three** of HTML tags, dynamic loader manifests, and Electron `files` (where applicable).

---

## 5. `cloud/` map (summary)

| Classification | Files (examples) |
|----------------|------------------|
| **source** — sync / Firestore | `sync-engine.js`, `direct-firestore.js`, `ems-registration-sync.js`, `ems-registration-live-sync.js`, `complaints-firestore.js`, `backup-service.js` |
| **source** — AI client | `ems-ai-*.js` |
| **source** — loader | `ems-cloud-manifest.js`, `ems-cloud-loader.js` |
| **source** — other | `ems-photo-storage.js`, `photo-migration.js`, `ems-push-register.js`, `ems-academic-archive.js`, `ems-dashboard-stats.js`, `ems-enterprise-search.js`, `ems-firebase-read-api.js` |

Proposed future: `src/core/firebase/` + `src/core/sync/` + AI under shared/cloud.

---

## 6. Duplicates / unknowns (watch list)

| Item | Classification | Action |
|------|----------------|--------|
| `sync-engine.js` (root) vs `cloud/sync-engine.js` | **duplicate** surfaces | Map call sites before consolidating |
| Nested StackBlitz folder name | **legacy** | Relocate plan only |
| `n/` directory | **unknown** | Inventory before delete |
| `guest-demo.js` | **unknown** / possible **legacy** | Confirm usage |
| `functions/lib` name | naming **legacy** | Clarify / rename later |
| `dist/` copy of root JS | **generated** | Never edit as source of truth |

---

## 7. Counts (approximate)

| Category | Count |
|----------|-------|
| Root `*.js` | **131** |
| Of which Playwright/Vitest configs | ~12 |
| Client feature/boot JS (rest) | ~119 |
| `index.html` lines | ~6,283 |
| `functions/lib` modules | ~50+ files (+ `ai/`, `sa-advisor/`) |
