# Madrasa EMS — Second Full-System Audit — FINAL REPORT

**Audit type:** Second-round complete system audit (read-only)  
**Report date:** 12 July 2026 (Phase Two system map + remaining phases completed same day)  
**Codebase:** `F:\WPS\stackblitz-starters-nbktzqft (4)\stackblitz-starters-nbktzqft (4)`  
**Method:** Source/rules/functions review, Android/desktop config parity, existing unit/E2E/benchmark/DR harnesses, fresh re-verification of all claimed P0/High findings.  
**Hard limit:** No production data destruction, no code fixes in this pass. Where live Firebase / physical devices / packaged exe were unavailable, status is **UNVERIFIED**.

**Phase status:**
| Phase | Status |
|---|---|
| Phase Two — Complete System Map | DONE → `SYSTEM_MAP.md` |
| Previous-fix verification | DONE → `PREVIOUS_FIX_VERIFICATION.md` |
| Offline / online / sync | DONE → `OFFLINE_ONLINE_SYNC.md` |
| Multi-device / multi-tab | DONE → `MULTI_DEVICE_RESULTS.md` |
| Firebase / IAM / isolation | DONE → `FIREBASE_SECURITY.md` |
| Cross-module / dashboard | DONE → `CROSS_MODULE_RESULTS.md` |
| Recovery / DR | DONE → `RECOVERY_RESULTS.md` |
| Performance | DONE → `PERFORMANCE_RESULTS.md` |
| Test-suite audit | DONE → `TEST_GAPS.md` |
| Evidence catalog | DONE → `EVIDENCE_INDEX.md` |
| This final report | DONE |

Supporting evidence IDs: `EV-UNIT-001` … `EV-CODE-015`, plus **EV-REVERIFY-001** (12 Jul re-trace of P0/High claims — 12 CONFIRMED, 1 PARTIAL XSS, Phase A/B CONFIRMED present).

---

## 1. Executive Summary

| Domain | Score /100 |
|---|---:|
| **Overall system** | **46** |
| Data safety | 34 |
| Offline reliability | 52 |
| Online / Firebase synchronization | 42 |
| Multiple devices | 35 |
| Multiple tabs | 64 |
| Security | 28 |
| Institutional data isolation | 26 |
| Mobile (Android) | 26 |
| Windows (Electron) | 46 |
| Browser / web | 63 |
| Performance | 64 |
| Recovery | 57 |
| Existing tests quality | 44 |

**Verdict: NO-GO for large-scale multi-institution production deployment.**

Repository pagination, Phase A/B storage refactor, DR synthetic restore, and action-level write RBAC are real improvements. They do **not** outweigh release blockers that break tenant trust boundaries: Storage cross-tenant reads, offline suspension bypass, tenant-less offline queues, incomplete kill-switch on reads/callables, Staff_Links blanket reads ignoring StaffPermissions, Settings XSS, plaintext AI keys, and stale Android assets.

Scores are slightly lower than the Phase-Two-era draft (48→46 overall; Security 32→28; Isolation 28→26) after re-verification confirmed additional P0 paths (StaffPermissions bypass on reads, bulk-import/AI without kill-switch).

---

## 2. Current Status of Previous Issues

| Classification | Count |
|---|---:|
| Fully Fixed | 5 |
| Partially Fixed | 5 |
| Reappeared | 2 |
| Still Present in a New Form | 2 |
| Fix Introduced a New Defect | 0 proven |
| Fixed in Code but Not Practically Verified / Could Not Be Tested | 11 |

Detail: `PREVIOUS_FIX_VERIFICATION.md`.

**Notable:**
- Phase A/B (localStorage cliff, `CLOUD_QUERY_LIMIT=500`, sequential delta pull, `persistRepoBlobSync` removed, legacy blob migration) → **CONFIRMED present** (EV-REVERIFY-001).
- Android asset parity → **REAPPEARED / FAIL** (`ems-idb-engine.js`, `ems-offline-write.js`, `core.js`, `index.html`, `ems-post-auth-loader.js` stale vs dist).
- AI plaintext key → **still present** (Secret Manager is optional second priority only).
- Tenant suspension → **PARTIALLY FIXED** (writes mostly gated; reads/search/AI/import/messages often not).

