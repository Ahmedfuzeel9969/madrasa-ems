# Registration Phase 2 Global Features

**Date:** 9 July 2026  
**Prerequisite:** Phase 1 complete and stable (score ~75/100)  
**Target Score:** ~90/100 overall  
**Duration:** 9 months (3 quarters)

---

## Phase 2 Goal

Transform Registration from a solid offline-first tool into a **globally competitive educational admission system** with workflow automation, intelligence, and parent engagement.

| Dimension | Phase 1 End | Phase 2 Target |
|-----------|-------------|----------------|
| Architecture | 85 | 92 |
| Performance | 80 | 88 |
| Security | 72 | 88 |
| Scalability | 72 | 88 |
| User Experience | 75 | 90 |
| Mobile Readiness | 65 | 85 |
| Global Readiness | 52 | 90 |
| **Overall** | **~75** | **~90** |

---

## Feature 1: Draft Admissions

**Gap:** Long forms lost on tab switch, browser close, or crash.

### Design

| Component | Detail |
|-----------|--------|
| Storage | IDB `{tenantId}__reg_drafts` — one draft per type per staff |
| Auto-trigger | Save draft on field change (debounced 2s) |
| UI | "ڈرافٹ محفوظ" badge on form; draft list in topbar |
| Resume | Open draft → populate form → continue editing |
| Expiry | 30 days; purge on successful approve |
| Conflict | If draft ID matches approved record → warn |

### API

```javascript
emsRegSaveDraft(type, formData, staffId)
emsRegLoadDraft(type, staffId)
emsRegListDrafts(staffId)
emsRegDeleteDraft(draftId)
```

**Sprint:** Q1 Month 1 | **Effort:** 2 weeks

---

## Feature 2: Auto Save

**Gap:** No recovery after crash during data entry.

### Design

- Extends Feature 1 (Draft Admissions)
- `beforeunload` handler saves current form state
- On module open: "آپ کا ناتمام فارم مل گیا — جاری رکھیں؟"
- Visual indicator: green dot on save bar when auto-saved
- Works fully offline (IDB)

**Sprint:** Q1 Month 1 (bundled with Feature 1) | **Effort:** 1 week

---

## Feature 3: QR Admissions

**Gap:** No public-facing admission; staff-only data entry.

### Design

| Component | Detail |
|-----------|--------|
| QR generation | Per-tenant URL: `https://ems.app/apply/{tenantId}` |
| Public form | Mobile-first simplified form (name, fname, CNIC, phone, class preference, photo) |
| Submission | Creates record with `status: 'pending'` in Firestore |
| Staff review | New "Pending Applications" tab in Registration |
| QR print | Include on official letters, ID cards, posters |
| Offline | QR encodes tenant ID; form works online only (by design) |

### Cloud requirements

- New CF: `submitPublicApplication` (rate-limited, CAPTCHA)
- Firestore rules: public create on `Pending/{id}` only
- No authentication required for submission

**Sprint:** Q1 Month 2–3 | **Effort:** 4 weeks

---

## Feature 4: Document OCR

**Gap:** Photo-only upload; no birth certificate, transcript, or CNIC scan.

### Design

| Document | OCR Fields Extracted |
|----------|---------------------|
| CNIC (front) | name, fname, cnic, dob, address |
| B-Form | name, fname, bform number, dob |
| Birth certificate | name, dob, place of birth |
| Previous school cert | school name, class, year |

### Implementation options

| Option | Pros | Cons |
|--------|------|------|
| A: Cloud Vision API (Google) | High accuracy | Cost, needs network |
| B: Tesseract.js (client) | Offline capable | Lower accuracy for Urdu |
| C: Hybrid (client OCR + cloud verify) | Best of both | Complex |

**Recommended:** Option C — Tesseract for offline draft, Cloud Vision on submit.

**Sprint:** Q2 Month 1–2 | **Effort:** 5 weeks

---

## Feature 5: Student Timeline

**Gap:** No per-student history view.

### Design

```
┌─────────────────────────────────────────────────┐
│ STD-042 — محمد علی — Timeline                   │
├─────────────────────────────────────────────────┤
│ ● 09 Jul 2026 — Edit by احمد (reception)       │
│   phone: 0300-1111111 → 0300-2222222           │
│ ● 08 Jul 2026 — Created by Owner               │
│   Class: جماعت ہفتم, Status: Approved           │
│ ● 08 Jul 2026 — ID Card printed by احمد        │
│ ● 07 Jul 2026 — Imported via CSV (batch #42)   │
└─────────────────────────────────────────────────┘
```

### Data sources

- Phase 1 audit trail (`EmsAudit` collection)
- Registration status changes
- Import history
- Print events
- Phase 2: attendance, exam, finance events (cross-module — read only)

**Sprint:** Q1 Month 3 | **Effort:** 3 weeks

---

## Feature 6: Parent Onboarding

**Gap:** Parent portal is read-only; no auto-account creation on admission.

### Design

| Step | Action |
|------|--------|
| 1 | On student approve → check if parent phone/email exists |
| 2 | If not → create `Parent_Links/{uid}` with temp password |
| 3 | Send SMS/WhatsApp: "آپ کا پیرنٹ پورٹل اکاؤنٹ بن گیا" |
| 4 | Parent logs in → sees linked student(s) |
| 5 | Sibling detection: same fname + address → suggest linking |

