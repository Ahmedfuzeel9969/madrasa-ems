# Registration Phase 1 — Lessons Learned

**Date:** 9 July 2026  
**Audience:** Registration team, Phase 2 planners, EMS architects  
**Status:** Phase 1 closed

---

## What Went Well

### 1. Sprint-by-sprint approval reduced rework
Each sprint had a clear gate, implementation report, and explicit user approval before the next sprint started. This prevented scope creep (e.g., mobile work did not start until permissions were verified).

**Takeaway:** Keep one-sprint-at-a-time approval for Phase 2 phases A–E.

---

### 2. Offline-first as a non-negotiable constraint worked
Every feature (search fallback, audit outbox, permission snapshot, mobile cards) was designed to function without network. Saves were never blocked by audit or sync.

**Takeaway:** Phase 2 features must declare offline behavior upfront — especially Draft/Auto Save and Digital Signature.

---

### 3. New modules beat monolithic admission.js growth
Sprints 3–6 added focused files (`ems-registration-duplicates.js`, `-audit.js`, `-permissions.js`, `-mobile.js`) with thin wiring in `admission.js`. Tests targeted modules independently.

**Takeaway:** Phase 2 should add `ems-registration-drafts.js`, `-timeline.js`, `-workflow.js`, etc., not expand admission.js by thousands of lines.

---

### 4. UI + API dual guards for security
Sprint 5 proved that hiding buttons alone is insufficient — `emsRegRequire()` on save/delete/import paths blocked direct function-call bypass in tests.

**Takeaway:** Every Phase 2 permission-sensitive action (workflow step advance, QR approve, signature bind) needs both guards.

---

### 5. Test-first closure built confidence
516 passing tests across 90 files gave objective closure evidence. Sprint-specific suites (S3–S6) caught regressions early.

**Takeaway:** Each Phase 2 feature ships with a dedicated `ems-registration-*-phase*.test.js` before stakeholder approval.

---

### 6. Mobile as a dedicated sprint, not an afterthought
Treating mobile as Sprint 6 (not sprinkling CSS fixes across other sprints) produced coherent card lists, section nav, and touch targets without destabilizing desktop.

**Takeaway:** Phase 2 public QR form and signature pad should be **mobile-first by design**, desktop second.

---

## What Was Harder Than Expected

### 1. Legacy path removal had hidden callers
ID card, letter modal, and rejected table each had subtle legacy read paths. Feature flags (`EMS_REG_LEGACY_READ_FALLBACK`) were necessary for safe rollout.

**Lesson:** Run static grep gates (`emsCacheGet(DB_USERS)` in registration) in CI before merging Phase 2 repo changes.

---

### 2. Cloud search routing needed clear UX signaling
Staff needed to know whether results came from cloud, cache, or local fallback. Source badge reduced support confusion.

**Lesson:** Phase 2 AI and analytics should show data source/provenance badges similarly.

---

### 3. Permission test environments lacked browser APIs
`emsRegRequire()` initially called bare `alert()` — failed in Vitest. Environment guards (`typeof global.alert === 'function'`) were required.

**Lesson:** All Phase 2 UI feedback paths must use injectable toast/alert abstractions testable in vm context.

---

### 4. Virtual table vs DOM pagination tension
Saved records list disabled virtual scroll due to empty visible rows; rejected list still uses virtual mount. Mobile card sync had to hook multiple render paths.

**Lesson:** Phase 2 Timeline and Analytics should pick **one list rendering strategy** per view (cards on mobile, virtual on desktop large lists).

---

### 5. Accordion built at runtime complicated mobile nav
Section jump nav depends on accordion heads existing after `registration-ui.js` runs. Order of init matters.

**Lesson:** Phase 2 workflow step UI should use declarative HTML or a single layout builder, not multiple runtime DOM transforms.

---

## Technical Debt Accepted (Documented)

| Debt | Owner | Phase 2 touchpoint |
|------|-------|-------------------|
| Firestore staff write rules | Ops | Phase D workflow |
| Full audit viewer modal | Registration | Phase B Timeline |
| Server-side permission only | Security | Phase D |
| Virtual rejected table + mobile cards dual path | Registration | Phase B cleanup |
| dist/android mirror copies | Build | Any Phase 2 ship |

---

## Process Recommendations for Phase 2

1. **Phase gates, not big-bang** — Implement Phases A→E sequentially; user approves each phase before coding the next.
2. **Architecture doc before code** — Each feature gets a one-page design in the implementation plan (done in `REGISTRATION_PHASE2_IMPLEMENTATION_PLAN.md`).
3. **Offline matrix required** — Every feature row must answer: works offline? degrades how? sync when?
4. **Mobile column required** — If staff uses it in field, design phone first.
5. **Security review at Phase D** — Workflow + signatures + QR public ingress are highest risk.
6. **No cross-module edits** — Registration Phase 2 stays in registration unless Timeline reads other modules read-only.

---

## Stakeholder Feedback Themes (Sprints 1–6)

| Theme | Response in Phase 1 |
|-------|---------------------|
| "Don't break offline" | Audit outbox, search fallback, perm snapshot |
| "Reception shouldn't delete" | Fine-grained permissions |
| "Can't find students quickly" | Cloud-first search |
| "Duplicate CNIC entries" | D1–D7 rules + override |
| "Phone form unusable" | Sprint 6 mobile UX |
| "Who changed this record?" | Audit trail with diff |

**Unmet themes → Phase 2:** draft recovery, public admission, parent accounts, workflow, analytics, smarter duplicate hints.

---

## Metrics That Mattered

| Metric | Phase 1 |
|--------|---------|
| Vitest pass rate | 516/522 (99%) |
| Sprints delivered on scope | 6/6 |
| Overall score lift | +19 points |
| Mobile score lift | +37 points |
| Security score lift | +18 points |
| Registration-only file discipline | Maintained |

---

## One-Line Summary

**Phase 1 succeeded by enforcing offline-first modular sprints with dual security guards and explicit approval gates — Phase 2 should reuse that rhythm while tackling public ingress, workflow state, and intelligence features that inherently depend on cloud.**

---

*See `REGISTRATION_PHASE1_FINAL_REPORT.md` and `REGISTRATION_PHASE2_IMPLEMENTATION_PLAN.md` for closure and forward plan.*