---

## 3. Release-Blocking Issues (must fix before any multi-tenant release)

1. **RB-01 — Storage cross-tenant read**  
   `storage.rules` `registrations/{tenantId}/…` and `ledger/{tenantId}/…` allow `read` if `isSignedIn()` only. Any signed-in user can download another institution’s photos/attachments.  
   Evidence: `storage.rules:23-36` (EV-CODE-011, CONFIRMED).

2. **RB-02 — Offline suspension bypass**  
   Cached Firestore `suspended` + offline + stale offline session with non-suspended status → `finishMadrasaLogin`.  
   Evidence: `auth.js:1693-1707` (EV-CODE-012, CONFIRMED).

3. **RB-03 — Complaints offline queue tenant-less**  
   Queue key = complaint `id` only; flush uses `getTenantId()` at flush time → Tenant A ops can land on Tenant B.  
   Evidence: `cloud/complaints-firestore.js:8-10,41-49,157-181` (EV-CODE-001, CONFIRMED).

4. **RB-04 — Legacy sync fallback queue tenant-less**  
   When unified outbox unavailable, fallback IDB items lack `tenantId`; flush uses `state.uid`.  
   Evidence: `cloud/sync-engine.js:210-247,433-478` (EV-CODE-002, CONFIRMED).

5. **RB-05 — Kill switch incomplete**  
   `canReadTenantStaff` has no `isMadrasaActive`. CF `assertMadrasaActive` only wired into `parent-data.js` / `tenant-links.js`. Missing on AI, search, bulk import, parent-messages.  
   Evidence: `firestore.rules:82-84,809-811`; CF traces (EV-CODE-003/004, CONFIRMED).

6. **RB-06 — Search callable + RegistrationSearchIndex**  
   `searchTenantRegistrations` lacks kill-switch and admission RBAC; index falls under catch-all staff read.  
   Evidence: `tenant-registration-search.js:51-67`; `firestore.rules:809-812` (EV-CODE-013/014, CONFIRMED).

7. **RB-07 — Android assets stale**  
   Preflight FAIL vs dist for five critical files. Shipping Android runs older IDB/offline/auth shell than web.  
   Evidence: `node scripts/android-asset-preflight.js` (EV-AND-001, reconfirmed this session).

8. **RB-08 — Settings / custom-button stored XSS**  
   Profile/audit/`innerHTML` interpolation; custom button name/icon injected unsanitized.  
   Evidence: `sys-settings.js:512-537`; `sys-button-builder.js:320` (EV-CODE-005/015, PARTIALLY CONFIRMED XSS paths).

9. **RB-09 — Staff_Links blanket tenant read (NEW confirmed)**  
   `canReadTenantStaff` = owner | SA | active Staff_Links — **ignores StaffPermissions**. Suspended/empty perms still read attendance, fees, exams, complaints, AiAuditLog, catch-all. UI hide ≠ data deny.  
   Evidence: `firestore.rules:70-84` vs `155-160` (AI/IAM re-audit, P0).

10. **RB-10 — Bulk import / AI while suspended (NEW confirmed)**  
    `bulkImportRegistrations` and `aiAsk` never call `assertMadrasaActive` — Admin SDK bypasses Rules write gates.  
    Evidence: `bulk-import-registrations.js:26-45`; `functions/lib/ai/tenant-access.js` / `gateway.js` (AI/IAM re-audit, P0).

---

## 4. Severe Issues (High)

- **AI API key plaintext** in `SystemSettings_Config/ai_config`; server prefers plaintext before Secret Manager (`key-vault.js:40-44`, `ems-ai-settings.js:117-128`).
- **AI access** for any active Staff_Links row — no module/department StaffPermissions check; no tenant rate/budget (unlike SA Advisor).
- **Client-trusted SCP** sent to Gemini (student id/name/phone last-4, finance, complaint snippets) — privacy/compliance risk.
- **Dashboard/finance** direct `localStorage` reads bypass repository SSOT → stale/wrong KPIs (`dashboard.js:865-867`, `finance.js` multi-sites).
- **Backup snapshot `EBUSY`** under full unit suite; isolated DR verifier PASS but operational backup not lock-safe.
- **dist E2E** identity/login failures + run hang (EV-E2E-004).
- **Desktop** default `offlineOnly: true` + `enableDevTools: true` (`desktop/config.json`).
- **Capacitor** `webContentsDebuggingEnabled: true`.
- **SA `callOrFallback` for role assign** when Functions down — client-side mutation path (`sa/sa-rbac.js`).

