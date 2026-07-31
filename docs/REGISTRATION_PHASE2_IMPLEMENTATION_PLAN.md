# Registration Phase 2 — Phased Implementation Plan

**Date:** 9 July 2026  
**Prerequisite:** Phase 1 closed (78/100)  
**Target:** ~90/100 overall  
**Rule:** **Do not implement all features at once.** One phase at a time; stakeholder approval before coding each phase.  
**Status:** PLANNING ONLY — no code started

---

## Delivery Phases Overview

| Phase | Features | Duration | Cumulative Score Δ (est.) |
|-------|----------|----------|---------------------------|
| **A** | Draft Admission, Auto Save | 3 weeks | +3 UX |
| **B** | Student Timeline, Duplicate Prediction | 4 weeks | +4 UX, +2 Security |
| **C** | Parent Onboarding, QR Admission | 6 weeks | +8 Global, +3 Mobile |
| **D** | Digital Signature, Approval Workflow | 7 weeks | +10 Global, +8 Security |
| **E** | Analytics, AI Assistant | 8 weeks | +8 Global, +5 UX |
| **Total** | 10 features | **~28 weeks** | **59 → 90 trajectory** |

**Recommended start:** Phase A only, after this plan is approved.

---

## Cross-Cutting Principles (All Phases)

| Principle | Requirement |
|-----------|-------------|
| Offline-first | Every feature declares offline behavior; never block primary save |
| Module isolation | New files under `ems-registration-*.js`; minimal `admission.js` wiring |
| Security | UI + API guards via existing `emsRegCan` / `emsRegRequire` |
| Mobile | ≤768px layouts at design time; reuse Sprint 6 patterns |
| Tests | Dedicated unit suite per phase before approval |
| Backward compat | Feature flags for one release where schema changes |

---

# Phase A — Draft Admission & Auto Save

**Goal:** Eliminate data loss on tab switch, crash, or accidental navigation.  
**Duration:** 3 weeks (2 dev + 1 QA)  
**Approval gate:** Draft survives refresh; auto-save indicator visible; offline verified.

---

## A1 — Draft Admission

### Architecture Design

```
┌──────────────────────────────────────────────────────────┐
│ admission.js form fields                                  │
│   on change (debounced 2s) → emsRegSaveDraft()           │
└────────────────────────┬─────────────────────────────────┘
                         ▼
              ┌──────────────────────┐
              │ ems-registration-    │
              │ drafts.js            │
              │ emsRegSaveDraft      │
              │ emsRegLoadDraft      │
              │ emsRegListDrafts     │
              │ emsRegDeleteDraft    │
              └──────────┬───────────┘
                         ▼
              IDB: {tenantId}__reg_drafts
              Key: {staffId}:{type}  (student|teacher|staff)
              Value: { formData, photoBase64?, updatedAt, draftId }
```

- **One active draft per type per staff member** (not per device — staffId scoped).
- On module open: `emsRegListDrafts()` → topbar badge "ڈرافٹ (2)" → resume modal.
- On successful approve: `emsRegDeleteDraft(type, staffId)`.
- Conflict: if draft `candidateId` matches newly approved record → warn and offer discard.

**Integration points:** `RegistrationModule.init`, `switchRegTab`, `processRegistration`, `resetRegForm`.

### Offline Strategy

| Operation | Offline |
|-----------|---------|
| Save draft | ✅ IDB immediate |
| Load draft | ✅ IDB read |
| List drafts | ✅ Local only |
| Delete on approve | ✅ Local |
| Cross-device draft sync | ❌ Phase A — local device only; cloud sync optional Phase A+ |

Drafts never touch Firestore in Phase A — purely local recovery.

### Mobile Strategy

- Draft badge in `.reg-topbar-tools` (44px tap target).
- Resume modal: full-screen on mobile with "جاری رکھیں" / "نیا فارم" buttons.
- Auto-save toast: bottom snackbar (non-blocking).

### Security Impact

| Risk | Mitigation |
|------|------------|
| Draft contains PII on shared device | Scope by staffId; clear on logout (`emsClearStaffSession`) |
| Unauthorized draft read | Load only if `emsRegCan('create'|'edit')` for type |
| Draft exfiltration | IDB tenant-scoped keys; no cloud in Phase A |

**Security score impact:** Neutral (+0); slight hygiene improvement if logout purge added (+1).

### Database Impact

