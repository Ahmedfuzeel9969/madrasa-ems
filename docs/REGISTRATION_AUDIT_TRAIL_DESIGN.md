# Registration Audit Trail Design

**Date:** 9 July 2026  
**Phase:** 1 — Priority 4  
**Status:** Design document (pre-implementation)

---

## Current State

### Existing infrastructure

`ems-audit.js` provides `emsLogAudit(module, action, entityId, details)`:

- **Storage:** Firestore `All_Madrasas/{tenantId}/EmsAudit`
- **Fields:** `module`, `action`, `entityId`, `details`, `uid`, `email`, `timestamp`, `clientTs`
- **Offline:** Skipped silently when no Firebase (`{ skipped: true, reason: 'offline' }`)

### What is logged today (Registration only)

| Event | Logged? | Location | Action Code |
|-------|---------|----------|-------------|
| Approve new record | ✅ | `admission.js` L520–525 | `approve` |
| Reject new record | ✅ | `admission.js` L520–525 | `reject` |
| Edit existing record | ❌ | — | — |
| Delete record | ❌ | — | — |
| Restore from rejected | ❌ | — | — |
| Bulk import | ❌ | — | — |
| Export data | ❌ | — | — |
| ID card print | ❌ | — | — |
| Field-level changes | ❌ | — | — |
| Permission override (duplicate) | ❌ | — | — |
| Disaster recovery | ❌ | — | — |

**Coverage: ~15% of registration mutations.**

---

## Target Audit Model

### Event types

| Action | Trigger | Priority |
|--------|---------|----------|
| `create` | New approved record | P1 |
| `edit` | Update existing record | P1 |
| `delete` | Remove record | P1 |
| `approve` | Approve (already exists) | ✅ Done |
| `reject` | Reject to history | ✅ Done |
| `restore` | Rejected → approved | P1 |
| `import` | Bulk import commit | P1 |
| `export` | Data export | P2 |
| `print_idcard` | ID card printed | P2 |
| `print_letter` | Letter printed | P2 |
| `duplicate_override` | Staff overrides duplicate warning | P1 |
| `dr_sync` | Disaster recovery pull | P2 |
| `archive` | Record archived (memory cap) | P3 |

### Audit record schema (extended)

```javascript
{
  // Existing fields
  module: 'admission',
  action: 'edit',
  entityId: 'STD-042',
  uid: 'firebase-uid',
  email: 'staff@example.com',
  timestamp: serverTimestamp,
  clientTs: 1720500000000,

  // New fields (Phase 1)
  entityType: 'student',           // student|teacher|staff
  actorName: 'احمد علی',          // display name from staff record
  actorRole: 'reception',        // staff role template
  device: {
    userAgent: '...',
    platform: 'Win32',
    screenSize: '1920x1080',
    language: 'ur-PK',
    online: true
  },
  changes: [                       // field-level diff (edit only)
    { field: 'phone', old: '0300-1111111', new: '0300-2222222' },
    { field: 'class', old: 'جماعت ششم', new: 'جماعت ہفتم' }
  ],
  reason: 'تلفون نمبر درست',       // optional override reason
  source: 'form',                  // form|import|api|sync|system
  sessionId: 'sess-abc123',        // login session identifier
  offline: false,                // was this queued offline?
  syncedAt: null                 // when offline audit synced
}
```

---

## Offline-First Audit Queue

### Problem

Current `emsLogAudit` skips when offline — audit gaps during disconnected operation.

### Solution: Local audit outbox

```
emsLogAudit(module, action, entityId, details)
  │
  ├─ If online + Firebase available:
  │    Write to Firestore EmsAudit immediately
  │
  └─ If offline:
       Write to IDB store `audit_outbox` (new)
       Background sync when online (reuse ems-offline-write pattern)
       Max 10,000 queued events per tenant
```

**Storage:** IDB `audit_outbox` keyed by `{tenantId}__audit_pending`

