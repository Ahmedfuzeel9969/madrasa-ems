# Import / Export Module — Architecture & Extension Guide

**Status:** Production system — backward-compatible enhancements only.

---

## Current Architecture (unchanged core)

```
Registration Module (index.html → module-admission)
└── Ribbon tab: "امپورٹ / ایکسپورٹ" → reg-data-panel
    ├── Export card          → emsDoExport() → EmsImportExport.exportData()
    ├── Import (legacy)      → emsLegacyQuickImport()  [Phase: Simple mode]
    ├── Import (advanced)    → openImportWizard()      [7-step wizard]
    └── Import history       → emsRenderImportHistory() → localStorage
```

### Core engine (`ems-import-export.js`)

| API | Purpose |
|-----|---------|
| `parseFile` | Excel/CSV/JSON/XML → headers + rows |
| `autoMatch` | Column → field mapping (Urdu/EN/AR aliases) |
| `buildRecords` | Map rows → registration objects + validation |
| `summarize` | Count new/existing/problems |
| `commit` | Firestore batch + localStorage sync |
| `exportData` | Filtered export (xlsx/csv/json/pdf) |
| `addHistory` / `getHistory` | Import audit trail (local) |

**Data paths (unchanged):**

- `localStorage`: `ems_full_users` (or `DB.users` key)
- Firestore: `All_Madrasas/{tenantId}/Registrations/{id}`
- History: `ems_import_history`
- Snapshots: `ems_import_snapshot_v1` (rollback only, optional)

### UI controllers

| File | Role |
|------|------|
| `ems-import-wizard.js` | 7-step advanced wizard (unchanged flow) |
| `ems-import-legacy.js` | One-screen simple import (legacy mode) |
| `ems-import-smart.js` | Profiles, snapshots, smart validation layer |

### Registration integration

- `admission.js` → `switchRegTab('reg-data-panel')` calls `emsOnDataPanel()`
- `EmsImportExport.commit` triggers `renderRegTable()` when available
- No changes to student/teacher/staff forms, RBAC, or Firestore document shape

---

## Dual-mode design

### 1. Legacy simple import (existing behaviour preserved)

- Pick file + record type → auto-match columns → skip duplicates → import
- Same `commit()` path as wizard (Firestore + localStorage)
- Optional pre-import snapshot for rollback

### 2. Advanced smart import (extensions)

- Full 7-step wizard (preview, conflict resolution, master data)
- **Mapping profiles** saved in localStorage (`ems_import_profiles_v1`)
- **Smart validation** before commit (duplicate CNIC, phone patterns)
- **Rollback** from last snapshot via history panel

---

## Extension rules (for all future work)

1. Do **not** remove or replace `EmsImportExport` public API.
2. Do **not** change registration document schema or collection paths.
3. New settings → new localStorage keys with `_v1` suffix; never overwrite legacy keys.
4. UI: add cards/panels; do not redesign Registration ribbon or forms.
5. Database migrations: only additive fields with `merge: true`; preserve all existing records.

---

*Last updated: 2026-06-19*
