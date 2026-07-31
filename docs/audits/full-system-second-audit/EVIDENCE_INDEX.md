# ثبوت اشاریہ — Second Full-System Audit

**تاریخ:** 12 جولائی 2026  
**دائرہ:** Source، `dist`، Android assets، Electron، Firestore Rules، Cloud Functions، unit/E2E/benchmark harnesses۔  
**حفاظتی حد:** Production data پر کوئی destructive test یا code fix نہیں کیا گیا۔

| ثبوت ID | قسم | ماخذ/کمانڈ | نتیجہ |
|---|---|---|---|
| EV-UNIT-001 | مکمل unit suite | `npm test` | 126 files میں 14 failed؛ 751 tests میں 15 failed، 736 passed |
| EV-SEC-001 | focused security retest | Phase A/B/C Vitest files | 21/21 passed |
| EV-REG-001 | registration critical retest | SSOT، rules، duplicate، audit tests | 42/42 passed |
| EV-DESK-001 | desktop static tests | `ems-desktop-phase4`، `ems-desktop-a5` | 15/15 passed |
| EV-DR-001 | DR unit tests | `ems-disaster-recovery.test.js` | 11/11 passed |
| EV-DR-002 | synthetic recovery | `npm run backup:verify-production` | 1,000 registrations، 3,000 fees، 12 attendance، 45 complaints مکمل بحال |
| EV-E2E-001 | offline/reconnect | `playwright.p5b.config.js` | 4/4 passed؛ mock cloud استعمال ہوا |
| EV-E2E-002 | multi-tab outbox | `playwright.outbox.config.js` | 1/1 passed؛ mock Firestore |
| EV-E2E-003 | Service Worker update | `playwright.sw.config.js` | 3/3 passed |
| EV-E2E-004 | dist regression | `playwright.config.js` | 40 میں کم از کم 29 passed، 8 failed؛ run بعد میں hang ہوا اور محفوظ طور پر ختم کیا گیا |
| EV-HOST-001 | hosting integrity | `npm run verify:hosting` | 194 files unchanged، PASS |
| EV-AND-001 | Android parity | `node scripts/android-asset-preflight.js` | FAIL: پانچ assets stale |
| EV-PERF-001 | Node synthetic benchmark | پانچ runs، 100 تا 50,000 records | 50k پر parse تقریباً 70–94ms، search 34–40ms، stringify 80–121ms |
| EV-PERF-002 | real Chromium IndexedDB | 100/1k/2.5k/10k/50k | persistence PASS؛ 50k index build 353.5s، search 1.337s |
| EV-CODE-001 | complaint queue trace | `cloud/complaints-firestore.js:8-10, 33, 99-178` | queue key اور payload tenant-less؛ flush موجودہ tenant استعمال کرتا ہے |
| EV-CODE-002 | legacy sync trace | `cloud/sync-engine.js:210-247, 433-478, 740-751` | fallback queue tenant-less؛ tenant switch پر موجودہ `state.uid` کو write |
| EV-CODE-003 | kill switch trace | `firestore.rules:479-810` | کئی reads اب بھی `canReadTenantStaff` یا owner gates سے، `isMadrasaActive` کے بغیر |
| EV-CODE-004 | Cloud Function kill switch trace | `functions/lib/*` | helper صرف `parent-data.js` اور `tenant-links.js` میں؛ AI/search/import/messages میں نہیں |
| EV-CODE-005 | Settings XSS trace | `sys-settings.js:488-517, 520-538, 616-625` | imported/user-controlled values raw `innerHTML` میں |
| EV-CODE-006 | AI secret trace | `cloud/ems-ai-settings.js:50-57, 113-137`؛ `functions/lib/ai/key-vault.js:25-49` | provider key plaintext tenant document میں read/write |
| EV-CODE-007 | AI privacy trace | `ems-ai-context-builders.js:112-174`؛ `ai/gateway.js:61-95` | student name/ID/finance/discipline external provider؛ full question preview audit میں |
| EV-CODE-008 | desktop mode | `desktop/config.json:3-6` | packaged desktop default `offlineOnly: true` اور DevTools enabled |
| EV-CODE-009 | Android debug | `capacitor.config.json:11-15` | WebView debugging enabled |
| EV-CODE-010 | direct local reads | `dashboard.js:651-663,866-867`؛ `finance.js:42-1680` | cloud/repository SSOT کے ساتھ متعدد direct `localStorage` paths |
| EV-CODE-011 | Storage cross-tenant read | `storage.rules:22-35` | registrations/ledger reads صرف `isSignedIn()` |
| EV-CODE-012 | offline suspension bypass | `auth.js:1693-1707` | cached suspended + offline stale session → full boot |
| EV-CODE-013 | search index wildcard | `firestore.rules:809-812` | RegistrationSearchIndex admission-gated نہیں |
| EV-CODE-014 | search callable gap | `tenant-registration-search.js:51-67` | kill-switch/RBAC missing |
| EV-CODE-015 | custom button XSS | `sys-button-builder.js:320`؛ `core.js` custom URL | raw innerHTML + unrestricted window.open |
| EV-REVERIFY-001 | P0/High re-trace (post Phase Two) | storage/auth/complaints/sync/rules/AI/Android/desktop/Phase A-B | 12 CONFIRMED, XSS PARTIAL, Phase A/B CONFIRMED; NEW: Staff_Links blanket read, bulk-import/AI kill-switch gap |
| EV-AND-001-RERUN | Android preflight this session | `node scripts/android-asset-preflight.js` | FAIL: `ems-idb-engine.js`, `ems-offline-write.js`, `core.js`, `index.html`, `ems-post-auth-loader.js` |

## Evidence qualification

- `PASS (mock)` کو حقیقی Firebase، حقیقی devices یا production proof نہیں سمجھا گیا۔
- Android physical device، signed release APK، packaged Windows executable، حقیقی multi-device Firebase conflict اور production tenant authorization **UNVERIFIED** ہیں۔
- Generated evidence: `docs/idb-browser-bench.json`، `docs/DR-PRODUCTION-VERIFICATION-REPORT.json`، `docs/PRIORITY-6-SOAK-REPORT.json`۔