| Store | Change |
|-------|--------|
| IndexedDB | New object store `{tenantId}__reg_drafts` |
| Firestore | None |
| Repository SSOT | No change to approved records schema |

Optional fields on draft record: `_draftMeta: { staffId, type, updatedAt, version }`.

### Performance Impact

| Aspect | Impact |
|--------|--------|
| Save debounce 2s | Negligible CPU |
| IDB write size | ~5–50 KB per draft (photo base64 largest) |
| Module open | +1 IDB read (<10ms) |
| Memory | One draft cached in memory while editing |

**Mitigation:** Strip photo to thumbnail in draft if >200KB; full photo re-upload on resume.

### Estimated Effort

| Task | Days |
|------|------|
| `ems-registration-drafts.js` module | 3 |
| Wire debounced save + load/resume UI | 2 |
| Topbar draft list + delete | 1 |
| Logout purge + permission guards | 1 |
| Unit tests (10+) | 2 |
| QA offline/crash simulation | 2 |
| **Total** | **~11 dev-days (~2 weeks)** |

---

## A2 — Auto Save

### Architecture Design

Extends A1 — same IDB store, different triggers:

| Trigger | Action |
|---------|--------|
| Field change (debounced 2s) | `emsRegSaveDraft(..., { auto: true })` |
| `beforeunload` / `pagehide` | Synchronous minimal snapshot (sync IDB transaction) |
| Tab switch within registration | Save current panel draft |
| Visual indicator | Green dot + "محفوظ شد" in form footer |

**API addition:**

```javascript
emsRegAutoSaveEnabled(type) → boolean
emsRegGetLastAutoSaveTime(type) → ISO timestamp | null
```

On open: if draft age < 30 days → prompt "آپ کا ناتمام فارم مل گیا — جاری رکھیں؟"

### Offline Strategy

Fully offline — identical to drafts. Auto-save is more frequent draft persistence, not a separate system.

### Mobile Strategy

- Sticky footer bar (mobile): "آخری محفوظ: 2 منٹ پہلے" + green dot.
- `pagehide` critical on mobile browser backgrounding.

### Security Impact

Same as A1. Auto-save increases write frequency — ensure no draft save without staff session.

### Database Impact

Same store as A1; `auto: true` flag in metadata. Purge drafts older than 30 days on module init (background).

### Performance Impact

| Aspect | Impact |
|--------|--------|
| Write frequency | Up to 1 IDB write per 2s while typing — acceptable |
| beforeunload sync write | Must complete <50ms — save slim payload only |
| Storage churn | 30-day TTL rotation prevents bloat |

### Estimated Effort

| Task | Days |
|------|------|
| beforeunload/pagehide handlers | 1 |
| Auto-save indicator UI | 1 |
| Resume prompt on open | 1 |
| TTL purge job | 0.5 |
| Tests + mobile QA | 2 |
| **Total (incremental on A1)** | **~5 dev-days (~1 week)** |

**Phase A combined effort:** ~3 weeks calendar.

---

# Phase B — Student Timeline & Duplicate Prediction

**Goal:** Per-student history view and proactive duplicate hints before save.  
**Duration:** 4 weeks  
**Depends on:** Phase 1 audit trail (S4), duplicates (S3)

---

## B1 — Student Timeline

### Architecture Design

```
┌─────────────────────────────────────────────────────────┐
│ Record row / edit form → "Timeline" button               │
└────────────────────────┬────────────────────────────────┘
                         ▼
              ems-registration-timeline.js
              emsRegGetTimeline(recordId, opts)
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   Local audit      Import history   Print events
   (ems-reg-audit)  (import queue)   (audit tags)
         │               │               │
         └───────────────┴───────────────┘
                         ▼
              Merge + sort by timestamp DESC
              Render modal / side panel (.reg-timeline)
```

**Event types (Phase B scope):**

| Type | Source |
|------|--------|
| `created`, `edited`, `deleted`, `restored`, `rejected` | Sprint 4 audit |
| `duplicate_override` | Audit action |
| `imported` | Import batch metadata |
| `printed` (idcard, letter) | Audit print actions |
| `permission_denied` | Security log (optional, admin only) |

**Future (read-only cross-module, Phase B+):** attendance enrollment, fee assignment — not in initial scope.

**UI:** Modal on desktop; full-screen sheet on mobile. Each event: icon, actor, time, diff summary (reuse `emsRegDiffRecord` output).

