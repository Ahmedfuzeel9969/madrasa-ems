# Registration Mobile Improvement Report

**Date:** 9 July 2026  
**Phase:** 1 — Priority 6  
**Status:** Pre-implementation analysis  
**Current Score:** 38/100

---

## Current Mobile State

### What exists

| Feature | Status | Evidence |
|---------|--------|----------|
| WebView APK wrapper | ✅ Built | `android/app/build/outputs/apk/debug/app-debug.apk` |
| Responsive max-width | ✅ | `style.css` L494–498 |
| Horizontal scroll tabs | ✅ | `.reg-tabs { overflow-x:auto }` |
| Touch file upload (photo) | ✅ | `<input type="file" accept="image/*">` |
| Offline-first on mobile | ✅ | Full SSOT works in WebView |
| RTL layout | ✅ | `dir="rtl"` on HTML |

### What is missing

| Feature | Impact | Priority |
|---------|--------|----------|
| Single-column form layout | Forms unusable on phone | P1 |
| Bottom navigation | Hard to switch tabs on phone | P1 |
| Touch-friendly buttons (44px min) | Mis-taps on small targets | P1 |
| Mobile record actions (bottom sheet) | Cannot edit/print from list | P1 |
| Sticky save bar | Save button scrolls off screen | P1 |
| Mobile search UX | Keyboard covers results | P2 |
| Swipe gestures | No native feel | P2 |
| Camera capture for photo | File picker only, no camera | P2 |
| Pull-to-refresh on list | No mobile refresh pattern | P3 |
| Haptic feedback | No tactile response | P3 |

---

## Device Testing Matrix

| Device | Screen | Expected Issues |
|--------|--------|-----------------|
| Android phone (360×640) | Small | Form grid 2-column cramped, table overflow |
| Android phone (412×915) | Medium | Tabs scroll, form sections too long |
| Android tablet (800×1280) | Large | Acceptable with accordions |
| iPhone SE (375×667) | Small | Same as Android small |
| Desktop browser (1920×1080) | Full | Current design target — works well |

---

## Problem Areas (Detailed)

### 1. Form layout — Score impact: -20

```css
/* Current: style.css L472 */
#module-admission .form-grid {
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}
```

On 360px screen: 1–2 columns, fields ~170px wide, labels truncated.

**Fix:** Below 768px → single column, full-width inputs, 16px font (prevents iOS zoom).

### 2. Tab navigation — Score impact: -15

7 tabs in horizontal scroll — users don't see all options. "محفوظ ریکارڈ" is off-screen.

**Fix:** Bottom nav bar with 4 primary icons + "More" menu for branding/import/rejected.

### 3. Saved records table — Score impact: -15

Full HTML table with 6+ columns — requires horizontal scroll on mobile.

**Fix:** Card-based list view on mobile (name, class, ID, action menu).

### 4. Touch targets — Score impact: -10

| Element | Current Size | WCAG Minimum |
|---------|-------------|--------------|
| Tab buttons | 32×36px | 44×44px |
| Row action icons | ~24px | 44×44px |
| Accordion headers | 48px ✅ | OK |
| Form inputs | 36px height | 44px |

### 5. Long form scroll — Score impact: -10

Student form: 50+ fields in 6 accordion sections. On mobile: 8–12 screen-heights of scrolling.

**Fix:** Step wizard on mobile (Personal → Contact → Academic → Parent → Photo → Review).

### 6. Photo upload — Score impact: -5

"Dashed box" upload works but doesn't open camera directly on mobile.

**Fix:** `<input capture="environment">` for rear camera on mobile.

---

## Proposed Mobile Layout

### Bottom navigation (mobile only, <768px)

```
┌──────────────────────────────────────┐
│         [Form / List Content]        │
│                                      │
├──────┬──────┬──────┬──────┬──────────┤
│ 📝   │ 📋   │ ❌   │ 📤   │  ☰     │
│ نیا  │ فہرست│ مسترد│ ڈیٹا │ مزید   │
└──────┴──────┴──────┴──────┴──────────┘
```

### Mobile form wizard (replaces accordion on <768px)

