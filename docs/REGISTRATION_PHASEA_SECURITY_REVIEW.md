# Phase A — Draft Admission & Auto Save: Security Review

**Phase:** 2A  
**Date:** 9 July 2026  
**Status:** DESIGN — awaiting approval  
**Reviewer:** Registration architecture (pre-implementation)  
**Classification:** Internal — contains PII handling requirements

---

## 1. Executive Summary

Phase A stores **PII-rich draft admission data** locally and optionally in Firestore. Risk level: **Medium** (new data at rest, new cloud collection). Mitigations align with Phase 1 permissions, tenant isolation, and audit patterns.

**Recommendation:** Proceed with implementation after controls below are built into Phase A scope.

| Area | Risk | Residual |
|------|------|----------|
| Unauthorized draft read | Medium | Low (staff scoping + rules) |
| PII in cloud | Medium | Low (thumb only; rules) |
| Shared device leakage | Medium | Low (staffId filter) |
| Draft vs SSOT confusion | Low | Low (separate stores) |
| Permission bypass | Low | Low (dual guards) |
| DoS / quota abuse | Low | Low (caps + TTL) |

---

## 2. Threat Model

### 2.1 Assets

| Asset | Sensitivity |
|-------|-------------|
| Draft field data (CNIC, phone, address) | **High** |
| Draft photo blob | **High** |
| Cloud draft mirror | **High** |
| Device ID | Low |
| Draft index metadata | Medium |

### 2.2 Actors

| Actor | Capability |
|-------|------------|
| Owner / Admin | Full registration access |
| Staff (reception) | Create/edit admission |
| Teacher | View/print only — **no draft create** |
| Parent | No registration access |
| Anonymous | No draft access |
| Malicious staff | Attempt cross-staff draft read |

### 2.3 Trust Boundaries

```
[Browser IDB] ←→ [Draft Module] ←→ [Firestore RegistrationDrafts]
                      ↑
              [Permission Layer emsRegCan]
                      ↑
              [Registration UI]
```

---

## 3. Security Requirements

### SR-1: Permission Gates

| Action | Required Permission |
|--------|-------------------|
| Auto-save / manual save draft | `create` OR (`edit` if `meta.editingId`) |
| Load / resume draft | `create` OR `edit` |
| List drafts | `create` OR `edit` |
| Delete draft | `create` OR `edit` |
| Cloud sync | Same as save (server rules enforce) |

**Implementation:** `emsRegRequire('create', { draft: true })` or edit variant before any IDB write.

**Teacher role:** Draft hooks not bound if `!emsRegCan('create') && !emsRegCan('edit')`.

### SR-2: Staff Isolation

- Draft keys include `staffId` from `emsGetStaffIdForAccess()`
- `emsRegListDrafts()` filters `staffId === currentStaff`
- Owner viewing all drafts: **deferred** (support feature); Phase A owner sees own drafts only unless impersonation exists

### SR-3: Tenant Isolation

- All IDB keys prefixed `{tenantId}__`
- `emsRegDraftPurgeSession()` on tenant switch removes cached drafts from memory
- Firestore path includes `{tenantId}`
- Cloud payload validates `tenantId` matches session

### SR-4: Logout & Session

| Event | Behavior |
|-------|----------|
| Logout | Clear in-memory draft state; do not delete IDB (same staff convenience) |
| Shared device | Different `staffId` → different draft namespace |
| Auth expiry | Draft flush stops; local data remains encrypted-at-rest by OS/browser |

**Enhancement (Phase A):** Optional "logout clears my drafts" setting — default **off**.

### SR-5: PII in Cloud Mirror

| Field | Cloud |
|-------|-------|
| CNIC, phone, address | Yes (encrypted in transit TLS; at rest Firebase default) |
| Full photo | **No** — local blob only |
| Photo thumb | Yes, max 8KB JPEG |
| Custom fields | Yes (tenant-controlled) |

**Minimization:** Cloud sync can be disabled per tenant (`Registration_Config.draftsCloudSync: false`) — local-only mode.