### Offline Strategy

| Mode | Behavior |
|------|----------|
| Offline | Timeline from local IDB audit log only |
| Online | Merge local + cloud audit (`emsRegGetAuditTrail` flush first) |
| Stale indicator | Badge if cloud sync pending |

No new writes — read-only view.

### Mobile Strategy

- Full-screen timeline sheet with swipe-to-close.
- Collapsed diff lines; tap to expand before/after.
- Accessible from mobile card "تاریخ" action button.

### Security Impact

| Control | Detail |
|---------|--------|
| `audit_view` permission | Required (existing Sprint 5) |
| PII masking | Reuse audit masking for phone/CNIC in diffs |
| Parent role | No timeline access in Phase B |

**Security impact:** +2 (audit consumption validates Phase 1 investment).

### Database Impact

| Store | Change |
|-------|--------|
| IndexedDB | Read existing audit store — no schema change |
| Firestore | Read `EmsAudit/{tenantId}/...` — no new collections |
| Indexes | Optional local index `recordId → eventIds` if audit scan slow |

### Performance Impact

| Aspect | Impact |
|--------|--------|
| Load timeline | O(n) scan audit entries for recordId — cap display at 100 events, paginate |
| Modal open | Target <200ms local, <800ms with cloud merge |
| Memory | Stream events; don't load full audit DB |

**Optimization:** `emsRegAuditIndexByRecordId` lazy-built in IDB on first timeline open.

### Estimated Effort

| Task | Days |
|------|------|
| `ems-registration-timeline.js` | 4 |
| Merge logic + event normalizers | 2 |
| Modal/sheet UI (desktop + mobile) | 3 |
| Wire to list/edit + permissions | 1 |
| Unit tests | 2 |
| QA | 2 |
| **Total** | **~14 dev-days (~3 weeks)** |

---

## B2 — Duplicate Prediction

### Architecture Design

Extends Sprint 3 rule engine with **pre-save scoring** and fuzzy matching:

```
Field blur / pre-save
        ▼
emsRegPredictDuplicates(candidate, opts)
        │
        ├── Rule hits (D1–D7) → score 100 = block
        ├── Fuzzy name + class → score 40–80 = warn
        ├── Phone partial match → score 60
        └── Sibling pattern (same fname, address) → score 30 = info
        ▼
Inline banner + modal tier:
  block (≥90) | warn (50–89) | info (<50)
```

**Not ML in Phase B** — deterministic fuzzy rules:

- Levenshtein distance on name (Urdu + Latin normalized)
- Same class + similar name prefix
- Shared guardian phone

**API:**

```javascript
emsRegPredictDuplicates(candidate, opts) → { score, tier, matches[] }
emsRegExplainDuplicatePrediction(matchId) → human-readable reason
```

Integrate: blur handlers (extend S3), save gate (soft warn allows proceed with confirm).

### Offline Strategy

| Mode | Behavior |
|------|----------|
| Offline | Predict against local repo SSOT only |
| Online | Optional cloud index lookup for cross-branch (flag off by default) |

Prediction never blocks offline saves beyond existing hard rules.

### Mobile Strategy

- Inline `.reg-dup-warn` banners stack above field (already exists from S3 — extend tiers).
- Prediction sheet on mobile: swipeable match cards with "یہی شخص ہے" / " مختلف شخص".

### Security Impact

| Risk | Mitigation |
|------|------------|
| Information disclosure (enumerate students) | Only show matches to roles with `view` |
| Override abuse | High-score still requires `duplicate_override` |

**Security impact:** +2 (better prevention, fewer manual overrides).

### Database Impact

| Store | Change |
|-------|--------|
| IndexedDB | Optional cache `dup_prediction_index` — normalized name tokens |
| Firestore | None |
| Repository | Read-only scans |

Rebuild index on repo hydrate event (`ems:repo-hydrated`).

### Performance Impact

| Aspect | Impact |
|--------|--------|
| Blur prediction | Must complete <100ms for <5k records — indexed token lookup |
| Full scan fallback | Avoid — use repo page iterator with early exit |
| Index build | Background on idle; ~1s for 10k records |

### Estimated Effort

| Task | Days |
|------|------|
| Fuzzy match engine + normalization | 4 |
| Scoring tiers + UI banners | 2 |
| Index cache + idle build | 2 |
| Integration with S3 save gate | 1 |
| Tests (rules + fuzzy fixtures) | 2 |
| QA | 2 |
| **Total** | **~13 dev-days (~2.5 weeks)** |