---

## 5. Medium-Severity Issues

- 50k IndexedDB index build ~353.5s; search ~1.337s; first page ~1.152s (EV-PERF-002) — not production-ready at that scale without resumable index.
- Complaint flush swallows errors; no retry/dead-letter UI.
- Migration failure can surface as empty migration (`migrated: 0`).
- Loader/security unit tests brittle (hard-coded old cache-bust strings).
- Android preflight IMPORTANT_FILES omits `auth.js`, `dashboard.js`, `finance.js`, `sync-engine.js` — drift can hide.
- Demo collections world-readable to any signed-in user (`firestore.rules` Demo_*).
- Invalid HttpsError code `madrassa-suspended` may collapse to `internal`.
- Dual outbox risk (unified + legacy) if both active — no runtime test.

---

## 6. Minor Issues

- Dense empty/silent catches hurt observability.
- Tests couple to source strings → false failures on architecture changes.
- npm `devdir` deprecation warning.
- Multiple historical desktop release folders create artifact ambiguity.
- AI client timeout UX coarse; Gemini fetch lacks AbortSignal.

---

## 7. Cross-Module Issues

| Flow | Result | Risk |
|---|---|---|
| Registration → repository → UI | Focused PASS | Live Firebase hydration UNVERIFIED |
| Registration → dashboard/finance | Mixed | Direct localStorage stale KPIs |
| Complaints → cloud | Partial | Tenant-less queue = RB-03 |
| Complaints → AI | Functional | Broad staff AI can see discipline snippets |
| Settings → all modules | Dangerous | XSS + invalid schema can compromise UI/IAM context |
| Suspension → modules | Incomplete | Reads/search/AI/import bypass |
| Web → Android | **FAIL** | Stale assets |
| Web → Windows | Divergent | Desktop offline-only default |
| Full student lifecycle E2E | **UNVERIFIED** | No authenticated isolated tenant run this audit |
| Full staff lifecycle E2E | **UNVERIFIED** | Claims/session revocation not live-tested |
| Dashboard KPI vs source collections | **UNVERIFIED** | No exact reconciliation |

---

## 8. File-by-File Findings (priority extract)

| # | Sev | Module | File | Issue | Impact | Evidence |
|---:|---|---|---|---|---|---|
| 1 | P0 | Storage | `storage.rules` | registrations/ledger read = `isSignedIn()` | Cross-tenant media | EV-CODE-011 |
| 2 | P0 | Auth | `auth.js` | Offline suspension bypass | Suspended tenant continues offline | EV-CODE-012 |
| 3 | P0 | Complaints | `cloud/complaints-firestore.js` | Tenant-less queue | Wrong-tenant upsert/delete | EV-CODE-001 |
| 4 | P0 | Sync | `cloud/sync-engine.js` | Tenant-less fallback | Wrong-tenant module overwrite | EV-CODE-002 |
| 5 | P0 | Rules | `firestore.rules` | Reads ignore `isMadrasaActive`; StaffPermissions ignored on read | Suspended + over-privileged staff reads | EV-CODE-003 |
| 6 | P0 | CF | `bulk-import-registrations.js`, `ai/*` | No kill-switch | Suspended still import/AI | EV-CODE-004 + re-audit |
| 7 | P0 | Search | `tenant-registration-search.js` + rules | No kill-switch / admission gate | Suspended search + index PII | EV-CODE-013/014 |
| 8 | P0 | AI | `key-vault.js`, `ems-ai-settings.js` | Plaintext API key | Key theft via owner/export/backup | EV-CODE-006 |
| 9 | P0 | IAM | `firestore.rules` `canReadTenantStaff` | Staff_Links alone = full read | Permission model bypass | AI/IAM re-audit |
| 10 | High | Settings | `sys-settings.js`, `sys-button-builder.js` | `innerHTML` XSS | Session/token theft | EV-CODE-005/015 |
| 11 | High | AI | `tenant-access.js`, context builders | Broad staff + PII to Gemini | Unauthorized insights / privacy | EV-CODE-007 |
| 12 | High | Android | assets vs dist | 5 stale files | Old security/sync behavior | EV-AND-001 |
| 13 | High | Dashboard/Finance | `dashboard.js`, `finance.js` | Direct localStorage | Wrong KPIs / balances | EV-CODE-010 |
| 14 | High | Recovery | backup scripts | `EBUSY` under suite | Incomplete backup | EV-UNIT-001 |
| 15 | Medium | Desktop | `desktop/config.json` | offlineOnly + DevTools | Sync divergence + local inspection | EV-CODE-008 |
| 16 | Medium | Android | `capacitor.config.json` | WebView debug | Device inspection | EV-CODE-009 |
| 17 | Medium | Perf | IDB search index | 50k ~353s rebuild | Long onboarding | EV-PERF-002 |

