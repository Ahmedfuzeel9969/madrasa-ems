# Registration Security Hardening

**Date:** 9 July 2026  
**Current Security Score:** 58/100  
**Phase 1 Target:** 72/100  
**Phase 2 Target:** 88/100

---

## Threat Model

| Threat | Current Risk | Target Risk |
|--------|-------------|-------------|
| Unauthorized registration write | Medium (client unguarded) | Low |
| Cross-tenant data leak | Medium (legacy localStorage) | Low |
| Duplicate identity fraud | High (no manual check) | Low |
| Audit tampering | Medium (no offline audit) | Very Low |
| XSS via dynamic row HTML | Medium (inline onclick) | Low |
| Malicious file upload | Medium (client-only validation) | Low |
| Bulk import data poisoning | Low (owner-only CF) | Very Low |
| PII exposure in logs | Medium (no masking) | Low |
| Staff privilege escalation | Medium (UI not guarded) | Low |

---

## Layer 1: Firestore Rules (Server)

### Current

```
canWriteRegistration(madrasaId) = canOwnerAct(madrasaId) || isSuperAdmin()
Registrations: read = canReadTenantStaff; write = canWriteRegistration
bulkImportRegistrations: assertOwner(tenantId, uid)
searchTenantRegistrations: assertTenantAccess(context, tenantId)
```

### Phase 1 additions

```
// EmsAudit — append-only
match /EmsAudit/{auditId} {
  allow read: if canReadTenantStaff(madrasaId);
  allow create: if canReadTenantStaff(madrasaId);
  allow update, delete: if false;
}

// Pending applications (Phase 2 prep)
match /Pending/{docId} {
  allow read: if canReadTenantStaff(madrasaId);
  allow create: if true;  // public form — rate limited by CF
  allow update: if canWriteRegistration(madrasaId);
  allow delete: if false;
}
```

### Phase 1b: Staff write access

```
function canStaffWriteRegistration(madrasaId) {
  return staffPermExists(madrasaId)
    && staffPerm(madrasaId).modules.admission == true
    && (staffPerm(madrasaId).actions.admission.create == true
        || staffPerm(madrasaId).actions.admission.edit == true);
}

match /Registrations/{studentId} {
  allow write: if canWriteRegistration(madrasaId)
    || canStaffWriteRegistration(madrasaId);
}
```

---

## Layer 2: Cloud Functions

### Current protections

| CF | Auth | Authorization | Limits |
|----|------|---------------|--------|
| `bulkImportRegistrations` | ✅ Required | Owner only | 2000 records |
| `searchTenantRegistrations` | ✅ Required | Tenant access | Min 2 char query |

### Phase 1 additions

| CF | Protection |
|----|-----------|
| `bulkImportRegistrations` | Add rate limit: 5 calls/minute/tenant |
| `searchTenantRegistrations` | Add rate limit: 30 calls/minute/user |
| All CFs | Input sanitization: strip HTML, limit field lengths |
| All CFs | Log caller uid + tenantId to `EmsAudit` |

### Phase 2 additions

| CF | Protection |
|----|-----------|
| `submitPublicApplication` | CAPTCHA + rate limit 10/hour/IP |
| `processRegistrationOCR` | Owner/staff only, max 5MB file |

---

## Layer 3: Client Permissions

### Phase 1 implementation

| Control | Mechanism | File |
|---------|-----------|------|
| Tab visibility | `emsRegGuardUI()` hides unauthorized tabs | `ems-registration-permissions.js` |
| Button disable | `data-reg-perm` attribute check | `index.html` |
| Save guard | `emsRegCan('reg_create')` before `processRegistration` | `admission.js` |
| Delete guard | `emsRegCan('reg_delete')` before `deleteRegistration` | `admission.js` |
| Import guard | `emsRegCan('reg_import')` before wizard open | `ems-import-wizard.js` |
| Export guard | `emsRegCan('reg_export')` before export | `ems-import-wizard.js` |
| DR guard | `emsRegCan('reg_dr')` before recovery buttons | `admission.js` |
| Duplicate override | `emsRegCan('reg_dup_override')` | `admission.js` |

### Offline permission cache

```javascript
// On login: cache staff permissions in IDB
emsPermCacheStore(staffId, permissions, expiryMs)

// On module open: read from cache if offline
emsRegCan(action) → check cache → fallback owner-only
```