**Phase B combined:** ~4 weeks calendar (timeline + prediction parallelizable after week 1).

---

# Phase C — Parent Onboarding & QR Admission

**Goal:** Public admission ingress and automatic parent account linking.  
**Duration:** 6 weeks  
**Depends on:** Phase A drafts (optional), Phase 1 permissions, mobile UX

---

## C1 — QR Admission

### Architecture Design

```
┌─────────────────────────────────────────────────────────────┐
│ Staff: Registration → "QR Admission" tab                       │
│   emsRegGenerateAdmissionQR(tenantId) → URL + printable QR   │
└────────────────────────────┬────────────────────────────────┘
                             ▼
Public URL: /apply/{tenantSlugOrId}
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ apply.html (mobile-first, minimal bundle)                    │
│   Simplified form → submitPublicApplication (Cloud Fn)      │
└────────────────────────────┬────────────────────────────────┘
                             ▼
Firestore: PendingApplications/{tenantId}/{appId}
  status: pending | spam | expired
                             ▼
Staff: "Pending Applications" tab → review → approve/reject
  approve → emsRegPromotePendingToRegistration(appId)
```

**Public form fields (minimal):** name, fname, CNIC/B-Form, phone, class preference, photo, address (optional).

**Cloud Function:** `submitPublicApplication`

- Rate limit: 5/min/IP
- CAPTCHA (reCAPTCHA v3 or hCaptcha)
- Tenant validation
- Duplicate check against existing CNIC (server-side)
- No auth required for submit

**Staff review tab:** New `#reg-pending-panel` in registration ribbon.

### Offline Strategy

| Component | Offline |
|-----------|---------|
| QR generation/display | ✅ Cached tenant URL offline |
| Public submit form | ❌ Online only (by design) |
| Staff review list | ⚠️ Cache last-fetched pending list in IDB; stale badge |
| Promote to registration | Requires online; queue promote in outbox if offline attempt |

**Rationale:** Public ingress cannot be offline; staff can review cached pending when offline with sync on reconnect.

### Mobile Strategy

- Public form: **mobile-first** single column (reuse Sprint 6 CSS tokens).
- Photo: camera capture required path.
- Staff pending list: reuse `.reg-mobile-cards` pattern.
- Printable QR poster: A4 template with madrasa branding.

### Security Impact

| Risk | Level | Mitigation |
|------|-------|------------|
| Spam applications | High | CAPTCHA + rate limit + IP throttle |
| Tenant enumeration | Medium | Opaque slug; no tenant list |
| PII in public transit | High | HTTPS only; minimal fields |
| Unauthorized promote | High | `emsRegRequire('approve')` + server rules |
| XSS on public form | High | Sanitize inputs; CSP on apply page |

**Security impact:** +5 (new attack surface) / +8 after hardening (rules + CAPTCHA + audit).

### Database Impact

| Store | Change |
|-------|--------|
| Firestore | New collection `PendingApplications/{tenantId}/items/{appId}` |
| Firestore rules | Public create-only on pending; staff read/write tenant-scoped |
| IndexedDB | `{tenantId}__reg_pending_cache` for staff offline view |
| Repository SSOT | Promoted records enter normal registration path |

**Schema (pending app):**

```javascript
{
  id, tenantId, status, submittedAt, ipHash,
  name, fname, cnic, phone, classPreference, photoUrl,
  promotedToId: null | 'STD-xxx',
  reviewNotes, reviewedBy, reviewedAt
}
```

### Performance Impact

| Aspect | Impact |
|--------|--------|
| Public submit | CF cold start — target <2s P95 |
| Staff pending list | Paginate 25; index on `status + submittedAt` |
| Promote | Single transaction: create registration + update pending |
| QR PNG generation | Client-side `qrcode.js` — instant |

### Estimated Effort

| Task | Days |
|------|------|
| `apply.html` public form + mobile CSS | 5 |
| Cloud Function + CAPTCHA + rules | 5 |
| Staff pending tab + promote flow | 5 |
| QR generate/print UI | 2 |
| Offline pending cache | 2 |
| Tests + security review | 4 |
| QA (real devices) | 3 |
| **Total** | **~26 dev-days (~5 weeks)** |

---

