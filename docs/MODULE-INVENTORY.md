# Module inventory — Madrasa EMS

> Every major product module mapped to real files.  
> Status: **production / active** unless noted.  
> Audited: 2026-07-17 · **No source migration executed.**

---

## How modules enter the runtime

| Path | Mechanism |
|------|-----------|
| Always (boot) | `index.html` defer scripts → `core.js`, `auth.js`, … |
| After auth | `ems-post-auth-loader.js` batches |
| On tab open | `ems-lazy-loader.js` → `emsLazyLoadModule(modId)` |
| Cloud extras | `cloud/ems-cloud-loader.js` / `emsCloudLazyScripts(modId)` when cloud enabled |

---

## 1. Registration

| Field | Detail |
|-------|--------|
| **Files** | `admission.js`, `reg-dashboard.js`, `registration-ui.js`, `ems-registration-mobile.js`, `ems-registration-repository.js`, `ems-registration-drafts.js`, `ems-registration-duplicates.js`, `ems-registration-audit.js`, `ems-registration-permissions.js`, `ems-registration-bootstrap.js`, `ems-idcard.js`, `ems-import-export.js`, `ems-import-legacy.js`, `ems-import-smart.js`, `ems-import-templates.js`, `ems-import-merge.js`, `ems-import-wizard.js`, `ems-import-queue.js`; cloud: `cloud/ems-registration-sync.js`, `cloud/ems-registration-live-sync.js` |
| **Status** | Active — heavily used; extensive docs under `docs/REGISTRATION_*` |
| **Entry** | Lazy `admission` → `RegistrationModule.init()` in `ems-lazy-loader.js` |
| **Dependencies** | IDB engine, offline write, user access/permissions, firestore paths, cloud pull |
| **Local stores** | IDB via registration repository / drafts / durable offline write |
| **Firebase paths** | Via `ems-firestore-paths.js` (e.g. `All_Madrasas/{tenantId}/Registrations/…`) |
| **Tests** | e.g. `tests/unit/ems-registration-mobile-s6.test.js`; many registration e2e/docs |
| **Stubs / dummy** | Import “smart” paths and demo sandbox may include partial/demo modes — verify before trusting as full production features |
| **Future `src/`** | `src/modules/registration/` |

---

## 2. Attendance

| Field | Detail |
|-------|--------|
| **Files** | `attendance.js`, `att-dashboard.js`, `attendance-helper.js` |
| **Status** | Active |
| **Entry** | Lazy `attendance` |
| **Dependencies** | Offline foundation (`ems-offline-write.js` must load first — noted in post-auth loader comments), IDB, sync |
| **Local stores** | IDB + outbox |
| **Firebase paths** | Tenant attendance collections via path helpers / sync |
| **Tests** | Unit/e2e under `tests/` (search `attendance`) |
| **Stubs** | None flagged as primary stubs |
| **Future `src/`** | `src/modules/attendance/` |

---

## 3. Exams

| Field | Detail |
|-------|--------|
| **Files** | `exams.js`; server summaries may involve `functions/lib/tenant-exam-curriculum-summaries.js` |
| **Status** | Active |
| **Entry** | Lazy `exams` |
| **Dependencies** | Core shell, offline/cloud when enabled |
| **Local stores** | IDB via module writers |
| **Firebase paths** | Tenant exam paths (via sync/path helpers) |
| **Tests** | Present under `tests/` where tagged exams |
| **Stubs** | Unknown partial UI states — inventory before move |
| **Future `src/`** | `src/modules/exams/` |

---

## 4. Finance / Ledger

| Field | Detail |
|-------|--------|
| **Files** | `finance.js`, `ledger.js` (~169 KB largest root module), `ems-smart-slip.js` |
| **Status** | Active — high risk / high coupling |
| **Entry** | Lazy `finance`, `ledger` |
| **Dependencies** | Offline write, sync, printing helpers, permissions |
| **Local stores** | IDB + outbox |
| **Firebase paths** | Tenant finance/ledger collections |
| **Tests** | Under `tests/` (finance/ledger keywords) |
| **Stubs** | Slip / print paths may depend on browser print APIs |
| **Future `src/`** | `src/modules/finance/` (keep ledger + finance together initially) |

---

## 5. Complaints

| Field | Detail |
|-------|--------|
| **Files** | `complaints.js`, `cloud/complaints-firestore.js` |
| **Status** | Active |
| **Entry** | Lazy `complaints` |
| **Dependencies** | Cloud loader when online; local module store |
| **Local stores** | IDB / offline module store |
| **Firebase paths** | Complaints Firestore helpers in cloud module |
| **Tests** | As available in `tests/` |
| **Stubs** | None primary |
| **Future `src/`** | `src/modules/complaints/` |

---

## 6. Curriculum

