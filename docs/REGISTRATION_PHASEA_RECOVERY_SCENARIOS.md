# Phase A — Draft Admission & Auto Save: Recovery Scenarios

**Phase:** 2A  
**Date:** 9 July 2026  
**Status:** DESIGN — awaiting approval  
**Purpose:** Define expected behavior for failure, restart, and multi-device cases before implementation

---

## 1. Scenario Matrix

| ID | Scenario | Trigger | Expected Outcome | Data Loss |
|----|----------|---------|------------------|-----------|
| R01 | Normal auto-save | User typing | Debounced save ≤2s; green indicator | None |
| R02 | Browser tab close | Ctrl+W / tab kill | `pagehide` emergency save | None (if ≥1 save occurred) |
| R03 | Browser crash | Process kill | Last debounced + emergency if fired | ≤2s of typing |
| R04 | Power loss | Immediate off | Same as R03 | ≤2s window |
| R05 | App refresh | F5 | Resume modal on reopen | None |
| R06 | EMS tab switch | Dashboard → Registration | Tab-switch save + resume | None |
| R07 | Registration sub-tab switch | Student → Teacher | Save student draft; load teacher if exists | None |
| R08 | Offline entire session | Airplane mode | Local IDB saves; cloud queued | None |
| R09 | Offline → online | Reconnect | Outbox flush; cloud mirror updated | None |
| R10 | Multi-device same staff | Phone then tablet | Conflict modal if diverged | None (user chooses) |
| R11 | Approve success | Save approved | Draft deleted local + cloud | N/A (intentional) |
| R12 | Reject success | Rejected record | Draft deleted | N/A |
| R13 | Cancel edit | Cancel button | Draft retained (user may continue) | None |
| R14 | Explicit new form | "نیا فارم" | Draft deleted after confirm | Intentional |
| R15 | Logout | Logout button | Drafts remain for same staff on device; session purge | None for same user |
| R16 | Shared device different staff | Staff B login | Staff A drafts hidden; B sees own only | None (isolation) |
| R17 | Tenant switch | Change madrasa | Previous tenant drafts purged from memory; keys not read | None per tenant |
| R18 | Edit existing record | Edit from list | Draft tagged `meta.editingId`; separate from new admission draft | None |
| R19 | IDB quota full | Storage pressure | Fields save; photo skipped with warning | Photo only |
| R20 | Feature flag off | `EMS_REG_DRAFTS_ENABLED=false` | Zero draft behavior; legacy flow | N/A |

---

## 2. Detailed Recovery Flows

### R02 / R03 / R04 — Abrupt Termination

**Preconditions:** User entered ≥1 meaningful field; drafts enabled.

```
Timeline:
  T+0s    User edits name
  T+1.5s  Debounced auto-save → IDB ✓
  T+5s    User edits phone
  T+6s    CRASH (no pagehide)
          → phone change lost (within debounce window)
  T+0s    User reopens EMS → Registration
          → emsRegDraftInit()
          → Resume modal: "نام: محمد علی · آخری محفوظ: 5s پہلے"
          → User taps "جاری رکھیں"
          → Form restored except last unsaved field
```

**Acceptance:** ≥95% of fields recovered after crash if user paused typing ≥2s once.

**Mitigation for ≤2s loss:** Emergency save on `visibilitychange(hidden)` and `pagehide` captures in-progress state when OS allows.

---

### R05 — Browser Refresh

```
User fills student form (auto-saved)
  → F5 refresh
  → Auth session persists (Firebase)
  → Registration module lazy-loads
  → emsRegListDrafts() returns 1 student draft
  → Resume modal auto-shown (once per session via sessionStorage flag)
  → User continues
```

**Mobile:** Same flow; full-screen resume sheet.

---

### R06 / R07 — Navigation Within EMS

```
User on student form (partial)
  → Opens Attendance tab (module switch)
  → switchRegTab not fired; module hide event:
      emsRegSaveDraft('student', { reason: 'module_hide' })
  → Returns to Registration
  → Resume banner (non-blocking): "طالب علم کا ڈرافٹ موجود — جاری رکھیں؟"
```

**Sub-tab switch (student → teacher):**

```
  → Save student draft
  → Switch panel
  → If teacher draft exists: inline prompt (not modal overload)
```

---

### R08 / R09 — Offline & Reconnect

```
Offline:
  → All saves → IDB only
  → Indicator: "● محفوظ شد (آف لائن)"
  → Outbox accumulates upserts

Online:
  → emsRegDraftFlushSync() on 'online' event + module open
  → Firestore mirror updated
  → Indicator: "● محفوظ شد · synced"
  → Failure: retry with backoff; local draft still valid
```

**Acceptance:** Offline drafts survive 7+ days (TTL permitting) without network.

---

### R10 — Multi-Device Recovery

