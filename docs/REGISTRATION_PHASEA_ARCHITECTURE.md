# Phase A — Draft Admission & Auto Save: Architecture

**Phase:** 2A (Draft Admission + Auto Save)  
**Date:** 9 July 2026  
**Status:** DESIGN — awaiting approval before implementation  
**Scope:** Registration department only  
**Phases B–E:** LOCKED

---

## 1. Purpose

Eliminate admission data loss from tab switches, browser crashes, power failure, or session interruption — while preserving Phase 1 offline-first guarantees and causing **zero regression** when drafts are disabled or unused.

---

## 2. Goals & Non-Goals

### Goals

| # | Goal |
|---|------|
| G1 | Fully offline-first draft persistence (IndexedDB) |
| G2 | Auto-save on every meaningful form change (debounced) |
| G3 | Crash/power-loss recovery via synchronous emergency snapshot |
| G4 | Resume incomplete admission after app/browser restart |
| G5 | Multi-device safe via cloud draft mirror + conflict rules |
| G6 | Mobile-friendly resume UX (Sprint 6 patterns) |
| G7 | No regression to approve/reject/edit/list flows |

### Non-Goals (Phase A)

- Cloud draft sync is **best-effort** — local IDB is authoritative while offline
- Draft workflow approval (multi-step) — Phase D
- Public QR admission drafts — Phase C
- OCR / document attachments beyond existing photo field
- Cross-tenant draft sharing

---

## 3. System Context

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Registration UI (existing)                       │
│  admission.js · registration-ui.js · ems-registration-mobile.js         │
│  index.html — student / teacher / staff panels                          │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ thin hooks (feature-flagged)
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              NEW: ems-registration-drafts.js                             │
│  emsRegDraftInit · Collect · Save · Load · List · Delete · Sync         │
└───────┬─────────────────────────────┬───────────────────────────────────┘
        │                             │
        ▼                             ▼
┌───────────────────┐       ┌─────────────────────────────────────────────┐
│ Local SSOT        │       │ Cloud mirror (online, async, non-blocking)    │
│ IndexedDB KV      │       │ Firestore: RegistrationDrafts/{tenant}/...   │
│ + photo blob keys │       │ Outbox: {tenant}__reg_draft_outbox            │
└───────────────────┘       └─────────────────────────────────────────────┘
        │                             │
        └───────────┬─────────────────┘
                    ▼
        Existing (unchanged primary path)
        ems-registration-repository.js → approve/reject → SSOT records
