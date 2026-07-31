# موجودہ مکمل نظامی نقشہ

## ماڈیول نقشہ

| اصل ماڈیول | نمایاں entry/source | persistence / cloud | اہم تعلقات |
|---|---|---|---|
| Landing، Login، Identity | `index.html`، `auth.js`، `portal-access.js`، `identity-gate.js`، `security-layer.js` | Firebase Auth، `Platform_Users`، tenant links، session/local storage | ہر protected module، MFA، trusted device، RBAC |
| Dashboard | `dashboard.js`، `dashboard-360-engine.js`، `dashboard-analytics.js` | `DashboardStats/current` + local module keys | registrations، attendance، finance، exams، complaints، training |
| Registration/Admission | `admission.js`، `ems-registration-repository.js`، `ems-repository.js` | tenant-scoped IndexedDB/native SQLite، `Registrations`، `Rejected` | class، attendance، fees، exams، parent links، reports |
| Attendance | `attendance.js`، `attendance-firestore.js` | attendance sheets/local cache، `Attendance` | students/classes، dashboard، reporting |
| Training/Administration | `training.js` اور training support files | `TrainingRecords`، `TrainingWarnings`، `Training_Config` | staff/student، dashboard، reports |
| Curriculum | curriculum JS/support files، lazy-loader registration | curriculum local keys/tenant collections | classes، subjects، examinations |
| Complaints | complaints UI files، `cloud/complaints-firestore.js` | `EMS_ComplaintsSyncDB`، `Complaints` | student/staff identity، dashboard، AI discipline summary |
| Examinations | exam/result JS files | `Exams`/exam local keys، summaries | students، class، curriculum، dashboard، AI |
| Finance/Ledger/Payroll | `finance.js`، ledger/payroll files | fee setup/collections/bills/ledger local keys + tenant collections | registrations، dashboard، reports |
| Announcements/Parent portal | announcements files، parent portal، `parent-data.js`، `parent-messages.js` | `Announcements`، `ParentMessages`، `Parent_Links` | student links، push notifications |
| System Settings | `sys-settings.js` اور settings extension scripts | local module keys، `SystemSettings_Config`، profiles/backups | تمام visual labels/layout/actions/permissions |
| Institutional Admin | admin panel JS، user/permission services | `StaffPermissions`، `Staff_Links`، tenant settings، audit/security logs | IAM، modules، access keys، exports |
| Super Control Panel | `superadmin.js`، `sa/*` | `All_Madrasas`، `Platform_Users`، `SuperAdmins`، platform logs | tenants، billing، subscriptions، central analytics |
| AI Assistant | `cloud/ems-ai-*`، `functions/lib/ai/*` | structured context، `SystemSettings_Config/ai_config`، AI audit | registration، attendance، finance، exams، complaints |
| Search/Import/Export/Reports | enterprise search/import/report files + CFs | search indexes، files، local cache، tenant collections | تمام business modules |

## Shared core

| نظام | اہم فائلیں/ڈیٹا |
|---|---|
| Tenant resolution | `tenant-context.js`، `ems-tenant-resolver.js`، `CURRENT_MADRASA_TENANT_ID` |
| Repository | `ems-repository.js`؛ tenant prefix `tenantId__collection` |
| Browser durability | `ems-idb-engine.js`، IndexedDB stores، durable cache |
| Desktop durability | `desktop/main.js`، `desktop/preload.js`، `desktop/native-db-sqlite.js`، `Documents\MadrasaEMS_Data` |
| Outbox/sync | `ems-offline-write.js`، `ems-outbox-lock.js`، `cloud/sync-engine.js`، `cloud/direct-firestore.js` |
| Cloud adapter | Firebase client stack، `All_Madrasas/{tenantId}/...` |
| Rules | `firestore.rules`، `storage.rules`، `firestore.indexes.json` |
| Cloud Functions | `functions/index.js`، `functions/lib/*` |
| Service Worker | `service-worker.js`، SW update harness |
| Backup/recovery | `scripts/disaster-recovery-*`، production verification، tenant export |
| Production web | `dist/`؛ hosting source؛ verification 194 files |
| Android | Capacitor، `android/app/src/main/assets/public` |
| Windows | Electron packaged local `dist` + SQLite |

## مرکزی data relationships

```text
Tenant
 ├─ Registrations(student/staff)
 │   ├─ Attendance
 │   ├─ Fee setup / collections / bills / ledger
 │   ├─ Exams / results
 │   ├─ Complaints / discipline
 │   ├─ Parent_Links / ParentMessages
 │   └─ Dashboard / reports / AI context
 ├─ Classes ↔ Curriculum ↔ Exams
 ├─ Staff_Links ↔ StaffPermissions ↔ module actions
 ├─ TenantSettings/SystemSettings ↔ UI + permissions + sync behavior
 └─ Audit/SecurityLog ↔ identity and administrative actions
```

## اہم architectural divergence

1. `emsRepo` tenant-scoped ہے، مگر کئی modules اب بھی global-name `localStorage` keys براہِ راست پڑھتے ہیں۔
2. unified outbox tenant metadata رکھتا ہے، مگر complaints اور legacy fallback queues tenant-less ہیں۔
3. Browser web cloud-capable ہے؛ packaged desktop default `offlineOnly: true` ہے۔
4. Android copied assets source/dist سے stale ہیں۔
5. `dist` source verification پاس ہے، مگر Android اور موجود packaged Windows releases کی current security parity ثابت نہیں۔
