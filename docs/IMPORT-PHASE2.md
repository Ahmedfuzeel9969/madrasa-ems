# Import / Export — Phase 2 Enhancements

**Date:** 2026-06-19  
**Builds on:** Legacy + Smart Import (Phase 1)

---

## Completed (remaining scope)

### 1. Mapping templates
- **File:** `ems-import-templates.js`
- Built-in Urdu/English presets (student, teacher, staff)
- Wizard Step 3: template bar + Apply

### 2. Duplicate merge UI
- **File:** `ems-import-merge.js`
- Wizard Step 5: smart duplicate analysis (CNIC, phone)
- Conflict policy in Step 6 (unchanged: skip / update / duplicate)

### 3. Cloud bulk import
- **CF:** `bulkImportRegistrations` (`functions/lib/bulk-import-registrations.js`)
- **Trigger:** Wizard import when **400+ rows** (server-side batch writes)
- Same `Registrations` document shape — no schema change

### 4. Architecture doc
- [`docs/IMPORT-EXPORT-ARCHITECTURE.md`](IMPORT-EXPORT-ARCHITECTURE.md)

---

## Backward compatibility

| Feature | Status |
|---------|--------|
| Legacy quick import | ✅ |
| 7-step wizard | ✅ |
| Export filters | ✅ |
| Firestore paths | ✅ unchanged |
| Registration forms | ✅ unchanged |

---

## Deploy (functions only)

```powershell
firebase deploy --only functions:bulkImportRegistrations
node scripts/prepare-hosting.js
firebase deploy --only hosting
```

**Cache:** `ie2` on import scripts

---

*End of Import Phase 2 Report*