Full supporting narratives: `FIREBASE_SECURITY.md`, `OFFLINE_ONLINE_SYNC.md`, `CROSS_MODULE_RESULTS.md`.

---

## 9. Practical Test Results

| # | Scenario | Expected | Actual | Pass/Fail | Evidence |
|---:|---|---|---|---|---|
| 1 | Full unit suite | All pass | 15 failed / 736 passed (751) | **FAIL** | EV-UNIT-001 |
| 2 | Phase A/B/C security Vitest | Pass | 21/21 | PASS (static) | EV-SEC-001 |
| 3 | Registration critical | Pass | 42/42 | PASS (static/harness) | EV-REG-001 |
| 4 | Offline CRUD + reconnect | One final record | Correct, no duplicate | PASS (**mock**) | EV-E2E-001 |
| 5 | Two-device convergence | Parity | Parity | PASS (**mock**) | EV-E2E-001 |
| 6 | Two-tab outbox flush | One write | One write | PASS (**mock**) | EV-E2E-002 |
| 7 | SW mismatch banner | Reload path | Correct | PASS | EV-E2E-003 |
| 8 | Android parity | Match dist | 5 stale | **FAIL** | EV-AND-001 |
| 9 | Hosting `dist` vs source | Match | 194 unchanged | PASS | EV-HOST-001 |
| 10 | DR synthetic restore 1k | Exact | Exact | PASS (no live Firebase) | EV-DR-002 |
| 11 | Backup under full suite | Manifest | `EBUSY` | **FAIL** | EV-UNIT-001 |
| 12 | 50k IDB persist | Persist | Persist | PASS | EV-PERF-002 |
| 13 | 50k interactive search | Responsive | 1.337s | **DEGRADED** | EV-PERF-002 |
| 14 | dist browser regression | Complete | Failures + hang | **FAIL** | EV-E2E-004 |
| 15 | Cross-tenant complaint switch | Tenant-bound | Tenant-less | **FAIL** (static proof) | EV-CODE-001 |
| 16 | Suspended tenant all APIs | Deny | Multiple gaps | **FAIL** (static proof) | EV-CODE-003/004 |
| 17 | Storage photo isolation | Tenant-bound | Any signed-in | **FAIL** (static proof) | EV-CODE-011 |
| 18 | P0 re-verification pass | Confirm/refute | 12 CONFIRMED, 1 PARTIAL | DONE | EV-REVERIFY-001 |
| 19 | Full student lifecycle UI+Firebase | End-to-end | Not run (no isolated auth tenant) | **UNVERIFIED** | — |
| 20 | Packaged Windows crash/SQLite | Recover | Not run | **UNVERIFIED** | — |
| 21 | Signed Android force-close | Recover | Not run | **UNVERIFIED** | — |
| 22 | Live 3-device Firebase conflict | Deterministic | Not run | **UNVERIFIED** | — |
| 23 | Dashboard KPI source reconcile | Exact match | Not run | **UNVERIFIED** | — |
| 24 | Settings XSS DOM exploit | Blocked | Code-path only | **UNVERIFIED** (exploit not executed) | EV-CODE-005 |
| 25 | AI provider timeout/freeze | Graceful | Code-path only | **UNVERIFIED** | — |

**Qualification rule used throughout:** `PASS (mock)` ≠ production Firebase / physical-device proof.