### APIs

```javascript
emsRegOnboardParent(studentRecord)
  → Create parent account
  → Link to student
  → Send notification
  → Return { parentId, tempPassword, notificationSent }
```

**Sprint:** Q2 Month 3 | **Effort:** 4 weeks

---

## Feature 7: Digital Signatures

**Gap:** No signature capture on admission approval.

### Design

| Component | Detail |
|-----------|--------|
| Capture | Canvas-based signature pad (touch + mouse) |
| Storage | Firebase Storage: `signatures/{tenantId}/{recordId}.png` |
| Usage | Embed on acceptance letters, ID cards |
| Roles | Owner/authorized staff sign approval; parent signs acknowledgment |
| Offline | Save signature as base64 in draft; upload on sync |

**Sprint:** Q2 Month 2 | **Effort:** 2 weeks

---

## Feature 8: Approval Workflow

**Gap:** Binary approve/reject; no multi-step process.

### Design

```
Application Submitted (pending)
  → Reception Review (step 1)
    → Education Supervisor Review (step 2)
      → Owner Final Approval (step 3)
        → Approved → Active Student
```

| Component | Detail |
|-----------|--------|
| States | `pending`, `review_1`, `review_2`, `approved`, `rejected` |
| Config | Per-tenant workflow definition in `Registration_Config` |
| Notifications | SMS/email at each state change |
| Permissions | `approve1`, `approve2` from ADMIN_ACTIONS |
| UI | Status badge on record; workflow progress bar |
| Audit | Each step transition logged |

**Sprint:** Q3 Month 1–2 | **Effort:** 5 weeks

---

## Feature 9: Advanced Analytics

**Gap:** No registration-specific analytics dashboard.

### Metrics

| Metric | Chart Type |
|--------|-----------|
| Admissions per month | Line chart |
| Admissions by class | Bar chart |
| Student/teacher/staff ratio | Pie chart |
| Rejection rate | Percentage |
| Import volume | Timeline |
| Duplicate override count | Alert metric |
| Class capacity utilization | Gauge |
| Geographic distribution | Map (if address data) |

### Implementation

- New tab: "تجزیات" in Registration ribbon
- Data source: Firestore aggregation CF (nightly) + local IDB for offline
- Chart library: Chart.js (already lightweight, no new dependency)

**Sprint:** Q3 Month 2–3 | **Effort:** 4 weeks

---

## Feature 10: AI Assistant

**Gap:** No intelligent assistance for registration staff.

### Capabilities

| Capability | Trigger | Example |
|------------|---------|---------|
| Duplicate detection (fuzzy) | On save | "محمد علی (جماعت ہفتم) پہلے سے موجود ہے" |
| Correction suggestions | On field blur | "فون نمبر 10 ہندسوں کا ہونا چاہیے" |
| Incomplete data alert | On save attempt | "ولدیت اور شناختی نمبر خالی ہیں" |
| Natural language search | Search bar | "جماعت ہفتم کے تمام طلباء" |
| Question answering | Chat widget | "اس سال کتنے طلباء داخل ہوئے؟" |

### Architecture

- Client: `emsRegAiAssist` wrapper
- Server: Existing AI Studio / Cloud Function endpoint
- Offline: Rule-based fallback (no AI, just validation rules)
- Privacy: Send field names + anonymized values only; never full CNIC

**Sprint:** Q3 Month 3 | **Effort:** 4 weeks

---

## Phase 2 Quarterly Schedule

### Q1 (Months 1–3): Foundation Features

| Month | Features | Score Impact |
|-------|----------|-------------|
| 1 | Draft Admissions + Auto Save | UX +8 |
| 2–3 | QR Admissions + Student Timeline | Global +12, UX +5 |
| 3 | Student Timeline (complete) | Security +3 |

### Q2 (Months 4–6): Document & Parent Features

| Month | Features | Score Impact |
|-------|----------|-------------|
| 4–5 | Document OCR | Global +10 |
| 5–6 | Digital Signatures | Global +5 |
| 6 | Parent Onboarding | Global +8, UX +5 |

### Q3 (Months 7–9): Workflow & Intelligence

| Month | Features | Score Impact |
|-------|----------|-------------|
| 7–8 | Approval Workflow | Global +10, Security +8 |
| 8–9 | Advanced Analytics | Global +8 |
| 9 | AI Assistant | Global +7, UX +5 |

---

## Dependencies

| Feature | Depends On |
|---------|-----------|
| Student Timeline | Phase 1 Audit Trail |
| Approval Workflow | Phase 1 Permissions |
| AI Assistant | Phase 1 Duplicate Detection |
| Parent Onboarding | Phase 1 Permissions + QR Admissions |
| Document OCR | Phase 1 Mobile (camera capture) |
| Analytics | Phase 1 Audit Trail + Phase 2 Timeline |

---

## Success Criteria (Phase 2)

- [ ] Overall registration score ≥ 90/100
- [ ] Feature completeness ≥ 75% vs global ERP
- [ ] QR public admission portal live
- [ ] Multi-step approval workflow configurable
- [ ] Parent auto-onboarding on student admission
- [ ] AI assistant available for staff
- [ ] Analytics dashboard with 8+ metrics
- [ ] All Phase 1 tests still pass
- [ ] Offline-first architecture preserved

---

*Phase 2 complete → Registration is world-class; proceed to next department.*
