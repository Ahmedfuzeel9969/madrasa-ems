# Phase A — Draft Admission & Auto Save: Database Design

**Phase:** 2A  
**Date:** 9 July 2026  
**Status:** DESIGN — awaiting approval  
**Storage principle:** Local IndexedDB authoritative offline; Firestore mirror for multi-device

---

## 1. Overview

Phase A introduces **draft storage** separate from approved registration SSOT (`emsRepo` / `registrations` mirror). Drafts are **never** merged into the live registration list until explicit approve via existing `processRegistration`.

---

## 2. Storage Layers

| Layer | Technology | Role |
|-------|------------|------|
| L1 — Draft index | IDB KV (`emsIdbKvSet`) | Per-staff draft metadata + field snapshot |
| L2 — Photo blobs | IDB KV (separate keys) | Large binary; avoids JSON bloat |
| L3 — Sync outbox | IDB KV | Pending cloud upsert/delete |
| L4 — Cloud mirror | Firestore | Multi-device field sync |
| L5 — Optional photo thumb | Firestore doc field | 8KB max base64 JPEG |

**Not used:** localStorage (5MB cliff), `ems_full_users`, registration repo mirror.

---

## 3. IndexedDB Key Schema

Follows Phase 1 tenant pattern: `{tenantId}__suffix` (see `ems-registration-audit.js`).

### 3.1 Draft Index Key

```
{tenantId}__reg_drafts_index
```

**Value:** JSON object map:

```javascript
{
  "version": 1,
  "drafts": {
    "student": { "draftKey": "...", "updatedAt": "ISO", "revision": 3 },
    "teacher": { ... },
    "staff": { ... }
  }
}
```

**Cardinality:** Max 3 active drafts per staff (one per type). Staff scope enforced in draft record, not key.

### 3.2 Draft Record Key

```
{tenantId}__reg_draft_{staffId}_{type}
```

**Example:** `tenant_abc__reg_draft_STF-001_student`

**Value:**

```javascript
{
  "version": 1,
  "draftId": "drf-1720512000000-abc12",
  "tenantId": "tenant_abc",
  "staffId": "STF-001",
  "staffUid": "firebase_uid_optional",
  "type": "student",
  "revision": 3,
  "updatedAt": "2026-07-09T12:00:00.000Z",
  "deviceId": "dev-uuid-persistent",
  "deviceLabel": "Chrome Android",
  "reason": "auto" | "emergency" | "tab_switch" | "manual",
  "fields": {
    "name": "محمد علی",
    "fname": "احمد",
    "cnic": "00000-0000000-0",
    "phone": "03001234567",
    "...": "..."
  },
  "terms": {
    "text": "...",
    "locked": false
  },
  "customFields": { },
  "meta": {
    "editingId": null,
    "isEditingRejected": false,
    "proposedId": "STD-2026-0042",
    "accordionOpenIndex": 0,
    "scrollY": 120
  },
  "photo": {
    "hasPhoto": true,
    "blobKey": "tenant_abc__reg_draft_photo_drf-1720512000000-abc12",
    "thumbBase64": "/9j/4AAQ...(max 8KB)",
    "thumbUpdatedAt": "ISO"
  },
  "checksum": "fnv1a-hex-of-fields-without-photo"
}
```

### 3.3 Photo Blob Key

```
{tenantId}__reg_draft_photo_{draftId}
```

**Value:** base64 data URL string OR binary wrapper (match existing photo patterns in admission).

**Size cap:** 400KB local; reject larger with toast "تصویر بہت بڑی — کمpress کریں".

### 3.4 Sync Outbox Key

```
{tenantId}__reg_draft_outbox
```

**Value:** Array (max 200 entries):

```javascript
[
  {
    "op": "upsert" | "delete",
    "draftKey": "{staffId}_{type}",
    "draftId": "drf-...",
    "payloadRef": "{tenantId}__reg_draft_{staffId}_{type}",
    "queuedAt": "ISO",
    "attempts": 0
  }
]
```

Processed by `emsRegDraftFlushSync()` — same async pattern as `ems-registration-audit.js` outbox.

### 3.5 Device ID Key (Persistent)

```
ems_reg_draft_device_id
```

**Value:** UUID v4 generated once per browser profile. Used for conflict detection; not authentication.

---

## 4. Staff & Tenant Scoping

| Identifier | Source | Usage |
|------------|--------|-------|
| `tenantId` | `emsGetTenantId()` | All keys prefixed |
| `staffId` | `emsGetStaffIdForAccess()` | Draft owner |
| Owner/admin | `staffId = 'owner'` or Firebase uid | When not staff user |
| Parent | N/A | No draft access (blocked by permissions) |

**Rule:** Draft keys always include `staffId`. Staff A cannot read Staff B drafts (local filter + Firestore rules).

---

## 5. Firestore Schema (Cloud Mirror)

### 5.1 Collection Path

```
RegistrationDrafts/{tenantId}/items/{draftDocId}
```

**Document ID:** `{staffId}_{type}` (deterministic — one doc per staff per type)

### 5.2 Document Shape