| Field | Detail |
|-------|--------|
| **Files** | `curriculum.js`; related CF `tenant-exam-curriculum-summaries.js` |
| **Status** | Active |
| **Entry** | Lazy `curriculum` |
| **Dependencies** | Core, optional cloud |
| **Local stores** | IDB |
| **Firebase paths** | Tenant curriculum |
| **Tests** | As available |
| **Stubs** | Unknown |
| **Future `src/`** | `src/modules/curriculum/` |

---

## 7. Training

| Field | Detail |
|-------|--------|
| **Files** | `training.js` |
| **Status** | Active (module present in lazy manifest) |
| **Entry** | Lazy `training` |
| **Dependencies** | Core shell |
| **Local stores** | IDB |
| **Firebase paths** | Tenant training (via sync) |
| **Future `src/`** | `src/modules/training/` |

---

## 8. Announcements

| Field | Detail |
|-------|--------|
| **Files** | `announcements.js` |
| **Status** | Active |
| **Entry** | Lazy `announcements` |
| **Future `src/`** | `src/modules/announcements/` |

---

## 9. Dashboard

| Field | Detail |
|-------|--------|
| **Files** | `dashboard.js` (post-auth), `dashboard-pro.js` (deferred), `ems-module-summaries.js`; cloud `ems-dashboard-stats.js`; CF `tenant-dashboard-stats.js` |
| **Status** | Active |
| **Entry** | Post-auth `DASHBOARD_LAST`; pro via deferred batch |
| **Dependencies** | User access, local cache, optional cloud stats |
| **Local stores** | Cache / IDB summaries |
| **Firebase paths** | Stats aggregates via Functions/cloud |
| **Future `src/`** | `src/modules/dashboard/` |

---

## 10. Authentication / access

| Field | Detail |
|-------|--------|
| **Files** | `auth.js`, `landing.js`, `portal-access.js`, `ems-boot-gate.js`, `ems-native-google-auth.js`, `ems-offline-session-cache.js`, `ems-tenant-resolver.js`, `identity-gate.js`, `security-layer.js`, `security-mfa.js`, `ems-user-service.js`, `ems-user-access.js`, `ems-trusted-device.js`, `ems-session-registry.js`, `tenant-sso.js`, `tenant-security.js` |
| **Status** | Active — **do not migrate early** |
| **Entry** | `index.html` defer chain |
| **Dependencies** | Firebase Auth, Capacitor SocialLogin (native), IDB wait, tenant resolve |
| **Local stores** | Session cache, trusted device, IDB |
| **Firebase paths** | Auth + security-related callable Functions (`functions/lib/security*.js`, login session modules, etc.) |
| **Tests** | `tests/e2e/login-auth.spec.js`, emulator auth specs; docs `ENTERPRISE-LOGIN-PHASE*` |
| **Known issues (documented)** | Post-login boot / white screen fixes — see `POST_LOGIN_BOOT_FAILURE_REPORT.md`, `MOBILE_WHITE_SCREEN_FIX.md` |
| **Future `src/`** | `src/app/auth/`, `src/app/boot/` |

---

## 11. Backup / restore

| Field | Detail |
|-------|--------|
| **Files (client)** | `cloud/backup-service.js`; durable/export helpers in offline/import suites |
| **Files (tooling)** | `scripts/backup-workspace.js`, `backup-production.js`, `disaster-recovery-backup.js`, `disaster-recovery-restore.js`, `tenant-firestore-export.js`, `dr-production-verification.js` |
| **Status** | Operational scripts + cloud backup service |
| **Entry** | npm scripts (`backup`, `backup:full`, …) |
| **Dependencies** | Workspace FS, optional cloud |
| **Local stores** | `backups/` directory; encrypted `.emsbak` in DR flows |
| **Firebase paths** | Export tooling — do not confuse with runtime IDB name |
| **Tests** | `tests/unit/ems-disaster-recovery.test.js` |
| **Future `src/`** | Client pieces → `src/core/backup/`; keep scripts in `scripts/` |

---

## 12. Sync / offline pipeline

| Field | Detail |
|-------|--------|
| **Files** | `ems-offline-write.js`, `ems-outbox-lock.js`, `ems-cloud-mutation.js`, `ems-cloud-pull.js`, `ems-global-sync.js`, `ems-sync-cursor-idb.js`, `ems-sync-failure-ui.js`, `ems-online-mode.js`, `ems-offline-mode.js`, `ems-offline-policy.js`, `sync-engine.js`, `cloud/sync-engine.js`, `cloud/direct-firestore.js` |
| **Status** | Active — **migration forbidden until late** |
| **Entry** | Early `index.html` + post-auth foundation |
| **Dependencies** | IDB, firestore paths, network, auth |
| **Local stores** | Outbox + cursors in `ems_durable_v1` |
| **Firebase paths** | All tenant mutation/pull paths |
| **Tests** | Outbox/cursor Playwright configs (`test:e2e:outbox`, `test:e2e:cursor`) |
| **Future `src/`** | `src/core/sync/` |

---

