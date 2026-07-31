# Phase A — Draft Admission & Auto Save: Migration Plan

**Phase:** 2A  
**Date:** 9 July 2026  
**Status:** DESIGN — awaiting approval  
**Principle:** Zero breaking change; feature-flag rollout; instant rollback

---

## 1. Migration Summary

Phase A is a **purely additive** feature. No existing registration records, IDB repo mirrors, or Firestore registration documents are modified or migrated.

| Data | Migration Required |
|------|-------------------|
| Approved registrations (SSOT) | **None** |
| Rejected records | **None** |
| Audit log | **None** |
| Permission snapshot | **None** |
| Import history | **None** |
| User workflow habits | **None** (opt-in via resume modal) |

---

## 2. Rollout Phases

### Stage 0 — Design Approval (Current)

- [ ] Architecture doc approved
- [ ] Database design approved
- [ ] Recovery scenarios approved
- [ ] Security review approved
- [ ] Migration plan approved

**No code deployed.**

---

### Stage 1 — Implementation (Feature Off)

| Item | Detail |
|------|--------|
| Flag | `EMS_REG_DRAFTS_ENABLED = false` (default) |
| Ship | Code in repo; loaders include `ems-registration-drafts.js` |
| Behavior | Identical to Phase 1 for all users |
| Tests | New suite + full regression 516+ pass |

**Gate:** CI green; flag-off regression identical.

---

### Stage 2 — Internal QA (Flag On, Staging)

| Item | Detail |
|------|--------|
| Flag | `true` on staging / dev tenants only |
| Cloud | Firestore rules deployed to staging project |
| QA | Recovery scenarios R01–R20 manual scripts |
| Duration | 3–5 days |

**Gate:** QA sign-off on recovery + multi-device + regression.

---

### Stage 3 — Production Canary

| Item | Detail |
|------|--------|
| Flag | `true` for 1–2 pilot madrasas |
| Monitor | IDB quota, outbox depth, error logs |
| Rollback | Set flag `false` — instant, no data migration |
| Duration | 1 week |

**Gate:** No P0/P1 issues; pilot user acceptance.

---

### Stage 4 — General Availability

| Item | Detail |
|------|--------|
| Flag | `true` default globally |
| Docs | User tip: "ڈرافٹ خود محفوظ ہو جاتا ہے" |
| Ops | Firestore rules on production |

**Gate:** Stakeholder Phase A acceptance.

---

## 3. File & Loader Migration

### 3.1 New Files

| File | Action |
|------|--------|
| `ems-registration-drafts.js` | Create |
| `tests/unit/ems-registration-drafts-phasea.test.js` | Create |
| `docs/REGISTRATION_PHASEA_IMPLEMENTATION_REPORT.md` | Post-implementation |

### 3.2 Modified Files (Minimal)

| File | Change |
|------|--------|
| `ems-post-auth-loader.js` | +1 line in OFFLINE_CORE after permissions |
| `ems-lazy-loader.js` | +1 line before admission.js |
| `admission.js` | Feature-flagged hooks (~40 lines) |
| `registration-ui.js` | Resume prompt on open |
| `index.html` | Draft UI elements (hidden when flag off) |
| `style.css` | Draft status styles |
| `ems-registration-bootstrap.js` | +`emsRegDraftPurgeSession` on destroy |

### 3.3 Unchanged

- `ems-registration-repository.js` schema
- `firestore.rules` registration SSOT paths (only **add** RegistrationDrafts block)
- `admin-panel.js`, duplicate, audit, permissions modules (no schema change)
- Android/dist mirrors updated at build time only

---

## 4. Database Migration

### 4.1 IndexedDB

**No migration of existing keys.** New keys appear on first save:

```
{tenantId}__reg_drafts_index
{tenantId}__reg_draft_{staffId}_{type}
{tenantId}__reg_draft_photo_{draftId}
{tenantId}__reg_draft_outbox
ems_reg_draft_device_id
```

**First-run init:**

```javascript
emsRegDraftInit() {
  if (!kvGet(indexKey)) kvSet(indexKey, { version: 1, drafts: {} });
  ensureDeviceId();
  purgeExpiredDrafts(); // no-op if empty
}
```