```javascript
{
  draftId: "drf-...",
  tenantId: "tenant_abc",
  staffId: "STF-001",
  staffUid: "firebase_uid",
  type: "student",
  revision: 3,
  updatedAt: Timestamp,
  deviceId: "dev-uuid",
  deviceLabel: "Chrome Android",
  fields: { /* same as local, PII fields */ },
  terms: { text, locked },
  customFields: { },
  meta: { editingId, isEditingRejected, proposedId },
  photoThumb: "base64_jpeg_max_8kb",
  checksum: "fnv1a-hex",
  expiresAt: Timestamp  // updatedAt + 30 days
}
```

**Excluded from cloud:** full photo base64, internal blob keys.

### 5.3 Firestore Indexes

| Index | Fields | Purpose |
|-------|--------|---------|
| Composite | `staffId ASC, updatedAt DESC` | Pull staff drafts on login |
| TTL | `expiresAt` | Optional Firebase TTL policy (Phase A ops) |

### 5.4 Security Rules (Design — ops deploy)

```
match /RegistrationDrafts/{tenantId}/items/{docId} {
  allow read: if canReadTenantStaff(tenantId)
              && resource.data.staffId == requestStaffId();
  allow write: if canWriteRegistration(tenantId)
              && request.resource.data.staffId == requestStaffId()
              && request.resource.data.tenantId == tenantId;
  allow delete: if same as write;
}
```

Staff can only read/write **own** drafts. Owner can read all (support); delete for cleanup.

---

## 6. Entity Relationship

```
┌─────────────────────┐         ┌──────────────────────────┐
│ reg_drafts_index    │ 1     n │ reg_draft_{staff}_{type}  │
│ (per tenant)        │────────►│ (draft record)            │
└─────────────────────┘         └───────────┬──────────────┘
                                            │ 0..1
                                            ▼
                                ┌──────────────────────────┐
                                │ reg_draft_photo_{draftId}│
                                │ (blob)                   │
                                └──────────────────────────┘
                                            │
                            sync (async)  ▼
                                ┌──────────────────────────┐
                                │ Firestore Registration   │
                                │ Drafts/.../items/        │
                                └──────────────────────────┘

┌─────────────────────┐
│ registrations (SSOT)│ ◄── processRegistration ONLY (unchanged)
│ emsRepo mirror      │
└─────────────────────┘
```

**Invariant:** Draft docs never appear in `#reg-users-table` or `emsRegRepoGetList()`.

---

## 7. Field Mapping by Type

### Student (`fields`)

Maps 1:1 to `processRegistration` student branch:

`name, fname, cnic, phone, dob, bloodGroup, class, branch, admType, resType, madrasaRollNo, wifaqRollNo, address, grdName, grdRelation, grdProfession, grdMobile, grdCnic, grdEmergency, prevClass, prevMarks, prevGrade, prevYear, prevInstitute, officeNazra, officeNamaz, officeTest, officeRemarks, officeExaminer, date`

### Teacher

`name, fname, dob, cnic, bloodGroup, marital, phone, whatsapp, email, address, designation, department, shift, salary, residence, food, expInstitute, expDesignation, expDuration, expReason, officeDemo, officeNazim, date`

### Staff

`name, fname, dob, cnic, position, phone, address, guaName, guaCnic, guaMobile, guaRelation, guaAddress, expDetails, healthIssue, salary, shift, officeNazim, date`

Custom fields stored in `customFields` via `sysFieldCollect`.

---

## 8. TTL & Retention

| Policy | Value |
|--------|-------|
| Draft max age | 30 days from `updatedAt` |
| Purge trigger | `emsRegDraftInit()` + daily first open |
| On approve | Immediate delete (local + cloud) |
| On logout | **Keep local drafts** (same staff re-login); purge index entries for other staffIds on shared device |
| Tenant switch | Purge all draft keys for previous tenant |
| Outbox max | 200 entries; drop oldest with audit log |

---

## 9. Quota Management

Integrate with `ems-storage-quota.js`:

| Threshold | Action |
|-----------|--------|
| >80% IDB quota | Skip photo thumb regeneration |
| >90% | Fields-only save; warn user |
| >95% | Disable new photo in draft; fields still save |

---

## 10. Versioning & Migration

| Draft `version` | Meaning |
|-----------------|---------|
| 1 | Phase A initial schema |

Future versions: migration on load in `emsRegLoadDraft` — if unknown version, skip hydrate with warning.

---

## 11. Comparison to Existing Stores

| Store | Phase A Interaction |
|-------|---------------------|
| `{tenantId}__reg_audit_log` | None (draft save does not audit until approve) |
| `ems_repo_{tenantId}` | None until approve |
| `ems_reg_perm_snapshot_v1` | None |
| localStorage | **Not used** for drafts |

Optional Phase A+ audit event: `draft_saved` / `draft_resumed` (low priority; security review).

---

## 12. Sample Key Listing (Tenant `madrasa_1`, Staff `STF-042`)

| Key | Approx Size |
|-----|-------------|
| `madrasa_1__reg_drafts_index` | 0.5 KB |
| `madrasa_1__reg_draft_STF-042_student` | 3–15 KB |
| `madrasa_1__reg_draft_photo_drf-xxx` | 50–400 KB |
| `madrasa_1__reg_draft_outbox` | 1–10 KB |

---

## 13. Approval Checklist

- [ ] IDB key naming approved
- [ ] Firestore path + rules approved
- [ ] Photo local/cloud split approved
- [ ] TTL 30 days approved
- [ ] Staff scoping model approved

---

*See `REGISTRATION_PHASEA_ARCHITECTURE.md` for data flows.*
