# Firebase، IAM اور Tenant Isolation Audit

## Release blockers

### SEC-P0-00 — Storage photos/ledger کا cross-tenant read

`storage.rules` میں `registrations/{tenantId}/...` اور `ledger/{tenantId}/...` کے reads صرف `isSignedIn()` مانگتے ہیں۔ کوئی بھی authenticated user دوسرے ادارے کی تصاویر/attachments download کر سکتا ہے۔

**ثبوت:** `storage.rules:22-35`۔

### SEC-P0-00B — offline cache سے suspension bypass

اگر Firestore cache میں `subStatus === 'suspended'` ہو مگر network بند ہو اور پرانا offline session غیر-معطل ہو، تو `auth.js` `finishMadrasaLogin` چلا دیتا ہے۔

**ثبوت:** `auth.js:1693-1707`۔

### SEC-P0-00C — RegistrationSearchIndex wildcard exposure

`RegistrationSearchIndex` کا الگ admission-gated rule نہیں؛ tenant wildcard `canReadTenantStaff` سے پورا search index (نام، CNIC، فون) پڑھنے کے قابل ہے۔

**ثبوت:** `firestore.rules:809-812`۔

### SEC-P0-00D — enterprise search callable میں RBAC/kill-switch نہیں

`searchTenantRegistrations` صرف owner/active staff چیک کرتا ہے؛ `assertMadrasaActive` اور `admission.view` نہیں۔

**ثبوت:** `functions/lib/tenant-registration-search.js:51-67`۔

### SEC-P0-01 — suspended tenant کا kill switch نامکمل

- `firestore.rules` میں درجنوں collections کے reads اب بھی `canReadTenantStaff(madrasaId)` استعمال کرتے ہیں؛ یہ helper `isMadrasaActive` enforce نہیں کرتا۔
- `SystemSettings_Config`، audit create، training، کئی reporting/config paths اور owner management gates suspension کے باوجود reachable رہ سکتے ہیں۔
- Cloud Function helper صرف `parent-data.js` اور `tenant-links.js` میں استعمال ہے۔
- `ai/tenant-access.js`، `bulk-import-registrations.js`، `tenant-registration-search.js` اور `parent-messages.js` tenant status verify نہیں کرتے۔

**اثر:** suspended ادارہ search، AI، parent messaging، bulk import یا raw collection reads کے ذریعے data/API استعمال جاری رکھ سکتا ہے۔  
**ثبوت:** EV-CODE-003/004۔  
**حتمی حالت:** Partially Fixed؛ release-blocking۔

### SEC-P0-02 — offline complaints کی cross-tenant replay

`complaints_sync_queue` کا key صرف complaint `id` ہے۔ queued item میں `tenantId` نہیں، جبکہ `flushQueue()` current tenant لے کر تمام items upload/delete کرتا ہے۔

**Reproduction:**
1. Tenant A میں offline complaint `C1` save یا delete کریں۔
2. sync سے پہلے logout/switch کر کے Tenant B کھولیں۔
3. online ہوں؛ queue B کے path پر flush ہو گی۔

**اثر:** دوسرے ادارے میں sensitive complaint disclosure، غلط deletion، ID collision سے pending operation overwrite۔  
**ثبوت:** `cloud/complaints-firestore.js:8-10,33,99-178`۔  
**حتمی حالت:** Release blocker۔

### SEC-P0-03 — legacy fallback sync queue بھی tenant-less

جب unified outbox API load نہ ہو تو `cloud/sync-engine.js` کی fallback queue items tenant ID کے بغیر محفوظ کرتی ہے؛ init کے بعد current `state.uid` پر flush کرتی ہے۔

**اثر:** loader degradation یا partial old bundle میں cross-tenant module overwrite۔  
**ثبوت:** `sync-engine.js:210-247,433-478,740-751`۔  
**حتمی حالت:** dormant مگر executable legacy path؛ release blocker۔

## شدید مسائل

### SEC-H-01 — AI API key plaintext Firestore

Owner browser پورا `ai_config` document پڑھتا ہے اور `providers.gemini.apiKey` براہِ راست لکھتا ہے۔ server key resolver بھی plaintext field کو Secret Manager سے پہلے ترجیح دیتا ہے۔

**اثر:** XSS، owner-session compromise، Firestore export یا backup سے provider credential compromise۔  
**ثبوت:** `ems-ai-settings.js:50-57,113-137`، `key-vault.js:25-49`۔

### SEC-H-02 — Settings stored XSS

Profile import کسی schema یا escaping کے بغیر arbitrary JSON قبول کرتا ہے۔ `p.name`، audit actor/action/entity/summary raw `innerHTML` میں شامل ہوتے ہیں۔

**اثر:** institution admin context میں persistent script execution؛ AI key، cached PII، exports اور admin actions تک رسائی۔  
**ثبوت:** `sys-settings.js:488-517,520-538,616-625`۔

### SEC-H-03 — AI least-privilege اور privacy gap

ہر active staff link AI access حاصل کر سکتا ہے؛ department/class/module permission verify نہیں ہوتی۔ student context میں name، ID، class، finance، exams اور discipline summary external provider کو بھیجی جاتی ہے۔ مکمل question preview audit میں محفوظ ہوتی ہے۔

**اثر:** unauthorized internal data use، third-party disclosure، sensitive query retention۔  
**ثبوت:** `ai/tenant-access.js:10-46`، `ems-ai-context-builders.js:112-174`، `ai/gateway.js:61-95`۔

### SEC-H-04 — AI abuse controls نہیں

`aiAsk` میں per-user/per-tenant rate limit، budget gate، idempotency یا request concurrency limit نہیں۔

**اثر:** cost abuse اور denial-of-wallet۔

### SEC-H-05 — debug surfaces production platform configs میں

- Android: `webContentsDebuggingEnabled: true`
- Desktop: `enableDevTools: true`

**اثر:** local device access رکھنے والا شخص renderer storage، tokens، tenant cache اور IPC surface inspect/modify کر سکتا ہے۔

## مضبوط حصے

- Phase A/B/C static security tests 21/21 pass۔
- Super-admin self-injection guard موجود۔
- sensitive registration/finance reads module-action gates پر منتقل ہوئے۔
- audit UID equality validation موجود۔
- server-side tenant link resolution collection-group enumeration کم کرتا ہے۔
- `dist` hosting source کے ساتھ aligned ہے۔

## عملی verification کی حد

حقیقی Firebase Rules emulator authorization matrix، stolen token، old session، direct REST requests، دو حقیقی tenants اور production custom claims اس run میں دستیاب نہیں تھے؛ متعلقہ claims **UNVERIFIED** ہیں، نہ کہ PASS۔