## C2 — Parent Onboarding

### Architecture Design

```
Student approved (processRegistration)
        ▼
emsRegOnboardParent(studentRecord, opts)
        │
        ├── Find/create parent by phone/email
        ├── Create Parent_Links/{parentUid} ↔ studentId
        ├── Generate temp password or magic link
        ├── Notify via SMS/WhatsApp/email (CF)
        └── Audit: parent_onboarded
        ▼
Parent portal: existing pp-content shows linked student
```

**Trigger modes:**

| Mode | When |
|------|------|
| Auto | On student approve if `EMS_REG_AUTO_PARENT_ONBOARD=true` |
| Manual | Staff button "والد اکاؤنٹ بنائیں" on record |
| Batch | Nightly job for approved students without link |

**Sibling detection:** Same `fname` + similar address + guardian phone → suggest merge link (UI only, not auto).

**Integration:** `parent-portal.js`, `admin-panel.js` parent window, existing `emsGetLinkedStudentIds`.

### Offline Strategy

| Operation | Offline |
|-----------|---------|
| Trigger onboard on approve | Queue in outbox `{ type: 'parent_onboard', studentId }` |
| Manual onboard button | Disabled offline with toast |
| Parent login | Existing auth — online |

Process queue on reconnect via `ems-offline-write.js` extension.

### Mobile Strategy

- Onboard button on mobile record cards.
- SMS/deep link opens parent portal PWA on phone.
- Temp password shown once in modal — copy button 44px.

### Security Impact

| Risk | Mitigation |
|------|------------|
| Wrong parent linked | Confirm phone match; owner override |
| Temp password intercept | SMS provider TLS; short TTL; force change on first login |
| Mass account creation | Owner/admin permission `parent_onboard` |
| Student data leak to wrong parent | Verify guardian phone matches record |

**Security impact:** +6 (new accounts) — requires new permission action.

### Database Impact

| Store | Change |
|-------|--------|
| Firestore | `Parent_Links/{tenantId}/{linkId}`, optional `ParentAccounts` |
| Auth | Firebase Auth user create (CF admin SDK) |
| IndexedDB | Mirror link status for offline staff view |
| Registration record | Optional `parentUid`, `parentOnboardedAt` fields |

### Performance Impact

| Aspect | Impact |
|--------|--------|
| Approve path | +async CF call — must not block save (fire-and-forget queue) |
| Auth user create | ~500ms CF — acceptable async |
| Batch job | Nightly; paginated |

### Estimated Effort

| Task | Days |
|------|------|
| `ems-registration-parent-onboard.js` | 4 |
| Cloud Function (auth + link + notify) | 5 |
| UI triggers + sibling suggest | 3 |
| Offline outbox integration | 2 |
| Admin permission + audit | 1 |
| Tests + QA | 4 |
| **Total** | **~19 dev-days (~4 weeks)** |

**Phase C combined:** ~6 weeks (QR first 5 weeks, parent onboard overlaps weeks 4–6).

---

# Phase D — Digital Signature & Approval Workflow

**Goal:** Captured signatures and configurable multi-step approval.  
**Duration:** 7 weeks  
**Depends on:** Phase 1 permissions (S5), Phase C pending apps (optional integration)

---

## D1 — Digital Signature

### Architecture Design

```
┌─────────────────────────────────────────────────────────────┐
│ Signature pad modal (canvas) — touch + mouse                │
│   roles: staff_approval | parent_acknowledgment               │
└────────────────────────┬────────────────────────────────────┘
                         ▼
              emsRegCaptureSignature(recordId, role, pngBlob)
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
   Offline: IDB blob              Online: Firebase Storage
   {tenantId}__reg_signatures     signatures/{tenantId}/{recordId}_{role}.png
         │                               │
         └───────────────┬───────────────┘
                         ▼
              Record.signatures: { staffApproval: url, parentAck: url }
              Embed in letter PDF / ID card template
```

**Libraries:** Signature Pad (MIT, lightweight) — no new heavy deps.

**Wire points:** Approve button (staff sign optional/required per tenant config), letter print, parent portal ack flow (Phase C2).

### Offline Strategy

| Mode | Behavior |
|------|----------|
| Capture offline | PNG base64 in IDB draft + signature store |
| Display on letter | Use local blob if cloud URL missing |
| Sync | Upload via `ems-offline-write` mutation on reconnect |
| Conflict | Last-write-wins per role slot |

