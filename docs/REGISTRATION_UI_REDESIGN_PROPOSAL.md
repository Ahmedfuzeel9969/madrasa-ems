# Registration UI Redesign Proposal

**Date:** 9 July 2026  
**Scope:** Registration department UX overhaul  
**Reference:** Fedena, PowerSchool, EduPage, modern school ERP patterns

---

## Design Principles

1. **Fewer clicks** — Most common task (find student) in ≤2 taps
2. **Progressive disclosure** — Show simple view first, details on demand
3. **Role-aware** — Reception sees different UI than teacher
4. **Mobile-first responsive** — Design for 360px, enhance for desktop
5. **Urdu-primary** — RTL, Nastaliq-friendly, minimal English

---

## Current vs Proposed Navigation

### Current (7 flat tabs)

```
[طلباء] [اساتذہ] [عملہ] [برانڈنگ] | [محفوظ ریکارڈ] [مسترد] [ڈیٹا]
```

**Problems:** 7 equal-weight tabs; records tab hidden; branding/import rarely used.

### Proposed (3-tier navigation)

```
TIER 1 — Primary (always visible):
  [🏠 ڈیش بورڈ]  [📝 نیا داخلہ]  [📋 فہرست]  [⋮ مزید]

TIER 2 — "نیا داخلہ" sub-type:
  [طالب علم] [استاد] [عملہ]

TIER 3 — "مزید" dropdown:
  [مسترد شدہ (3)] [امپورٹ/ایکسپورٹ] [برانڈنگ] [تجزیات] [ترتیبات]
```

**Click reduction:**

| Task | Current Clicks | Proposed Clicks |
|------|---------------|-----------------|
| Find student | 2 (open module → records tab) | 1 (فہرست default) |
| New student admission | 1 (already on student tab) | 2 (نیا داخلہ → طالب علم) |
| Print ID card | 3 (records → search → icon) | 2 (فہرست → card button) |
| Reject application | 2 (form → reject) | 2 (same, but with confirmation) |

---

## Screen Redesigns

### 1. Registration Dashboard (new — default landing)

```
┌─────────────────────────────────────────────────────────┐
│  رجسٹریشن ڈیش بورڈ                    [🔍 تلاش...]     │
├────────────┬────────────┬────────────┬──────────────────┤
│ 1,247      │ 12         │ 3          │ 45               │
│ کل طلباء   │ آج داخلہ   │ مسترد      │ زیر التوا        │
├────────────┴────────────┴────────────┴──────────────────┤
│  حالیہ سرگرمی:                                          │
│  ● احمد نے STD-042 ترمیم کی — 5 منٹ پہلے               │
│  ● نیا داخلہ: عائشہ خان — جماعت ششم — 1 گھنٹہ پہلے    │
├─────────────────────────────────────────────────────────┤
│  [📝 نیا داخلہ]  [📋 تمام ریکارڈ]  [📤 امپورٹ]        │
└─────────────────────────────────────────────────────────┘
```

**Replaces:** Default student form tab on module open.

---

### 2. Simplified Admission Form

**Current:** 50+ fields, 6 accordion sections, all visible eventually.

**Proposed:** 3-step wizard (desktop) / 5-step (mobile)

```
Desktop (split view):
┌──────────────────┬──────────────────────────────────────┐
│  فہرست (30%)     │  فارم (70%)                          │
│  [🔍 تلاش...]    │  Step 2/3: رابطہ و تعلیم             │
│                  │                                      │
│  STD-041 محمد    │  فون: [___________]                  │
│  STD-042 علی  ←  │  کلاس: [جماعت ہفتم ▾]             │
│  STD-043 حسن     │  پتہ: [___________]                  │
│                  │                                      │
│                  │  [← پچھلا]  [اگلا →]  [✅ منظور]    │
└──────────────────┴──────────────────────────────────────┘
```

**Fields per step:**

| Step | Fields | Count |
|------|--------|-------|
| 1. ذاتی | name, fname, cnic, dob, gender | 5 |
| 2. رابطہ | phone, address, class, section | 4 |
| 3. والدین | fname (guardian), grdMobile, grdCNIC | 3 |
| 4. تصویر | photo upload/capture | 1 |
| 5. جائزہ | summary card → approve/reject | review |

**Reduced from 50+ to 13 essential fields** — advanced fields in "مزید تفصیلات" expandable section.

---

### 3. Smart Search Bar (global within registration)

```
┌─────────────────────────────────────────────┐
│ 🔍  نام، ID، CNIC، فون سے تلاش...           │
│    ┌─────────────────────────────────┐      │
│    │ 🟢 آف لائن تلاش                  │      │
│    │ محمد علی — جماعت ہفتم — STD-042 │      │
│    │ محمد حسن — جماعت ششم — STD-087  │      │
│    │ ☁️ Cloud تلاش (تیز)              │      │
│    └─────────────────────────────────┘      │
└─────────────────────────────────────────────┘
```

- Instant results after 2 chars
- Source indicator (offline/cloud)
- Keyboard navigation (↑↓ Enter)
- Recent searches

