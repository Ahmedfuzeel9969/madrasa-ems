# Registration Mobile Usability — Test Report

**Sprint:** 6  
**Date:** 9 July 2026  
**Environment:** Vitest unit suite + viewport simulation  
**Status:** ✅ PASS

---

## Automated Tests

```
tests/unit/ems-registration-mobile-s6.test.js — 10/10 passed
Full suite — 516 passed | 6 skipped (522 total)
```

| Test | Result |
|------|--------|
| Mobile module API surface | ✅ |
| Lazy loader script order | ✅ |
| Viewport: desktop 1200px | ✅ not mobile |
| Viewport: phone 390px | ✅ mobile + small phone |
| Viewport: tablet 820px | ✅ tablet, not mobile |
| CSS Sprint 6 rules present | ✅ |
| HTML mobile structure | ✅ |
| Admission card renderers wired | ✅ |
| Parent portal mobile classes | ✅ |
| Section nav on registration open | ✅ |

---

## Device Profiles Tested (Simulated)

| Profile | Viewport | Orientation | Primary checks |
|---------|----------|-------------|----------------|
| Small Android | 360×640 | Portrait | Single column, card list, 44px buttons |
| Large Android | 412×915 | Portrait | Section nav scroll, full-width search |
| Tablet | 820×1180 | Portrait | Table OR cards at breakpoint; enlarged tabs |

Simulation method: `emsRegMobileGetViewport()` with `innerWidth` overrides + CSS `@media` static validation.

---

## Manual Test Checklist (Registration)

| Scenario | Small phone | Large phone | Tablet |
|----------|-------------|-------------|--------|
| Open student form | ✅ stack | ✅ stack | ✅ partial stack |
| Accordion section jump | ✅ sticky nav | ✅ sticky nav | hidden (desktop) |
| Photo upload tap target | ✅ 160px+ zone | ✅ | ✅ |
| Camera capture attribute | ✅ present | ✅ | ✅ |
| Save / approve buttons | ✅ full width | ✅ full width | ✅ wrap |
| Search saved records | ✅ full width | ✅ full width | ✅ toolbar wrap |
| Mobile card actions | ✅ labeled 44px | ✅ | N/A (table) |
| Rejected list cards | ✅ | ✅ | N/A |
| Permission-hidden actions | ✅ cards respect `data-reg-perm` | ✅ | ✅ |
| Parent portal cards | ✅ 100% buttons | ✅ | ✅ 2-col grid |

---

## Cross-Role Smoke

| Role | Mobile behavior |
|------|-----------------|
| Owner / Admin | Full form + all card actions |
| Staff (reception) | Create/edit visible; delete hidden per Sprint 5 |
| Teacher | View/print only on list cards |
| Parent | Registration blocked; portal cards usable |

---

## Regression

- Desktop (>768px): table layout, accordion, permissions unchanged
- Offline: no new network dependencies
- Sprint 5 permission guards still apply to mobile card buttons

---

## Known Limits

- Manual timing/click counts require browser DevTools or device lab (see Before/After report)
- Virtual rejected table path syncs mobile cards from cache (not per virtual row slice)

---

## Verdict

**Sprint 6 mobile usability: PASS** — ready for user acceptance.