### Mobile Strategy

- Full-width signature canvas on mobile (landscape hint).
- Clear / Undo / Save buttons min 48px height.
- Parent acknowledgment: mobile portal sheet.

### Security Impact

| Risk | Mitigation |
|------|------------|
| Signature forgery | Bind to logged-in staffId + audit entry |
| Storage tampering | Storage rules: tenant-scoped write |
| Non-repudiation | Not legal-grade PKI — disclose in terms; audit timestamp + user |
| Unauthorized capture | `emsRegRequire('approve')` or parent auth |

**Security impact:** +4 (integrity trail); not full e-signature compliance.

### Database Impact

| Store | Change |
|-------|--------|
| IndexedDB | `{tenantId}__reg_signatures` blobs + upload queue |
| Firebase Storage | New path `signatures/{tenantId}/...` |
| Firestore record | `signatures: { staffApprovalUrl, parentAckUrl, capturedAt }` |
| Branding | Optional default signatory image fallback |

### Performance Impact

| Aspect | Impact |
|--------|--------|
| Canvas capture | <50ms |
| PNG size | ~20–80 KB — compress to JPEG 0.85 if >100KB |
| Letter embed | Async load blob URL — cache in memory |
| Storage upload | Background; non-blocking approve |

### Estimated Effort

| Task | Days |
|------|------|
| Signature pad component + modal | 3 |
| `ems-registration-signatures.js` | 3 |
| Storage upload + offline queue | 3 |
| Letter/ID card embed | 2 |
| Tenant config (required/optional) | 1 |
| Tests + QA mobile touch | 3 |
| **Total** | **~15 dev-days (~3 weeks)** |

---

## D2 — Approval Workflow

### Architecture Design

```
Registration_Config/{tenantId}/workflow
  steps: [
    { id: 'reception', role: 'staff', perm: 'approve1' },
    { id: 'supervisor', role: 'admin', perm: 'approve2' },
    { id: 'owner', role: 'owner', perm: 'approve' }
  ]

Record.workflow: {
  status: 'pending' | 'review_1' | 'review_2' | 'approved' | 'rejected',
  currentStep: 1,
  history: [{ step, by, at, action, notes }]
}
```

**State machine:**

```
pending → review_1 → review_2 → approved → (existing SSOT)
   ↘ rejected (any step)
```

**UI:**

- Progress bar on form header (mobile: compact step dots).
- "Advance" / "Reject" buttons per step permission.
- Pending queue filter in list tab.

**Notifications (optional Phase D+):** SMS/email on step change via CF.

**Integration:** Extends `processRegistration` — final approve only at terminal step.

### Offline Strategy

| Operation | Offline |
|-----------|---------|
| Advance step | ✅ Local state + audit + outbox mutation |
| View workflow status | ✅ From record in IDB |
| Config edit | Online only (owner) |
| Notification | Queued until online |

Workflow advance uses same pattern as audit — never block UI.

### Mobile Strategy

- Step dots in `.reg-form-header` on mobile.
- Swipe between pending queue cards filtered by "my step".
- Reject requires reason modal (textarea 16px font).

### Security Impact

| Risk | Mitigation |
|------|------------|
| Step skipping | Server rules validate transition; client guards |
| Privilege escalation | Map steps to existing `approve1`/`approve2`/`approve` |
| Audit gap | Every transition → `emsRegLogAudit` |
| Config tampering | Owner-only write on `Registration_Config` |

**Security impact:** +8 (separation of duties — major enterprise gap closed).

### Database Impact

| Store | Change |
|-------|--------|
| Firestore | `Registration_Config/{tenantId}`, record `workflow` field |
| IndexedDB | Workflow state on record mirror |
| Rules | CF or rules validate state transitions |
| Permissions | Wire `approve1`, `approve2` in `ems-registration-permissions.js` |

### Performance Impact

| Aspect | Impact |
|--------|--------|
| Step advance | +1 audit write — negligible |
| Pending filter | Index `workflow.status + currentStep` |
| Config load | Once per session — cache in memory |

### Estimated Effort

| Task | Days |
|------|------|
| Workflow engine + state machine | 5 |
| Config UI (owner) | 3 |
| Record UI progress + actions | 4 |
| Server validation (CF or rules) | 4 |
| Offline outbox + audit | 2 |
| Pending queue filters | 2 |
| Tests (transitions, escalation) | 4 |
| QA | 3 |
| **Total** | **~27 dev-days (~5 weeks)** |

