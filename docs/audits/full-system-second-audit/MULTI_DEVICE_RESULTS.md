# Multiple Devices، Tabs اور Platform Parity

## Multi-tab

- دو tabs کا concurrent outbox flush test PASS ہوا۔
- leader failover اور lease-expiry browser tests PASS ہوئے۔
- یہ tests shared local browser origin اور mocks استعمال کرتے ہیں؛ 3/5 tabs، stale authenticated screen، role revocation اور tenant switch عملی طور پر مکمل نہیں چلے۔

## Multi-device simulation

- Device A push → Device B pull → B add → A pull convergence PASS۔
- newer `clientUpdatedAt` conflict PASS۔
- simulation Firebase نہیں بلکہ imported/exported mock cloud snapshot تھی۔
- simultaneous name/class/delete tri-conflict، tombstone، conflict log اور old-session role revocation **UNVERIFIED**۔

## Browser

- `dist` integrity: PASS، 194 files aligned۔
- IndexedDB 50k persistence: PASS۔
- dist E2E run میں متعدد login/identity tests fail یا timeout ہوئے، پھر run hang ہوا؛ browser readiness مکمل PASS نہیں۔

## Android

Preflight FAIL:

- `ems-idb-engine.js`
- `ems-offline-write.js`
- `core.js`
- `index.html`
- `ems-post-auth-loader.js`

نتیجہ: Android build deployed web security/sync code کے برابر نہیں۔ `webContentsDebuggingEnabled` بھی enabled ہے۔ Signed release APK یا physical Android lifecycle **UNVERIFIED**۔

## Windows / Electron

- static desktop tests 15/15 PASS۔
- durable path `Documents\MadrasaEMS_Data` اور native SQLite design موجود۔
- packaged configuration default `offlineOnly: true` ہے؛ اس لیے browser/mobile کے ساتھ same-cloud behavior default طور پر equivalent نہیں۔
- DevTools enabled ہیں۔
- موجود release folders security-masterpiece کے بعد rebuilt ہونے کا قابلِ اعتماد ثبوت نہیں۔
- packaged executable، forced crash، installer upgrade اور corrupted SQLite recovery **UNVERIFIED**۔

## حتمی platform verdict

Web source/dist aligned ہیں، مگر Android stale اور Windows default mode مختلف ہے۔ اس حالت میں تینوں platforms کو ایک ہی feature/security/sync baseline کہنا درست نہیں۔
