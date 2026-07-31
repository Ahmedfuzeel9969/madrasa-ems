# سابقہ خرابیوں کی دوبارہ تصدیق

یہ matrix دستیاب سابقہ audit/remediation reports، موجودہ code اور focused retests پر مبنی ہے۔ حقیقی production authorization یا physical-device test نہ ہونے پر نتیجہ جان بوجھ کر محدود رکھا گیا ہے۔

| ID | سابقہ مسئلہ | ماڈیول | شدت | دعویٰ شدہ حل | تبدیل شدہ فائلیں | موجودہ code status | عملی retest | حتمی نتیجہ |
|---|---|---|---|---|---|---|---|---|
| PE-03 | Staff access-key hash کا blanket read | IAM | P0 | self/owner-only read | `firestore.rules` | rule برقرار | static Vitest PASS | Fixed in Code but Not Practically Verified |
| PE-05/AU-01 | دوسرے UID سے audit log forgery | Audit | P0 | UID session match | `firestore.rules` | validation برقرار | static Vitest PASS | Fixed in Code but Not Practically Verified |
| TH-03 | security CF failure پر admin bypass | Login | P0 | fail-closed logout | `identity-gate.js` | catch fail-closed | unit PASS؛ live outage نہیں | Fixed in Code but Not Practically Verified |
| TH-02 | `lastActive`/`lastActivity` mismatch | Session | P0 | ایک field | `security-layer.js` | درست field موجود | unit/static PASS | Fully Fixed |
| TI-01 | collection-group tenant enumeration | Tenant links | P1 | callable resolution | rules، `tenant-links.js`، `tenant-context.js` | group rules removed | Phase B tests PASS | Fixed in Code but Not Practically Verified |
| TH-01/PE-01 | legacy module-only write | RBAC | P1 | explicit actions | `firestore.rules` | action gates موجود | Phase B tests PASS | Fixed in Code but Not Practically Verified |
| PE-04 | Registration/Finance blanket read | Sensitive data | P1 | module-specific read | `firestore.rules` | دو collections درست | emulator authorization نہیں | Fixed in Code but Not Practically Verified |
| SA-P0-01 | `Platform_Users` سے self super-admin | Super Admin | P0 | role injection block | `firestore.rules` | create guard موجود | Phase C static PASS | Fixed in Code but Not Practically Verified |
| SA-P0-02 | suspension صرف UI میں | Tenant lifecycle | P0 | rules + CF helper | rules، `tenant-kill-switch.js` | core action helpers میں موجود، مگر کئی raw reads/CFs خارج | code trace FAIL | Partially Fixed |
| SA-P2-01 | SA role read failure پر owner default | Super Admin | P2 | support default | `sa/sa-core.js` | fail-closed default برقرار | Phase C static PASS | Fully Fixed |
| AI-R1 | provider key plaintext Firestore | AI | P0/High | Secret Manager roadmap | `ems-ai-settings.js`، `key-vault.js` | plaintext path اب بھی پہلی priority | code trace FAIL | Reappeared |
| AI-R2 | `aiAsk` rate limit نہیں | AI | High | roadmap recommendation | AI gateway | کوئی tenant/user quota gate نہیں | code inspection | Still Present in a New Form |
| AI-R3 | ہر active staff student AI context لے سکتا ہے | AI/IAM | High | structured context | AI tenant access/context builders | module/department scope check نہیں | code inspection | Still Present in a New Form |
| PERF-P0-01 | `photoBase64` heavy records | Registration | P0 | lean records/migration | registration stack | migration paths موجود؛ legacy tenant proof نہیں | synthetic only | Fixed in Code but Not Practically Verified |
| PERF-P0-02 | fee arrears O(n×m) | Dashboard/Finance | P0 | map aggregation | dashboard/perf stack | benchmark optimized path PASS | 5 synthetic runs | Fully Fixed |
| PERF-P0-03 | login پر full cloud pull | Sync | P0 | core-only pull/lazy modules | `sync-engine.js` | core registry path موجود | real Firebase reads نہیں | Fixed in Code but Not Practically Verified |
| REG-ARCH-01 | hydration count loose match | Registration | High | SSOT readiness gates | repository/boot files | focused tests PASS | browser dist partial PASS | Fixed in Code but Not Practically Verified |
| REG-ARCH-02 | limited refresh RAM replace | Registration | High | paginated repository | repository/admission | paginated path موجود | 50k IDB PASS | Fully Fixed |
| REG-ARCH-03 | mirror put failures swallowed | Registration | High | diagnostics/recovery | repository stack | بعض best-effort catches باقی | failure injection نامکمل | Partially Fixed |
| REG-ARCH-04 | merged users 1,000 cap | Cross-module | High | repository pagination | user/repository helpers | admission paginated؛ downstream direct local reads باقی | 2,500 lifecycle نہیں | Partially Fixed |
| REG-ARCH-05 | ID card/letters legacy SSOT | Registration | High | repository lookup | admission/report paths | focused SSOT tests PASS | UI print عملی test نہیں | Fixed in Code but Not Practically Verified |
| DESK-A5 | portable desktop data TEMP میں ضائع | Windows | Critical | Documents data dir + SQLite | `desktop/main.js`، native DB | code/test موجود | 15 static tests PASS؛ executable crash test نہیں | Fixed in Code but Not Practically Verified |
| AND-PARITY | Android assets source سے پیچھے | Android | High | asset preflight | Android assets | preflight اس run میں FAIL | عملی FAIL | Reappeared |
| BACKUP-P4 | snapshot reliability | Recovery | High | manifest backup | backup scripts | full suite میں `EBUSY` failure؛ isolated DR PASS | mixed | Partially Fixed |
| SA-IAM-LEGACY | email-keyed SuperAdmins mismatch | Super Admin | Critical | UID/email/platform recognition | rules/auth | موجودہ tests/static paths موجود | live claims نہیں | Fixed in Code but Not Practically Verified |

## خلاصہ

- Fully Fixed: 5
- Partially Fixed: 5
- Reappeared: 2
- Still Present in a New Form: 2
- Fix Introduced a New Defect: 0 ثابت شدہ
- Fixed in Code but Not Practically Verified / Could Not Be Tested: 11

اصل severe scenarios میں حقیقی Firebase emulator/production authorization، signed APK اور packaged Windows crash recovery دستیاب نہ ہونے کی وجہ سے مکمل عملی closure ثابت نہیں ہوا۔