---

## 10. All Data-Loss Paths

1. Complaint ID collision overwrites pending queue op.  
2. Wrong-tenant queued complaint delete/upsert after switch.  
3. Legacy fallback queue flushes to current tenant → overwrite.  
4. Backup file-lock → partial/invalid snapshot if treated as complete.  
5. Stale localStorage dashboard/finance presenting obsolete figures as truth.  
6. Silent migration/flush failure without recoverable user-facing state.  
7. Hard delete with no tombstone — offline update after remote delete may resurrect or lose intended delete (**UNVERIFIED** live, logically open).  
8. Complaint flush error swallow — ops stuck/lost without diagnostics.

---

## 11. All Duplicate-Creation Paths

1. Double-submit beyond tested registration subset — **UNVERIFIED**.  
2. Complaint retry uses same ID (good) but **wrong-tenant replay** creates institutional “duplicate” of sensitive data.  
3. Unified + legacy outbox both active → parallel persist risk (**UNVERIFIED** runtime).  
4. Multi-tab unified outbox — **PASS (mock)**; live Firebase retry idempotency **UNVERIFIED**.  
5. Bulk import IDs from batch index can collide across repeated imports depending conflict mode.  
6. Hard-delete resurrection via later offline upsert (no tombstone).

---

## 12. Cross-Tenant / User Exposure Paths

1. Storage registrations/ledger any-authenticated read.  
2. Complaint offline queue replay.  
3. Legacy module queue replay.  
4. Suspended tenant raw collection reads + AI/search/import/messages callables.  
5. Staff_Links without StaffPermissions → full tenant read + AI.  
6. Settings XSS → institutional cache/secrets in browser.  
7. AI broad staff + plaintext key (owner/SA/Firestore dump).  
8. Global localStorage keys if tenant-switch purge fails.  
9. Debug-enabled Android/Desktop local session inspection.  
10. RegistrationSearchIndex catch-all staff read (names/CNIC/phone).  
11. Demo_* collections readable by any signed-in user.

---

## 13. Firebase vs Local Conflicts

| Topic | Finding |
|---|---|
| Dual SSOT | `emsRepo` vs direct `localStorage` in dashboard/finance |
| Outboxes | Unified tenant-aware vs complaints/legacy tenant-less |
| Push conflict | `clientUpdatedAt` LWW (+ version abort) |
| Pull conflict | Server `updatedAt` vs dirty local meta — **asymmetric** |
| Tombstones | **None** — hard deletes |
| Desktop | Default offline-only → no cloud convergence |
| Online mode | Manual pull; `EMS_OFFLINE_FIRST_SSOT` — good for billing, easy to leave stale |

---

## 14. Mobile, Windows, and Browser Differences

| Platform | Status |
|---|---|
| Browser / `dist` | Current; hosting verify PASS; strongest tested surface |
| Android Capacitor | **5 critical assets stale**; WebView debugging on; physical/signed APK **UNVERIFIED** |
| Windows Electron | Native SQLite + Documents data dir (code/tests); default **offlineOnly**; DevTools on; packaged crash/upgrade **UNVERIFIED** |
| Parity claim | **Invalid** until Android sync + desktop mode policy + artifact hash gates |

---

## 15. Unverified Features (honest gaps)

- Firebase Rules emulator allow/deny matrix for every collection/role.  
- Live tenant suspension across every callable.  
- Full student/staff UI lifecycle on isolated real tenant.  
- Dashboard KPI exact source reconciliation.  
- Real Firebase multi-device / clock-skew / partial batch.  
- Physical Android force-close mid-write.  
- Packaged Windows crash + SQLite WAL recovery.  
- Settings malicious import DOM exploit execution.  
- AI provider hang + consent/retention policy proof.  
- Combined 50k multi-module related workload.  
- Production old SW/cache observation.

---

## 16. Remediation Plan

### Immediate (release blockers)