### SR-6: Firestore Rules (Required for Production)

```
// Design intent — deploy in firestore.rules Phase A release
match /RegistrationDrafts/{tenantId}/items/{docId} {
  allow read: if isTenantStaff(tenantId)
              && resource.data.staffId == callerStaffId();
  allow create, update: if isTenantStaff(tenantId)
              && request.resource.data.staffId == callerStaffId()
              && request.resource.data.tenantId == tenantId
              && request.resource.data.revision is int;
  allow delete: if isTenantStaff(tenantId)
              && resource.data.staffId == callerStaffId();
}
```

Owner override read for support: separate `isMadrasaAdmin()` branch — read-only.

### SR-7: Client Tampering

| Attack | Defense |
|--------|---------|
| Call `emsRegSaveDraft` from console | `emsRegRequire` permission check |
| Load another staffId draft | Key filter + staffId match on load |
| Inject draft into SSOT list | Draft store separate; repo unchanged |
| Oversized payload | 500KB field cap; reject save |

### SR-8: Audit Trail

| Event | Phase A |
|-------|---------|
| Draft save | Optional debug log only (no PII in console) |
| Draft resume | Optional `emsLogSecurityEvent('draft_resume')` |
| Draft delete on approve | Covered by existing registration audit |
| Conflict resolution | Log choice (local/cloud) without field values |

**Recommendation:** Add `draft_conflict_resolved` security event (no PII payload).

---

## 4. Privacy Considerations

| Topic | Handling |
|-------|----------|
| Data retention | 30-day TTL auto-purge |
| Right to erasure | Delete draft UI + logout optional purge |
| Parent data in student draft | Same protection as approved records |
| Export | Drafts excluded from export/import Phase A |

---

## 5. Multi-Device Security

| Risk | Control |
|------|---------|
| Stale draft on lost device | TTL 30 days; cloud `expiresAt` |
| Device theft | OS lock + EMS auth; drafts not accessible without login |
| Conflict overwrite attack | User confirmation required; revision monotonic |

---

## 6. Regression Security

| Phase 1 Control | Phase A Impact |
|-----------------|----------------|
| `emsRegRequire` on save | Unchanged |
| Duplicate detection | Runs on approve, not draft save |
| Permission snapshot offline | Draft permission uses same cache |
| Audit on approve | Unchanged |

**Verify:** Draft save does **not** bypass duplicate detection prematurely (duplicates checked only on approve — acceptable; draft may hold duplicate CNIC until submit).

---

## 7. Security Test Plan

| Test | Expected |
|------|----------|
| Teacher cannot save draft | Blocked at API |
| Staff A loads Staff B draft key | Returns null / denied |
| Parent opens registration | No draft UI |
| Console `emsRegSaveDraft` without perm | false + security log |
| Cloud rule: wrong staffId write | Firestore reject |
| Oversized draft | Rejected client-side |
| Feature flag off | No draft attack surface |

---

## 8. Open Items / Ops

| Item | Owner | Phase |
|------|-------|-------|
| Deploy Firestore rules | Ops | Before cloud sync enable |
| Tenant opt-out cloud sync | Admin UI | Phase A or A+ |
| Encrypt draft at rest (app-level) | Defer | Phase 2+ |
| Pen test draft endpoints | Security | Post-implementation |

---

## 9. Risk Acceptance

| Risk | Acceptance |
|------|------------|
| Local IDB readable on unlocked device | Accepted (same as repo mirror today) |
| ≤2s data loss on crash | Accepted (recovery scenarios doc) |
| Cloud holds PII fields | Accepted with rules + TLS; thumb-only photo |

---

## 10. Approval

| Role | Status |
|------|--------|
| Architecture | Pending |
| Security | Pending |
| Product | Pending |

**Implementation blocked until approved.**

---

*Related: `REGISTRATION_PHASEA_ARCHITECTURE.md`, `REGISTRATION_PHASEA_DATABASE_DESIGN.md`*