## 13. Mobile navigation / shell

| Field | Detail |
|-------|--------|
| **Files** | `ems-mobile-shell.js`, `ems-status-bar.js`, `ems-native-app-boot.js`; CSS in `style.css`; markup in `index.html` |
| **Status** | Active — presentation layer over existing ribbon/`reg-tab` |
| **Entry** | `index.html` defer (before auth completes) |
| **Dependencies** | DOM of desktop ribbon tabs; `sysLayoutGetModuleMenus` / `MODULE_MENUS`; RBAC filtering |
| **Local stores** | None (presentation) |
| **Firebase paths** | None directly |
| **Tests** | `tests/unit/ems-mobile-nav-v2.test.js` (in `verify:regression`) |
| **Docs** | `MOBILE_MSWORD_NAV_ARCHITECTURE.md`, `MOBILE_NAV_GAP_AUDIT.md` |
| **Future `src/`** | `src/app/navigation/`, `src/platform/android/` |

---

## 14. Printing / ID / slips

| Field | Detail |
|-------|--------|
| **Files** | `ems-idcard.js`, `ems-smart-slip.js`; print CSS/templates inside `index.html` / module files |
| **Status** | Active |
| **Entry** | Via registration / finance lazy loads |
| **Dependencies** | Module data, browser print |
| **Future `src/`** | `src/shared/ui/` + module-specific print templates |

---

## 15. Settings / system builders

| Field | Detail |
|-------|--------|
| **Files** | `sys-settings.js`, `sys-terminology.js`, `sys-button-builder.js`, `sys-field-builder.js`, `sys-layout-builder.js`, `sys-permissions.js`, `sys-report-builder.js` |
| **Status** | Active (deferred post-auth) |
| **Entry** | `OFFLINE_DEFERRED` in `ems-post-auth-loader.js` |
| **Dependencies** | Core UI, permissions, terminology |
| **Local stores** | Settings persisted via tenant/IDB helpers |
| **Future `src/`** | `src/modules/settings/` or `src/shared/ui/builders/` |

---

## 16. Super Admin / Admin / Parent

| Module | Files | Entry | Future |
|--------|-------|-------|--------|
| Super Admin | `sa/*`, `superadmin.js` | Lazy `superadmin` | `src/modules/superadmin/` or keep `sa/` |
| Admin panel | `admin-panel.js`, `access-keys.js` | Lazy `admin-panel` | `src/modules/admin/` |
| Parent portal | `parent-portal.js`, `parent-shared.js`; CF `parent-*.js` | Lazy `parent-portal` | `src/modules/parent/` |
| AI Studio | `cloud/ems-ai-*.js` | Lazy `ai-studio` + AI stack | `src/modules/ai/` |

---

## 17. Core platform (not a “product module” but inventory)

| Area | Files | Future |
|------|-------|--------|
| Database | `ems-idb-engine.js`, search-index*, durable storage, quota | `src/core/database/` |
| Firebase paths / pull | `ems-firestore-paths.js`, `ems-cloud-pull.js`, `ems-firebase-init.js` | `src/core/firebase/` |
| Security | `security-*.js`, `identity-gate.js`, CF `functions/lib/security*.js` | `src/core/security/` |
| Shared UI/utils | `ems-ui-kit.js`, `ems-utils.js`, `ems-i18n.js`, `ems-branding.js` | `src/shared/*` |
| Departments | `department-*.js` | `src/core/` or `src/shared/` |

---

## 18. Suggested future `src/` tree (evidence-adjusted)

```text
src/
  app/
    boot/          # runtime-mode, boot-gate, post-auth-loader, lazy-loader, deferred-libs
    shell/         # core.js, status-bar
    navigation/    # ems-mobile-shell.js
    auth/          # auth, landing, portal-access, native-google, user-service
  core/
    database/      # idb-engine, durable, quota, search-index*, repository
    sync/          # offline-write, cloud-mutation/pull, global-sync, cursors, sync-engine*
    security/      # security-layer, mfa, identity-gate, user-access, tenant-*
    backup/        # client backup-service wrappers
    firebase/      # firestore-paths, firebase-init, cache-policy, cloud loader bridges
  modules/
    registration/
    attendance/
    exams/
    finance/       # finance + ledger + smart-slip
    complaints/
    curriculum/
    training/
    announcements/
    dashboard/
    settings/      # sys-*
    admin/
    parent/
    superadmin/    # or retain sa/ with thin re-exports
    ai/
  shared/
    ui/            # ui-kit, branding, virtual-table, sync-failure-ui
    utils/         # ems-utils, query-utils (if pure), i18n helpers
    constants/     # master-data
    validation/    # extract pure validators over time
  platform/
    web/           # service-worker helpers, sw-update
    android/       # native-app-boot, native-google-auth
    electron/      # re-export or document desktop/ as already separated
```

`desktop/` and `android/` **native projects stay outside** `src/` (platform shells already separated).