### 4.2 Firestore

**New collection only** — no backfill:

```
RegistrationDrafts/{tenantId}/items/{staffId}_{type}
```

Documents created on first cloud sync after draft save.

### 4.3 Rollback Data Cleanup (Optional)

If rolling back after Stage 2+:

| Action | Required |
|--------|----------|
| Disable flag | Yes — immediate |
| Delete local draft keys | Optional cleanup script |
| Delete Firestore drafts | Optional `RegistrationDrafts` purge per tenant |

**Rollback script (ops):**

```
emsRegDraftPurgeAll(tenantId) — implementation provides admin-only utility
```

Not run automatically on flag off (drafts harmless dormant).

---

## 5. Backward Compatibility Matrix

| User Action | Phase 1 Behavior | Phase A (flag on) | Phase A (flag off) |
|-------------|------------------|-------------------|---------------------|
| New admission + approve | Works | Works + draft deleted | Works |
| Edit record + approve | Works | Draft tagged edit | Works |
| Reject | Works | Draft deleted | Works |
| List/search | Works | Unchanged | Works |
| Import/export | Works | Unchanged | Works |
| Offline approve | Works | Unchanged | Works |
| Permissions | Works | Draft gated | Works |
| Mobile forms | Works | + status bar | Works |

---

## 6. Version & Cache Bust

| Item | Update |
|------|--------|
| `ems-post-auth-loader.js` CACHE_BUST | Increment on Phase A ship |
| `ems-lazy-loader.js` CACHE_BUST | Increment on Phase A ship |
| Service worker | If PWA cache — include new script in manifest |

---

## 7. Firestore Rules Deployment

**Order:**

1. Deploy rules with `RegistrationDrafts` match block (staging)
2. Verify staff write own draft only
3. Deploy production rules **before** Stage 3 canary cloud sync

**Rollback rules:** Remove match block; cloud sync fails gracefully (local still works).

---

## 8. Communication Plan

| Audience | Message |
|----------|---------|
| Staff | "ناتمام فارم اب خود محفوظ — بعد میں جاری رکھیں" |
| Admin | Draft TTL 30 days; cloud sync optional |
| Dev | Feature flag location; rollback procedure |

---

## 9. Success Criteria (Migration Complete)

- [ ] Flag-off regression: 516+ tests pass; zero draft side effects
- [ ] Flag-on: R01, R05, R08, R10, R11 manual QA pass
- [ ] No increase in registration save failures
- [ ] IDB quota stable (<5% users hit warning)
- [ ] Firestore rules deployed without SSOT regression
- [ ] Phase A stakeholder approval

---

## 10. Rollback Procedure

```
1. Set EMS_REG_DRAFTS_ENABLED = false (config or hotfix)
2. Deploy — no rebuild required if flag read at runtime
3. Verify: no resume modal; approve flow normal
4. Optional: run emsRegDraftPurgeAll per tenant
5. Optional: revert Firestore rules
```

**Time to rollback:** <15 minutes (flag toggle).

---

## 11. Timeline (Post-Approval)

| Week | Activity |
|------|----------|
| W1 | Implement module + flag off + unit tests |
| W2 | UI + admission hooks + integration tests |
| W3 | QA staging + canary + docs + Phase A acceptance |

Aligns with Phase 2 plan: **3 weeks** for Phase A.

---

## 12. Post-Phase A

| Phase | Status |
|-------|--------|
| B — Timeline, Duplicate Prediction | **LOCKED** until Phase A accepted |
| C — Parent, QR | LOCKED |
| D — Signature, Workflow | LOCKED |
| E — Analytics, AI | LOCKED |

---

## 13. Approval Checklist

- [ ] Staged rollout approved
- [ ] Flag default false → true plan approved
- [ ] Rollback procedure approved
- [ ] No SSOT migration confirmed acceptable

**Upon approval → begin Phase A implementation only.**

---

*Index: `REGISTRATION_PHASEA_ARCHITECTURE.md` and sibling Phase A design docs.*