---

## Layer 4: Data Protection

### Legacy path elimination (Priority 1)

| Risk | Fix |
|------|-----|
| `ems_full_users` cross-tenant leak | Remove all reads; repo SSOT only |
| ID card shows wrong tenant data | `emsRegGetRecordById` with tenant assert |
| Rejected list from global key | `emsRegRepoGetRejectedList` only |

### PII handling

| Field | Storage | Display | Audit |
|-------|---------|---------|-------|
| CNIC | Full in IDB/Firestore | Masked for non-owner (`35202-***567-1`) | Last 4 digits only |
| Phone | Full | Full for authorized staff | Masked |
| Photo | Firebase Storage URL | URL only in lean records | `photoChanged: true` |
| Address | Full | Full for authorized | Not in audit details |

### Input sanitization

| Vector | Current | Fix |
|--------|---------|-----|
| Form fields | No sanitization | Strip HTML tags on save |
| Dynamic row HTML | Inline onclick with user.id | Use `data-id` + event delegation |
| Import CSV | `cleanRecord` strips `_` fields | Add field length limits (name ≤200, etc.) |
| Search query | Passed to CF as-is | Escape regex chars, limit 100 chars |

---

## Layer 5: Audit & Compliance

### Phase 1 audit hardening

| Control | Detail |
|---------|--------|
| Append-only | No update/delete on EmsAudit |
| Offline queue | IDB outbox, synced on reconnect |
| Device fingerprint | userAgent, platform, screenSize in audit record |
| Field-level diff | Only changed fields logged |
| Override reason | Required text when overriding duplicate |

### Phase 2 compliance

| Control | Detail |
|---------|--------|
| Data retention policy | Configurable per tenant (default 2 years) |
| Right to erasure | Owner can purge student PII (anonymize, not delete audit) |
| Consent tracking | Parent consent checkbox on admission form |
| Export for SAR | Full student data export on request |

---

## Layer 6: File Upload Security

### Current

- Photo: `accept="image/*"` (client only)
- No server-side validation
- No size limit

### Phase 1

| Control | Implementation |
|---------|---------------|
| Client size limit | 2MB max, reject before upload |
| Client type check | JPEG/PNG/WebP only (magic bytes) |
| Server validation | `ems-photo-storage.js`: check content-type + size |
| Base64 stripping | Already done in `emsLeanUserForLocalStorage` |
| Virus scan | Phase 2: Cloud Function ClamAV or Cloud Storage trigger |

---

## Security Test Plan

| Test | Method | Pass Criteria |
|------|--------|---------------|
| Staff without delete perm | E2E Playwright | Delete button not visible |
| Reception cannot import | E2E | Import tab hidden |
| Cross-tenant ID card | Unit test | Returns null for wrong tenant |
| XSS in name field | Unit test | HTML stripped on save |
| Audit append-only | Firestore rules test | Update/delete rejected |
| Offline audit queue | E2E | Audit synced after reconnect |
| Bulk import non-owner | CF test | Permission denied error |
| Duplicate override non-owner | E2E | Override button not shown |
| CNIC masking in audit viewer | Unit test | Shows masked for reception role |

---

## Score Progression

| Control Area | Current | Phase 1 | Phase 2 |
|-------------|---------|---------|---------|
| Server rules | 70 | 75 | 85 |
| Client permissions | 20 | 70 | 85 |
| Audit trail | 30 | 75 | 90 |
| Data isolation | 55 | 80 | 90 |
| Input validation | 40 | 65 | 80 |
| File upload | 35 | 60 | 75 |
| PII protection | 45 | 65 | 85 |
| **Overall** | **58** | **72** | **88** |

---

## Priority Order

1. **Legacy path removal** — eliminates cross-tenant data leak (Sprint 1)
2. **Client permission guards** — prevents unauthorized UI actions (Sprint 5)
3. **Audit trail** — accountability for all mutations (Sprint 4)
4. **Duplicate detection** — prevents identity fraud (Sprint 3)
5. **Input sanitization** — prevents XSS (Sprint 5)
6. **Server staff write rules** — defense in depth (Sprint 5b)
7. **File upload validation** — prevents malicious uploads (Sprint 6)
8. **PII masking** — privacy compliance (Phase 2)

---

*Security hardening is continuous — review after each sprint and quarterly.*