```
Device A (phone):
  → Draft saved revision 5 @ 12:00, deviceId=A

Device B (tablet, same staff login):
  → emsRegDraftInit() pulls cloud mirror revision 5
  → User edits → revision 6 @ 12:10, deviceId=B

Device A (online):
  → Auto-save attempts revision 6
  → Detects cloud revision 6 > local 5
  → Conflict modal:
      "Tablet پر تازہ تر ڈرافٹ (12:10)"
      [Tablet version] [This device] [Compare fields]
```

**Compare view:** Side-by-side diff on name, phone, CNIC, class (mobile: stacked).

**Photo:** Device B has thumb; Device A may show re-upload prompt.

**Acceptance:** No silent overwrite across devices.

---

### R11 / R12 — Successful Save Deletes Draft

```
processRegistration('student', 'approved') success
  → finishRegistrationSave()
  → emsRegDeleteDraft('student')
      → Remove IDB keys
      → Queue cloud delete
  → resetRegForm('student')  // unchanged behavior
```

**Regression test:** Approved record in repo identical to pre-Phase A behavior.

---

### R15 / R16 — Logout & Shared Devices

```
Staff A logout:
  → emsRegDraftPurgeSession() clears in-memory state only
  → IDB drafts for STF-A remain on device

Staff B login (same browser):
  → Draft list filtered by staffId=B only
  → Staff A drafts not visible in UI
  → Firestore rules prevent B reading A cloud drafts

Staff A re-login:
  → Drafts visible again
```

**Shared tablet at reception:** Each staff member sees only own drafts.

---

### R18 — Edit Mode Draft

```
User opens edit for STD-042
  → currentEditingId = STD-042
  → Draft meta.editingId = STD-042
  → Auto-save updates draft (not SSOT until approve)

Crash + resume:
  → Restore form with editingId
  → Approve updates existing record (existing path)
```

**Conflict:** If draft `editingId` ≠ cloud draft `editingId`, show warning.

---

### R19 — Storage Quota Exhaustion

```
IDB >90% full:
  → emsRegSaveDraft saves fields only
  → photo.hasPhoto=false in snapshot; blob retained if already saved
  → Toast: "تصویر محفوظ نہیں ہو سکی — جگہ کم ہے"

User frees space / clears old drafts:
  → Next photo change re-saves blob
```

---

### R20 — Feature Flag Disabled (Regression)

```
EMS_REG_DRAFTS_ENABLED = false
  → No listeners bound
  → No resume modal
  → No save on tab switch
  → processRegistration identical to Phase 1
```

**Acceptance:** Vitest regression suite 516+ pass unchanged.

---

## 3. Recovery UX Copy (Urdu)

| State | Message |
|-------|---------|
| Draft found | "آپ کا ناتمام داخلہ فارم مل گیا" |
| Resume | "جاری رکھیں" |
| New form | "نیا فارم شروع کریں" |
| Auto-saved | "● محفوظ شد" |
| Offline saved | "● محفوظ شد (آف لائن)" |
| Saving | "محفوظ ہو رہا ہے…" |
| Conflict | "دوسرے آلے پر تازہ تر ڈرافٹ موجود ہے" |
| Photo missing | "تصویر دوبارہ اپلوڈ کریں" |

---

## 4. QA Test Scripts (Manual)

### Script 1 — Crash recovery
1. Enable drafts; open student form
2. Enter name + phone; wait 3s (auto-save)
3. Kill browser process (Task Manager)
4. Reopen → Registration
5. **Pass:** Resume modal with name + phone

### Script 2 — Offline 24h
1. Airplane mode
2. Fill teacher form; close app
3. Next day: open offline
4. **Pass:** Draft loads; indicator shows offline

### Script 3 — Two devices
1. Phone: fill student name
2. Wait sync (online)
3. Tablet: open registration
4. **Pass:** Same name in resume
5. Tablet: change class; sync
6. Phone: open form
7. **Pass:** Conflict modal

### Script 4 — Regression approve
1. Fill form; approve
2. **Pass:** Record in list; no draft badge; form reset

### Script 5 — Flag off
1. Set `EMS_REG_DRAFTS_ENABLED=false`
2. Repeat Script 1
3. **Pass:** No resume modal; no data recovery (legacy)

---

## 5. Automated Test Mapping

| Scenario | Unit Test |
|----------|-----------|
| R01 | `save debounced merges revision` |
| R05 | `load draft hydrates snapshot` |
| R10 | `cloud newer triggers conflict flag` |
| R11 | `approve deletes draft keys` |
| R15 | `list drafts filters by staffId` |
| R20 | `disabled flag no-ops save` |

---

## 6. Known Limitations (Accepted Phase A)

| Limitation | Mitigation |
|------------|------------|
| ≤2s typing loss on hard kill | Debounce 1.5s + pagehide |
| Full photo not on other device | Thumb + re-upload prompt |
| Cloud sync requires online | Local always works |
| Capacitor iOS background kill | Rely on last debounced save |

---

## 7. Approval Checklist

- [ ] R01–R20 behaviors approved
- [ ] ≤2s data loss window accepted
- [ ] Multi-device conflict UX approved
- [ ] QA scripts approved

---

*Implementation blocked until this document and sibling Phase A docs are approved.*