1. Tenant-bind **all** outboxes (complaints + legacy fallback); quarantine cross-tenant pending items.  
2. Storage reads: require tenant membership (same as writes), not merely `isSignedIn()`.  
3. Centralize kill-switch: wrap staff reads + **every** tenant callable (`aiAsk`, search, bulk import, messages).  
4. Enforce StaffPermissions on sensitive **reads** (or deny-by-default collections).  
5. Sanitize Settings/button builder (`textContent` / schema validation / CSP).  
6. AI keys: Secret Manager only; remove plaintext priority; add rate/budget.  
7. `npm run android:sync` + release gate on preflight; disable WebView debug in release.  
8. Close offline suspension bypass (treat cached suspended as authoritative when offline).

### Before next release

1. Firebase emulator authorization matrix.  
2. Suspension suite for every callable/collection.  
3. Dashboard/finance repository-only selectors.  
4. Backup lock retry + atomic manifest.  
5. Fix unit suite (15 failures) and dist E2E hang.  
6. Tombstone/delete conflict design + tests.

### Before limited real-world pilot

1. Isolated real Firebase tenant: full student/staff lifecycle.  
2. Signed Android + packaged Windows crash tests.  
3. Three-device update/delete conflict tests.  
4. AI consent/redaction + staff module scope.

### Before 100 institutions

1. Resumable 50k index/migration.  
2. Server-side aggregation / read-cost profiling.  
3. Central audit integrity, retention, recovery drills.  
4. Platform artifact hash/version enforcement.

### Later

- Legacy path removal, observability, typed schemas, chaos suite, performance budgets.

---

## 17. Retest Checklist

- [ ] Tenant A queued complaint never flushes to Tenant B.  
- [ ] Legacy/fallback queue verifies original tenant per item.  
- [ ] Storage photo/ledger read denied for foreign tenant.  
- [ ] Suspended tenant denied on **all** Rules reads + **all** callables (SA override separate).  
- [ ] Staff with empty/suspended StaffPermissions cannot read fees/exams/complaints via SDK.  
- [ ] Malicious settings profile/audit fields never become executable DOM.  
- [ ] Browser/Firestore export contains no AI API key.  
- [ ] Android preflight PASS and signed runtime smoke PASS.  
- [ ] Desktop cloud/offline modes explicit and tested.  
- [ ] Complete unit suite zero failures.  
- [ ] dist E2E completes deterministically.  
- [ ] Backup locked-file scenario recovers.  
- [ ] 3-device update/delete conflict deterministic (with tombstones).  
- [ ] Dashboard each KPI matches source collection totals.  
- [ ] Original failed scenario re-run under same evidence ID after each fix.  
- [ ] Phase A/B still green: `CLOUD_QUERY_LIMIT=500`, no `persistRepoBlobSync`, migration smoke PASS.

---

## Overall Readiness

| Decision | Status |
|---|---|
| Large-scale multi-institution production | **NO-GO** |
| Limited isolated engineering pilot | Only after RB-01…RB-10 closed, Android/Windows artifacts refreshed, emulator auth suite green |
| Phase A/B data-engine refactor alone | **Not sufficient** for release — security/isolation blockers dominate |

**Impartial summary:** The system map and repository foundation are stronger than earlier generations, and Phase A/B correctly removed the 5MB localStorage cliff and 100k sync blast. Those wins do not authorize production. Cross-tenant Storage, tenant-less queues, incomplete suspension, StaffPermissions read bypass, Settings XSS, plaintext AI keys, and stale Android assets remain **release-blocking**. No code was modified in this audit; evidence is preserved under `docs/audits/full-system-second-audit/`.

---

## Evidence index (quick)

| ID | Result |
|---|---|
| EV-UNIT-001 | 15/751 unit failures |
| EV-SEC-001 | 21/21 focused security |
| EV-REG-001 | 42/42 registration critical |
| EV-E2E-001/002 | Offline/multi-tab PASS (mock) |
| EV-E2E-003 | SW PASS |
| EV-E2E-004 | dist E2E FAIL + hang |
| EV-AND-001 | Android stale FAIL (reconfirmed) |
| EV-HOST-001 | dist verify PASS |
| EV-DR-001/002 | DR unit + synthetic PASS |
| EV-PERF-001/002 | Node + Chromium 50k measured |
| EV-CODE-001…015 | Static P0/High traces |
| EV-REVERIFY-001 | Fresh confirm of blockers + Phase A/B |

Artifacts folder: `docs/audits/full-system-second-audit/`.