**Phase D combined:** ~7 weeks (signatures 3 weeks, workflow 5 weeks — overlap weeks 4–7).

---

# Phase E — Analytics & AI Assistant

**Goal:** Registration intelligence dashboard and staff assistance.  
**Duration:** 8 weeks  
**Depends on:** Phase B timeline/audit, Phase 1 search, optional Phase D workflow

---

## E1 — Analytics

### Architecture Design

```
┌─────────────────────────────────────────────────────────────┐
│ Registration → "تجزیات" tab (#reg-analytics-panel)           │
└────────────────────────┬────────────────────────────────────┘
                         ▼
              ems-registration-analytics.js
              emsRegGetAnalytics(metric, range, opts)
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   Local IDB         Nightly CF        Chart.js render
   (offline agg)     aggregateRegStats  (existing lib)
```

**Metrics (Phase E minimum):**

| Metric | Chart | Source |
|--------|-------|--------|
| Admissions/month | Line | Audit create events |
| By class | Bar | Record `class` field |
| Student/teacher/staff mix | Pie | Record `type` |
| Rejection rate | KPI % | Rejected / total |
| Import volume | Timeline | Import history |
| Duplicate overrides | Alert count | Audit action |
| Pending queue depth | Gauge | Workflow/QR pending |
| Class capacity | Gauge | Class settings vs enrolled |

**Nightly CF:** `aggregateRegistrationStats(tenantId)` → `Registration_Stats/{tenantId}/daily/{date}`

**Offline:** Compute lightweight stats from local IDB sample; show "approximate (offline)" badge.

### Offline Strategy

| Mode | Behavior |
|------|----------|
| Offline | Local rollup from IDB (last known + delta) |
| Online | Prefer cloud aggregates; refresh button |
| Sync | Pull daily stats doc on module open |

### Mobile Strategy

- Analytics tab: scrollable card grid (one chart per card).
- KPI numbers large (32px) for headmaster glance.
- Export CSV — desktop primary; mobile share sheet optional.

### Security Impact

| Risk | Mitigation |
|------|------------|
| Cross-tenant stats leak | Tenant-scoped queries only |
| PII in aggregates | Aggregates only — no names in charts |
| Staff see sensitive KPIs | `emsRegCan('analytics_view')` new action |

**Security impact:** +2 (new read scope — permission required).

### Database Impact

| Store | Change |
|-------|--------|
| Firestore | `Registration_Stats/{tenantId}/daily/{date}` |
| IndexedDB | `{tenantId}__reg_analytics_cache` |
| CF scheduled | Daily aggregator |

### Performance Impact

| Aspect | Impact |
|--------|--------|
| Nightly agg | Server-side — no client impact |
| Dashboard load | <1s from cache; charts lazy render |
| Local offline rollup | Cap scan at 10k records or use maintained counters |

**Optimization:** Maintain increment counters on approve/reject in IDB (`stats_counters`).

### Estimated Effort

| Task | Days |
|------|------|
| Aggregator CF + schema | 4 |
| Client analytics module | 4 |
| Chart UI (8 metrics) | 5 |
| Offline approximate mode | 2 |
| Permission + tab wiring | 1 |
| Tests + QA | 3 |
| **Total** | **~19 dev-days (~4 weeks)** |

---

## E2 — AI Assistant

### Architecture Design

```
┌─────────────────────────────────────────────────────────────┐
│ Registration chat widget + field blur hooks                  │
└────────────────────────┬────────────────────────────────────┘
                         ▼
              ems-registration-ai.js
              emsRegAiAssist(intent, payload, opts)
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
   Online: ems-ai-client            Offline: rule fallback
   (existing AI stack)              emsRegAiRulesFallback
```

**Capabilities (prioritized):**

| Priority | Capability | Offline fallback |
|----------|------------|------------------|
| P1 | Incomplete field alert on save | Rule-based required fields |
| P1 | Phone/CNIC format correction | Regex validators |
| P2 | Fuzzy duplicate explanation | Phase B prediction text |
| P2 | Natural language search parse | Keyword tokenization only |
| P3 | "How many admitted this month?" | Local stats counter |
| P3 | Free-form Q&A | "Offline — try analytics tab" |

**Privacy:** Send field names + redacted values (CNIC masked `*****-*******-*`); never full photo.

