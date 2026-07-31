# Offline، Online اور Synchronization Results

## ثابت شدہ نتائج

| Scenario | نتیجہ | qualification |
|---|---|---|
| Offline registration create/update/delete → reconnect | PASS | browser harness + mock cloud |
| reconnect پر pending fee flush | PASS | browser harness + mock cloud |
| duplicate second flush | PASS | mock write log میں zero extra write |
| دو simulated devices convergence | PASS | الگ browser contexts، shared mock snapshot |
| newer `clientUpdatedAt` conflict wins | PASS | synthetic conflict |
| دو tabs concurrent outbox flush | PASS | mock Firestore؛ ایک write |
| Service Worker build mismatch/banner/reload | PASS | synthetic SW harness |
| 50k IndexedDB persistence after reload | PASS | real Chromium IndexedDB |
| multi-module DR restoration | PASS | synthetic offline backup verifier |

## Release-blocking failures

### SYNC-P0-01 — Complaint queue tenant metadata نہیں رکھتی

یہ outbox global database/store میں complaint ID کے نام سے item رکھتی ہے۔ Tenant switch کے بعد flush current tenant پر ہوتی ہے۔ Upsert، delete اور retry تینوں متاثر ہیں۔

### SYNC-P0-02 — legacy module queue tenant metadata نہیں رکھتی

Unified outbox absent ہونے کی صورت میں fallback queue current tenant state استعمال کرتی ہے۔ partial script load، old bundle یا degraded boot اس path کو دوبارہ فعال کر سکتے ہیں۔

## مزید خطرات

1. `dashboard.js` اور `finance.js` میں direct global-name `localStorage` reads repository/cloud SSOT سے stale یا tenant-mismatched view بنا سکتے ہیں۔
2. complaint flush ہر item کا error swallow کرتا ہے؛ failed item کی وجہ، retry count اور terminal failure UI نہیں بنتی۔
3. complaint queue ID collision دو tenants کی ایک ہی complaint ID کو overwrite کر سکتی ہے۔
4. migration failure `migrateFromLegacyBlob()` میں `{ migrated: 0 }` بن جاتی ہے؛ corruption اور واقعی empty data distinguish نہیں ہوتے۔
5. full suite میں backup snapshot نے locked `firestore.indexes.json` پر `EBUSY` دیا؛ isolated DR verifier pass ہونے کے باوجود operational backup robustness مکمل ثابت نہیں۔

## UNVERIFIED

- حقیقی Firebase partial batch failure اور retry order
- server timestamp بمقابلہ غلط device clock conflict
- mobile force-close کے عین درمیان write
- Electron crash کے دوران SQLite WAL recovery
- logout/account switch کے دوران active real cloud flush
- 3 physical devices کے concurrent writes
- cloud tombstone کے ساتھ offline update اور delete resurrection
- storage quota/corrupted outbox کی حقیقی recovery

ان scenarios کو PASS قرار نہیں دیا گیا۔