---

### 4. Record Card (replaces table row)

```
┌─────────────────────────────────────────────────┐
│ [📷]  محمد علی                    جماعت ہفتم  │
│       STD-042  │  0300-1234567  │  منظور شدہ  │
│                                                 │
│  [✏️ ترمیم]  [🪪 کارڈ]  [📄 خط]  [🗑️]  [⋮]   │
└─────────────────────────────────────────────────┘
```

- Avatar/photo thumbnail
- Status badge (approved/pending/rejected)
- Action buttons: 44px touch targets
- Overflow menu (⋮) for less common actions

---

### 5. Color System (refined)

| Token | Current | Proposed | Usage |
|-------|---------|----------|-------|
| `--reg-primary` | Blue | `#1e40af` (deeper blue) | Headers, active tabs |
| `--reg-accent` | Green | `#059669` (emerald) | Approve, success |
| `--reg-danger` | Red | `#dc2626` | Reject, delete |
| `--reg-warning` | — | `#d97706` (amber) | Duplicate warning, pending |
| `--reg-surface` | White | `#f8fafc` | Card backgrounds |
| `--reg-text` | Dark | `#1e293b` | Body text |
| `--reg-muted` | Gray | `#64748b` | Labels, secondary |

**Dark mode (Phase 2):** Invert surfaces, keep accent colors.

---

### 6. Typography

| Element | Current | Proposed |
|---------|---------|----------|
| Headings | System | `Noto Nastaliq Urdu` (if available) or system Urdu |
| Body | 13px | 14px (better readability) |
| Labels | 13px gray | 12px uppercase tracking, `--reg-muted` |
| Table text | 13px | 14px with 1.5 line-height |
| Buttons | 13.5px | 14px, font-weight 600 |

---

## Modern ERP Patterns Adopted

| Pattern | Source ERP | EMS Implementation |
|---------|-----------|-------------------|
| Dashboard landing | Fedena, PowerSchool | Registration dashboard with KPIs |
| Split-view edit | Salesforce | List + form side-by-side on desktop |
| Step wizard | EduPage | 3/5-step admission form |
| Smart search | Workday Student | Typeahead with source indicator |
| Card list (mobile) | Blackbaud | Replace table on <768px |
| Activity feed | HubSpot CRM | Recent actions from audit trail |
| Status badges | All ERPs | Color-coded approval status |
| Quick actions | Gmail-style | Floating action button for "نیا داخلہ" |

---

## Accessibility Improvements

| WCAG Criterion | Current | Proposed |
|----------------|---------|----------|
| 1.4.3 Contrast | Partial | All text ≥4.5:1 ratio |
| 2.5.5 Target Size | Fails (24px icons) | 44×44px minimum |
| 2.4.3 Focus Order | Default | Logical tab order in wizard |
| 4.1.2 Name, Role | Missing aria | `aria-label` on all icon buttons |
| 1.3.1 Info & Relationships | Labels unlinked | `for`/`id` on all form fields |
| 2.1.1 Keyboard | Partial | Full keyboard nav in search + wizard |

---

## Implementation Phases

### Phase 1 UI (bundled with Phase 1 sprints)

- [ ] Tab count badges
- [ ] Search source indicator
- [ ] Sticky save bar
- [ ] Single-column mobile forms
- [ ] Reject confirmation dialog
- [ ] Translate remaining English strings

### Phase 2 UI (with Phase 2 features)

- [ ] Registration dashboard landing
- [ ] Split-view desktop layout
- [ ] Step wizard form
- [ ] Record cards (mobile + desktop option)
- [ ] Smart search typeahead
- [ ] Activity feed
- [ ] Color system update
- [ ] Dark mode

---

## Mockup — Desktop Registration Module

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🪪 رجسٹریشن                    [UR][EN]  [🔍 تلاش...]  [📝 نیا] │
├──────────┬──────────────────────────────────────────────────────────┤
│ ڈیش بورڈ │                                                          │
│ نیا داخلہ│  ┌─ ڈیش بورڈ ─────────────────────────────────────┐   │
│ فہرست    │  │ 1,247 طلباء │ 45 اساتذہ │ 12 عملہ │ 3 مسترد   │   │
│ مسترد (3)│  ├──────────────────────────────────────────────────┤   │
│ ڈیٹا     │  │ حالیہ: STD-042 ترمیم — 5 منٹ پہلے              │   │
│ تجزیات   │  │ حالیہ: نیا داخلہ عائشہ خان — 1 گھنٹہ           │   │
│          │  └──────────────────────────────────────────────────┘   │
├──────────┴──────────────────────────────────────────────────────────┤
│ Sidebar nav (left) │ Content area (right)                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Estimated Score Impact

| Dimension | Current | After Phase 1 UI | After Phase 2 UI |
|-----------|---------|------------------|------------------|
| User Experience | 62 | 75 | 90 |
| Mobile Readiness | 38 | 65 | 85 |

---

*Next step: Implement Phase 1 UI quick wins (badges, sticky bar, confirmation dialogs) in Sprint 6.*