```

**Loader order (post-auth):** after `ems-registration-permissions.js`, before `ems-cloud-pull.js`  
**Lazy load (admission tab):** after `ems-registration-mobile.js`, before `admission.js`

---

## 4. Core Module: `ems-registration-drafts.js`

### 4.1 Public API

| Function | Purpose |
|----------|---------|
| `emsRegDraftEnabled()` | Feature flag + tenant setting |
| `emsRegDraftInit()` | Bind listeners, TTL purge, sync pull |
| `emsRegCollectFormSnapshot(type)` | Serialize current panel → plain object |
| `emsRegApplyFormSnapshot(type, snapshot)` | Hydrate DOM from snapshot |
| `emsRegSaveDraft(type, opts)` | Debounced / emergency / tab-switch save |
| `emsRegLoadDraft(type, opts)` | Load local; merge cloud if newer |
| `emsRegListDrafts(opts)` | All drafts for current staff + tenant |
| `emsRegDeleteDraft(type, opts)` | Remove local + queue cloud delete |
| `emsRegDraftFlushSync()` | Process outbox (online) |
| `emsRegDraftGetStatus(type)` | `{ lastSavedAt, dirty, source, deviceId }` |
| `emsRegDraftPurgeSession()` | Logout / tenant switch cleanup |

### 4.2 Feature Flag

```javascript
// Default false until Phase A approved for production rollout
window.EMS_REG_DRAFTS_ENABLED = (window.EMS_REG_DRAFTS_ENABLED !== false);
// Per-tenant override via Registration_Config (future); Phase A uses global flag only
```

When `EMS_REG_DRAFTS_ENABLED === false`: all API functions no-op; **zero** admission.js behavior change.

---

## 5. Data Flow

### 5.1 Auto-Save (Normal Path)

```
User edits field
    → input/change event (delegated on #module-admission)
    → debounce 1500ms (meaningful change filter)
    → emsRegCollectFormSnapshot(currentRegType)
    → emsRegSaveDraft(type, { reason: 'auto' })
        → IDB write (sync transaction for metadata; async for photo)
        → update UI indicator ("محفوظ شد · 12:04")
        → queue cloud mirror if online (async, non-blocking)
```

**Meaningful change:** any input/textarea/select change; custom field events from `sysFieldCollect`; photo change.  
**Ignored:** programmatic resets, hydration from draft, readonly fields (form-no when not editing).

### 5.2 Emergency Save (Crash / Power Loss)

```
beforeunload / pagehide / visibilitychange(hidden)
    → emsRegSaveDraft(type, { reason: 'emergency', sync: true })
        → slim snapshot (no photo re-encode; reference existing blob key)
        → IDB synchronous-capable write via existing emsIdbKvSet
        → must complete < 50ms (metadata only in emergency path)
```

Photo already saved on prior debounced auto-save; emergency path updates field snapshot only.

### 5.3 Resume on Module Open

```
emsOpenRegistration() / RegistrationModule.init()
    → emsRegDraftInit()
    → emsRegListDrafts()
    → if drafts exist: show resume modal (mobile full-screen sheet)
        → "جاری رکھیں" → emsRegLoadDraft + emsRegApplyFormSnapshot
        → "نیا فارم" → emsRegDeleteDraft (confirm if dirty)
    → if single draft for active tab: optional inline banner instead of modal
```

### 5.4 Successful Registration

```
processRegistration → finishRegistrationSave (success)
    → emsRegDeleteDraft(type)  // local + cloud delete queued
    → existing resetRegForm(type) unchanged
```

### 5.5 Tab Switch Within Registration

```
switchRegTab(newPanel)
    → emsRegSaveDraft(previousRegType, { reason: 'tab_switch' })
    → existing tab logic (unchanged)
    → if target panel has draft: soft prompt (not blocking) "ڈرافٹ لوڈ کریں؟"
```

---

## 6. Form Snapshot Design

### 6.1 Collector Strategy

Extract field reads from `processRegistration` into shared collector to **avoid drift**:

```javascript
// ems-registration-drafts.js
emsRegCollectFormSnapshot(type) → {
  version: 1,
  type: 'student' | 'teacher' | 'staff',
  fields: { /* mirrors processRegistration user object */ },
  terms: { text, locked: boolean },
  customFields: { ... },          // sysFieldCollect
  meta: {
    editingId: string | null,
    isEditingRejected: boolean,
    proposedId: string,           // stu-form-no / tch-emp-id / stf-emp-id
    panelScrollY: number          // optional mobile UX
  },
  photo: {
    hasPhoto: boolean,
    blobKey: string | null,       // local IDB blob reference
    thumbBase64: string | null    // max 8KB JPEG for cloud mirror
  }
}
```

**Regression guard:** `processRegistration` continues reading DOM directly; collector duplicates read logic initially, with optional Phase A refactor to single `emsRegBuildUserFromForm(type)` used by both (recommended in implementation).

### 6.2 Photo Handling

| Layer | Strategy |
|-------|----------|
| Local | Full base64/blob in `{tenantId}__reg_draft_photo_{draftKey}` |
| Draft record | Store `blobKey` + optional 8KB thumbnail |
| Cloud mirror | Thumbnail only in Firestore doc (size cap); full photo stays device-local until approve |
| Multi-device | Other device shows fields + "تصویر دوسرے آلے پر — دوبارہ اپلوڈ کریں" if no local blob |

---

## 7. Multi-Device Architecture

Local IDB is **device-fast SSOT**. Cloud mirror enables cross-device resume.

```
Device A (phone)                    Firestore                           Device B (tablet)
     │                    RegistrationDrafts/{tenantId}/items/              │
     │                    {staffId}_{type}                                  │
     ├─ auto save ───────► merge write (updatedAt, revision++) ◄───────────┤ pull on init
     │                    deviceId, fields, meta, photoThumb                 │
     └─ offline queue ───► outbox flush when online ───────────────────────►
```

### Conflict Resolution

| Case | Resolution |
|------|------------|
| Local newer (`updatedAt`) | Local wins; cloud overwrite on next sync |
| Cloud newer | Show conflict modal: "دوسرے آلے کا ڈرافٹ" — **Use cloud** / **Keep local** / **Compare** |
| Same revision | No-op |
| Edit mode (`meta.editingId` set) | Warn if cloud draft edits different record |

**Multi-device safe definition:** No silent data loss across devices; user always confirms when versions diverge by >2s or different `deviceId`.

---

## 8. Integration Points (Minimal Diff)

| File | Change | Regression Risk |
|------|--------|-----------------|
| `ems-registration-drafts.js` | **NEW** | None |
| `ems-post-auth-loader.js` | Add script after permissions | Low |
| `ems-lazy-loader.js` | Add before admission.js | Low |
| `admission.js` | ~40 lines: init hook, tab switch save, post-approve delete, optional collect refactor | Medium — gated by flag |
| `registration-ui.js` | Resume modal trigger on open | Low |
| `index.html` | Draft badge, status bar, resume modal markup | Low |
| `style.css` | `.reg-draft-status`, modal mobile styles | Low |
| `ems-registration-bootstrap.js` | Call `emsRegDraftPurgeSession` on logout | Low |

**No changes to:** repository SSOT, duplicate detection, audit, permissions logic, search, mobile card render (except draft badge).

---

## 9. UI Components

### 9.1 Auto-Save Indicator

- Desktop: `.reg-draft-status` in form footer — "● محفوظ شد" (green) / "محفوظ ہو رہا ہے…" (amber)
- Mobile: sticky footer bar above safe-area (reuse Sprint 6 `.reg-decision-block` spacing)

### 9.2 Draft Badge

- `.reg-topbar-tools`: icon button with count — "ڈرافٹ (n)"
- 44px touch target; opens draft list sheet

### 9.3 Resume Modal

- Lists drafts: type icon, name field preview, last saved relative time, device label
- Actions: Resume / Delete / New form
- Mobile: full-screen sheet; desktop: centered modal

---

## 10. Offline-First Guarantees

| Operation | Blocks UI? | Requires Network? |
|-----------|------------|-------------------|
| Auto-save | No | No |
| Emergency save | No (≤50ms) | No |
| Load draft | No | No |
| Cloud sync | No | Yes (async) |
| Approve/reject | Unchanged | Same as today |

Draft save failures show non-blocking toast; **never** prevent `processRegistration`.

---

## 11. Mobile Strategy

| Requirement | Approach |
|-------------|----------|
| Touch-friendly resume | Full-screen sheet, 48px buttons |
| Auto-save visible | Sticky status bar, 16px font |
| Crash recovery | `pagehide` + Capacitor app pause hook if present |
| Section state | Store `panelScrollY` + last open accordion index in meta |
| Keyboard open | Save on blur; debounce pauses while composing (IME) |

---

## 12. Performance Budget

| Metric | Target |
|--------|--------|
| Debounced save latency | <30ms (fields only) |
| Emergency save | <50ms |
| Photo async save | <500ms background |
| Draft load + hydrate | <200ms |
| IDB draft size | <500KB per draft (fields); photo separate |
| Cloud mirror payload | <32KB (no full photo) |

---

## 13. Testing Strategy (Post-Implementation)

| Suite | Coverage |
|-------|----------|
| `ems-registration-drafts-phasea.test.js` | API, snapshot round-trip, conflict, TTL, flag off |
| Integration | Approve deletes draft; flag off = no hooks |
| Manual | Airplane mode, kill tab, two-device conflict |

---

## 14. Rollout

1. Ship with `EMS_REG_DRAFTS_ENABLED = false`
2. Enable in staging; QA recovery scenarios
3. Enable production default `true` after Phase A approval
4. Monitor IDB quota via existing `ems-storage-quota.js`

---

## 15. Related Documents

| Document | Content |
|----------|---------|
| `REGISTRATION_PHASEA_DATABASE_DESIGN.md` | IDB keys, Firestore schema |
| `REGISTRATION_PHASEA_RECOVERY_SCENARIOS.md` | Crash, restart, multi-device |
| `REGISTRATION_PHASEA_SECURITY_REVIEW.md` | PII, logout, permissions |
| `REGISTRATION_PHASEA_MIGRATION_PLAN.md` | Rollout, flags, rollback |

---

## 16. Approval Checklist

- [ ] Architecture approved
- [ ] Database design approved
- [ ] Recovery scenarios approved
- [ ] Security review approved
- [ ] Migration plan approved
- [ ] **Then** implement Phase A only

---

*No code written. Phases B–E remain locked.*