```
Step 1/5: ذاتی معلومات
┌────────────────────────────┐
│ نام: [________________]    │
│ ولدیت: [______________]    │
│ شناختی نمبر: [_________]  │
│                            │
│ [← پچھلا]  [اگلا →]       │
└────────────────────────────┘
● ○ ○ ○ ○  (progress dots)
```

### Mobile record card (replaces table rows)

```
┌────────────────────────────┐
│ محمد علی          جماعت ہفتم│
│ STD-042                    │
│ 0300-1234567               │
│ [ترمیم] [کارڈ] [⋮]        │
└────────────────────────────┘
```

### Sticky save bar

```
┌────────────────────────────┐
│ [✅ منظور]  [❌ مسترد]     │
└────────────────────────────┘
(fixed bottom, above nav)
```

---

## CSS Changes (Phase 1)

### New media query block

```css
/* Proposed: reg-mobile.css */
@media (max-width: 768px) {
  #module-admission .form-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  #module-admission .input-control {
    font-size: 16px;
    min-height: 44px;
    padding: 10px 12px;
  }
  .reg-tab { min-height: 44px; min-width: 44px; }
  .reg-mobile-bottom-nav { display: flex; }
  .reg-topbar .reg-tabs { display: none; }
  .reg-save-bar { position: fixed; bottom: 56px; }
  .reg-users-table { display: none; }
  .reg-mobile-cards { display: block; }
}
```

### Files to modify

| File | Changes |
|------|---------|
| `style.css` or new `reg-mobile.css` | Mobile layout rules |
| `index.html` | Bottom nav HTML, mobile card container |
| `admission.js` | `regRenderMobileCards()`, wizard step logic |
| `registration-ui.js` | Detect mobile → activate wizard mode |

---

## Parent/Staff Mobile Experience

### Parent (via parent-portal — out of scope but noted)

- Parents cannot register students on mobile today
- Phase 2: QR admission portal (mobile-first)

### Staff on mobile

| Task | Current | Target |
|------|---------|--------|
| Look up student | Open app → registration → scroll to list tab → search | Bottom nav → فہرست → search (2 taps) |
| Print ID card | Find in table → tiny icon | Card view → "کارڈ" button (44px) |
| New admission | 50+ field scroll | 5-step wizard with save bar |
| Photo capture | File picker | Direct camera |

---

## Implementation Phases

### Phase 1a (Week 1) — Quick wins

- [ ] Single-column form grid below 768px
- [ ] 16px input font-size (iOS zoom fix)
- [ ] 44px minimum touch targets on buttons
- [ ] Sticky save bar on form panels
- [ ] `capture="environment"` on photo input

**Estimated score after 1a: 55/100**

### Phase 1b (Week 2–3) — Layout redesign

- [ ] Bottom navigation bar
- [ ] Mobile card list view
- [ ] Hide desktop table on mobile
- [ ] Bottom sheet for row actions (edit, delete, print)

**Estimated score after 1b: 68/100**

### Phase 1c (Week 4) — Form wizard

- [ ] 5-step mobile wizard for student form
- [ ] Progress indicator
- [ ] Step validation before next
- [ ] Teacher/staff shortened wizard (3 steps)

**Estimated score after 1c: 75/100**

### Phase 2 — Native feel

- [ ] Pull-to-refresh on list
- [ ] Swipe-to-delete on cards
- [ ] Haptic feedback (Capacitor plugin)
- [ ] Offline indicator badge

**Target score: 85/100**

---

## Testing Plan

| Test | Device | Pass Criteria |
|------|--------|---------------|
| Form fill | Android 360px | All fields accessible without horizontal scroll |
| Tab switch | Android phone | Bottom nav switches panels <200ms |
| Search | Android phone | Keyboard doesn't permanently cover results |
| Photo | Android phone | Camera opens on photo tap |
| Save | Android phone | Sticky bar always visible |
| List browse | Android phone | Cards render, actions tappable |
| Offline | Android APK | Full registration works without network |

---

## Estimated Score Impact

| Dimension | Before | After Phase 1 | After Phase 2 |
|-----------|--------|---------------|---------------|
| Mobile Readiness | 38 | 75 | 85 |
| User Experience | 62 | 72 | 82 |

---

*Next step: Phase 1a CSS quick wins — zero JS logic changes, immediate improvement.*
