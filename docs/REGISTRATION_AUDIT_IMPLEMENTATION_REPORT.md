# Registration Audit Trail — Implementation Report

**Sprint:** 4 (Week 7–8)  
**Date:** 9 July 2026  
**Status:** ✅ COMPLETE  
**Scope:** Registration department only

---

## Goal

Make every important Registration mutation traceable with offline-first audit logging, field-level edit diffs, and safe cloud sync — without blocking saves.

---

## Architecture

```
emsRegLogAudit(action, entityId, details)
  → buildEntry (user, role, tenant, device, session, timestamp)
  → appendLocalLog (IDB KV — always, survives reload)
  → tryCloudSync
       ├─ online + Firebase → Firestore EmsAudit
       └─ offline / fail → reg_audit_outbox queue
  → emsRegAuditFlushQueue on 'online' + post-auth-ready
```

**Local keys (per tenant):**
- `{tenantId}__reg_audit_log` — append-only timeline (max 10,000)
- `{tenantId}__reg_audit_outbox` — pending cloud sync (max 5,000)

---

## Actions Logged

| Action | Trigger | File |
|--------|---------|------|
| `create` | New approved record | `admission.js` |
| `edit` | Update existing approved | `admission.js` |
| `restore` | Rejected → approved | `admission.js` |
| `reject` | Reject to history | `admission.js` |
| `delete` | Permanent delete | `admission.js` |
| `duplicate_override` | Owner hard-dup override | `admission.js` |
| `print_letter` | Admission letter print | `admission.js` |
| `print_idcard` | ID card print | `ems-idcard.js` |
| `import` | Bulk import commit | `ems-import-export.js` |
| `export` | Data export (json/csv/xlsx/pdf) | `ems-import-export.js` |

---

## Log Entry Schema

Each entry includes:

| Field | Source |
|-------|--------|
| `action` | Event type |
| `entityId` | Record or batch id |
| `uid` / `email` | Firebase auth user |
| `actorName` / `actorRole` | Staff context |
| `tenantId` | Current tenant |
| `timestamp` / `clientTs` | Client time |
| `device` | userAgent, platform, screen, online, deviceId |
| `sessionId` | `emsGetLoginSessionId` |
| `details.changes` | Field diff (edit) via `emsRegDiffRecord` |
| `details.beforeSummary` / `afterSummary` | Masked snapshot |
| `details.reason` | Duplicate override / required context |
| `synced` / `syncedAt` / `cloudId` | Cloud sync state |

---

## Offline-First Guarantee

| Scenario | Behavior |
|----------|----------|
| Offline save | Local log written immediately; outbox queued |
| Online save | Local + immediate Firestore write |
| Cloud write fail | Outbox queue; flush retries on reconnect |
| Main registration save | **Never blocked** — audit is fire-and-forget |
| Page reload | Logs persist in IDB KV |

---

## Permission Visibility

| Viewer | Access |
|--------|--------|
| Owner / Madrasa admin | Full audit trail |
| Staff with admission view/edit | Trail visible; CNIC/phone masked in diffs |
| Staff without admission access | Empty trail (`emsRegCanViewAudit`) |

Sprint 5 granular permissions not started — uses existing admin/staff checks only.

---

## API Surface

| Function | Purpose |
|----------|---------|
| `emsRegLogAudit(action, entityId, details)` | Write audit (non-blocking) |
| `emsRegDiffRecord(before, after)` | Field-level change array |
| `emsRegGetAuditTrail(entityId, opts)` | Read local timeline |
| `emsRegAuditFlushQueue()` | Sync outbox to Firestore |
| `emsRegCanViewAudit()` | Read permission gate |
| `emsRegSanitizeAuditEntryForViewer(entry)` | Mask PII for staff |
| `emsRegResolveRegistrationAction(opts)` | Map save path → action code |

---

## Tests

`tests/unit/ems-registration-audit-s4.test.js` — **11 tests:**

- create log
- edit log + diff
- delete log
- duplicate override log
- import hook (static)
- offline outbox queue
- permission visibility / masking
- action resolver
- loader wiring
- admission wiring

---

## Score Impact (Target)

| Dimension | Before | After Sprint 4 |
|-----------|--------|----------------|
| Security | 65 | **72** |
| Architecture | 80 | **82** |
| Global Readiness | 48 | **52** |

---

## Deferred (Phase 1b)

- Per-record audit viewer modal in Registration UI
- Firestore rules append-only enforcement (ops)
- Audit retention policy UI

---

## Next Sprint

Sprint 5 — Registration Permissions (do not start until user confirms Sprint 4 acceptance).