**Guard:** Existing `ems-ai-guard-client.js` for tenant policy.

### Offline Strategy

| Mode | Behavior |
|------|----------|
| Offline | Rules-only — no LLM calls |
| Online | AI with guard + rate limit |
| Cache | Last 5 assistant responses session-only |

### Mobile Strategy

- Collapsible FAB chat bubble (bottom-right, safe-area aware).
- Voice input optional Phase E+ — not initial scope.
- Suggestions as chips above keyboard.

### Security Impact

| Risk | Mitigation |
|------|------------|
| PII to LLM | Redaction pipeline; opt-out tenant setting |
| Prompt injection via name fields | Sanitize; guard client |
| Cost abuse | Rate limit per staff per hour |
| Wrong AI advice | Disclaimer; human confirm on actions |

**Security impact:** +3 with guard; -2 if misconfigured — net +1 with audit.

### Database Impact

| Store | Change |
|-------|--------|
| Firestore | Optional `Ai_Usage_Log/{tenantId}` for billing |
| IndexedDB | None (session only) |
| Config | `Registration_Config.aiEnabled` flag |

### Performance Impact

| Aspect | Impact |
|--------|--------|
| Blur assist | Debounce 500ms; offline rules <20ms |
| Chat query | 1–3s LLM — async non-blocking |
| Search NL parse | Optional pre-process before `emsRegSearchRouter` |

### Estimated Effort

| Task | Days |
|------|------|
| `ems-registration-ai.js` wrapper | 3 |
| Rule fallback engine | 3 |
| Chat widget UI (mobile + desktop) | 4 |
| NL search preprocessor (P2) | 3 |
| Guard integration + redaction | 2 |
| Tenant opt-out setting | 1 |
| Tests + QA | 4 |
| **Total** | **~20 dev-days (~4 weeks)** |

**Phase E combined:** ~8 weeks (analytics 4 weeks, AI 4 weeks — parallel after analytics schema stable).

---

## Phase Dependencies Graph

```
Phase A (Drafts)
    │
    ├──► Phase B (Timeline uses audit; Prediction extends duplicates)
    │
    └──► Phase C (QR pending → optional draft for staff review)
              │
              └──► Phase C2 (Parent onboard on approve)
                        │
                        └──► Phase D (Signatures on approve; Workflow on pending+internal)
                                  │
                                  └──► Phase E (Analytics on audit/workflow; AI on prediction+search)
```

**Critical path:** A → B → C → D → E (recommended serial approval gates).

---

## Effort Summary

| Phase | Features | Dev Days | Calendar |
|-------|----------|----------|----------|
| A | Draft + Auto Save | 16 | 3 weeks |
| B | Timeline + Prediction | 27 | 4 weeks |
| C | QR + Parent Onboard | 45 | 6 weeks |
| D | Signature + Workflow | 42 | 7 weeks |
| E | Analytics + AI | 39 | 8 weeks |
| **Total** | **10 features** | **~169 dev-days** | **~28 weeks** |

*Assumes 1–2 developers registration-focused; QA parallel in last week of each phase.*

---

## Approval Gates (Each Phase)

| Gate | Criteria |
|------|----------|
| Design | This document section approved |
| Implementation | Feature complete + unit tests green |
| Security | Escalation / spam / PII review for applicable features |
| Mobile | Manual test 360px + tablet |
| Stakeholder | Explicit user approval before next phase |

---

## What We Are NOT Doing in Phase 2 Initial Plan

- Document OCR (was in older roadmap — defer to Phase 2b or separate track)
- Full UI redesign (`REGISTRATION_UI_REDESIGN_PROPOSAL.md` — incremental only)
- Cross-module timeline writes (attendance/finance read-only later)
- Legal-grade digital signature (PKI / government e-sign standards)

---

## Recommended Immediate Next Action

1. **Approve** `REGISTRATION_PHASE2_IMPLEMENTATION_PLAN.md` (this document).
2. **Approve Phase A** scope only.
3. Begin implementation: `ems-registration-drafts.js` — **no other Phase 2 code until Phase A gate passes.**

---

*Planning complete. No code changes made. Phase 1 documents: `REGISTRATION_PHASE1_FINAL_REPORT.md`, `REGISTRATION_NEW_SCORES.md`, `REGISTRATION_PHASE1_LESSONS_LEARNED.md`.*