**Sync:** Hook into existing `emsOfflineFlushQueue` or dedicated `emsAuditFlushQueue`

---

## Field-Level Change Tracking

### `emsRegDiffRecord(before, after)`

```javascript
// Compare two registration records
// Returns array of { field, old, new }
// Ignores: timestamp, photoBase64 (too large), internal _fields
// Tracks: name, fname, cnic, phone, class, type, status, rollNo, etc.

var TRACKED_FIELDS = [
  'name', 'fname', 'cnic', 'phone', 'bform', 'class', 'type',
  'designation', 'position', 'grade', 'section', 'rollNo',
  'madrasaRollNo', 'wifaqRollNo', 'address', 'status'
];
```

### Integration in save path

```javascript
// In processRegistration, before upsert:
var before = currentEditingId
  ? await emsRegRepoGetById(currentEditingId)
  : null;
var after = user; // built from form

// After successful upsert:
var changes = before ? emsRegDiffRecord(before, after) : [];
emsLogAudit('admission', before ? 'edit' : 'create', user.id, {
  entityType: type,
  changes: changes,
  source: 'form'
});
```

---

## Audit Viewer UI (Phase 1b)

### Location

New section in Registration → "محفوظ ریکارڈ" tab → per-record "History" button

Or: System Settings → Audit Log (filtered to `module=admission`)

### Display

```
┌─────────────────────────────────────────────────────┐
│ STD-042 — محمد علی — Audit History                  │
├──────────┬──────────┬─────────┬─────────────────────┤
│ Date     │ Actor    │ Action  │ Changes             │
├──────────┼──────────┼─────────┼─────────────────────┤
│ 09/07/26 │ احمد (R) │ edit    │ phone: 0300→0301   │
│ 08/07/26 │ Owner    │ create  │ (new record)        │
└──────────┴──────────┴─────────┴─────────────────────┘
```

### API

```javascript
emsRegGetAuditTrail(entityId, opts)
  → Query Firestore EmsAudit where entityId == id, orderBy timestamp desc
  → Merge with local audit_outbox (unsynced)
  → Return combined timeline
```

---

## Security & Privacy

| Rule | Detail |
|------|--------|
| No photo/base64 in audit | Too large; log `photoChanged: true` only |
| CNIC masking in viewer | Show `35202-***567-1` for non-owner staff |
| Audit write permission | Any authenticated staff (append-only) |
| Audit read permission | Owner + `admission:view` |
| Audit delete | **Never** — append-only, no delete API |
| Retention | 2 years default; configurable per tenant |
| PII in `details` | Minimize; use field names not full records |

---

## Firestore Rules (proposed addition)

```
match /EmsAudit/{auditId} {
  allow read: if canReadTenantStaff(madrasaId);
  allow create: if canReadTenantStaff(madrasaId);
  allow update, delete: if false;  // append-only
}
```

---

## Implementation Plan

### Sprint 1 (Week 1)

- [ ] Extend `emsLogAudit` payload with `device`, `entityType`, `source`
- [ ] Add `create` + `edit` + `delete` logging in `admission.js`
- [ ] Implement `emsRegDiffRecord`
- [ ] Unit tests for diff engine

### Sprint 2 (Week 2)

- [ ] Offline audit outbox in IDB
- [ ] Sync queue integration
- [ ] `restore` + `import` audit events
- [ ] `duplicate_override` logging

### Sprint 3 (Week 3 — Phase 1b)

- [ ] Per-record audit viewer modal
- [ ] Firestore rules update
- [ ] E2E: edit record → verify audit entry with field diff

---

## Estimated Score Impact

| Dimension | Before | After P4 |
|-----------|--------|----------|
| Security | 58 | 72 |
| Global Readiness | 42 | 52 |
| Architecture | 78 | 80 |

---

*Next step: Sprint 1 — extend emsLogAudit calls in processRegistration and deleteRegistration.*
